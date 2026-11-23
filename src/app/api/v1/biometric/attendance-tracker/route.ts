// src/app/api/v1/biometric/attendance-tracker/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const API_KEY = process.env.BIOMETRIC_API_KEY || 'HYPERION_BIOMETRIC_KEY_2026';

function parseTimeHHMM(
  timeStr: string | null | undefined,
  fallbackH: number,
  fallbackM: number
): [number, number] {
  if (!timeStr || !timeStr.includes(':')) return [fallbackH, fallbackM];
  const [h, m] = timeStr.split(':').map(Number);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = req.headers.get('x-api-key') || searchParams.get('api_key');

    if (key !== API_KEY) {
      return NextResponse.json(
        { status: 'error', message: 'API Key inválida' },
        { status: 401 }
      );
    }

    const rawBody = await req.json();
    const punches = Array.isArray(rawBody) ? rawBody : [rawBody];
    if (punches.length === 0) {
      return NextResponse.json({ status: 'success', processed: 0, errors: [] });
    }

    // 1. Parsear fechas y ordenar cronológicamente en memoria
    const parsedPunches: {
      empCode: string;
      serialNo: string;
      punchTime: Date;
      dayKey: string;
      dayDate: Date;
    }[] = [];
    const errorsSet = new Set<string>();
    const dniSet = new Set<string>();
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const item of punches) {
      const empCode = String(item.EmployeeCode || '').trim();
      const punchStr = String(item.PunchDateAndTime || '').trim();
      if (!empCode || !punchStr) continue;

      const punchTime = new Date(
        punchStr.includes('T') ? punchStr : `${punchStr.replace(' ', 'T')}-05:00`
      );
      if (isNaN(punchTime.getTime())) continue;

      const dayDate = new Date(`${punchStr.slice(0, 10)}T00:00:00.000Z`);
      const dayKey = punchStr.slice(0, 10);


      dniSet.add(empCode);
      if (!minDate || dayDate < minDate) minDate = dayDate;
      if (!maxDate || dayDate > maxDate) maxDate = dayDate;

      parsedPunches.push({
        empCode,
        serialNo: String(item.SerialNo || 'Reloj'),
        punchTime,
        dayKey,
        dayDate,
      });
    }

    parsedPunches.sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

    // 2. Precarga masiva en 3 consultas SQL (sin consultas N+1 dentro del bucle)
    const users = await prisma.user.findMany({
      where: { dni: { in: Array.from(dniSet) } },
      include: { company: true, payrollPolicy: true },
    });
    const userByDni = new Map(users.map((u) => [u.dni, u]));

    const closedPeriods = await prisma.payrollPeriod.findMany({
      where: { status: 'CLOSED' },
    });

    const existingRecords =
      minDate && maxDate && users.length > 0
        ? await prisma.attendanceRecord.findMany({
            where: {
              userId: { in: users.map((u) => u.id) },
              date: { gte: minDate, lte: maxDate },
            },
          })
        : [];

    const recordMap = new Map<string, any>();
    for (const rec of existingRecords) {
      const key = `${rec.userId}_${new Date(rec.date).toISOString().slice(0, 10)}`;
      recordMap.set(key, rec);
    }

    const toCreate: any[] = [];
    const toUpdate = new Map<string, any>();
    let processed = 0;

    // 3. Procesar todas las marcaciones en memoria
    for (const p of parsedPunches) {
      const user = userByDni.get(p.empCode);
      if (!user) {
        errorsSet.add(`Trabajador no encontrado para código: ${p.empCode}`);
        continue;
      }

      const isClosed = closedPeriods.some(
        (cp) =>
          cp.companyId === user.companyId &&
          p.dayDate >= new Date(cp.startDate) &&
          p.dayDate <= new Date(cp.endDate)
      );
      if (isClosed) {
        errorsSet.add(`Período cerrado para ${p.empCode} (${p.dayKey})`);
        continue;
      }

      const mapKey = `${user.id}_${p.dayKey}`;
      const record = recordMap.get(mapKey);
      const company = user.company;

      if (record) {
        const existingTimes = [
          record.checkIn,
          record.lunchStart,
          record.lunchEnd,
          record.checkOut,
        ]
          .filter(Boolean)
          .map((d) => new Date(d).getTime());
        if (existingTimes.some((t) => Math.abs(t - p.punchTime.getTime()) < 120_000)) {
          continue;
        }
      }

      const [workHour, workMin] = user.workStartTime.split(':').map(Number);

      // A) Primera marcación del día (o reemplazo de falta injustificada previa) -> CHECK_IN
      if (!record || record.status === 'ABSENT' || !record.checkIn) {
        const graceLimitTime = new Date(p.punchTime);
        graceLimitTime.setHours(workHour, workMin + user.toleranceMinutes, 0, 0);

        let lateMinutes = 0;
        let status: 'PRESENT' | 'LATE' = 'PRESENT';

        if (p.punchTime > graceLimitTime) {
          status = 'LATE';
          const expectedTime = new Date(p.punchTime);
          expectedTime.setHours(workHour, workMin, 0, 0);
          lateMinutes = Math.max(
            0,
            Math.floor((p.punchTime.getTime() - expectedTime.getTime()) / 60_000) -
              user.toleranceMinutes
          );
        }

        if (record && record.id) {
          // Actualizar el registro ABSENT existente convirtiéndolo en marcación válida
          record.checkIn = p.punchTime;
          record.type = 'BIOMETRIC_FINGERPRINT';
          record.status = status;
          record.lateMinutes = lateMinutes;
          record.observations = `Sincronizado desde Biométrico (${p.serialNo})`;
          toUpdate.set(record.id, record);
        } else {
          const newRec = {
            userId: user.id,
            date: p.dayDate,
            checkIn: p.punchTime,
            lunchStart: null as Date | null,
            lunchEnd: null as Date | null,
            checkOut: null as Date | null,
            type: 'BIOMETRIC_FINGERPRINT',
            status,
            lateMinutes,
            overtimeMinutes: 0,
            overtime25Minutes: 0,
            overtime35Minutes: 0,
            latitude: company.officeLat,
            longitude: company.officeLng,
            employeeSignature: user.signatureBase64 || null,
            observations: `Sincronizado desde Biométrico (${p.serialNo})`,
            _isNew: true,
          };
          recordMap.set(mapKey, newRec);
          toCreate.push(newRec);
        }

        processed++;
        continue;
      }

      // B) Marcaciones siguientes del mismo día -> CHECK_OUT + Refrigerio + HE
      const lunchWindowStartStr = company.lunchWindowStart || '13:00';
      const lunchDurationMinutes = company.lunchDurationMinutes ?? 60;
      const lunchDays = Array.isArray(company.lunchDays)
        ? company.lunchDays
        : [1, 2, 3, 4, 5];
      const saturdayWorkHours = company.saturdayWorkHours ?? 4.5;

      const dayOfWeek = p.dayDate.getDay();
      const isSaturday = dayOfWeek === 6;
      const hasLunchToday = lunchDays.includes(dayOfWeek);
      const effectiveDayHours = isSaturday
        ? saturdayWorkHours
        : user.payrollPolicy?.hoursPerDay || 8.0;
      const lunchMinutesToday = hasLunchToday ? lunchDurationMinutes : 0;

      const officialCheckOut = new Date(p.dayDate);
      officialCheckOut.setHours(workHour, workMin, 0, 0);
      officialCheckOut.setMinutes(
        officialCheckOut.getMinutes() +
          Math.round(effectiveDayHours * 60) +
          lunchMinutesToday
      );

      const [winStartH, winStartM] = parseTimeHHMM(lunchWindowStartStr, 13, 0);
      const defaultLunchStart = new Date(p.dayDate);
      defaultLunchStart.setHours(winStartH, winStartM, 0, 0);
      const defaultLunchEnd = new Date(defaultLunchStart);
      defaultLunchEnd.setMinutes(defaultLunchEnd.getMinutes() + lunchDurationMinutes);

      const shouldAutoAssignLunch =
        hasLunchToday &&
        !record.lunchStart &&
        !record.lunchEnd &&
        new Date(record.checkIn) < defaultLunchStart &&
        p.punchTime > defaultLunchEnd;

      const totalOvertimeMinutes =
        p.punchTime > officialCheckOut
          ? Math.floor((p.punchTime.getTime() - officialCheckOut.getTime()) / 60_000)
          : 0;

      record.checkOut = p.punchTime;
      if (shouldAutoAssignLunch) {
        record.lunchStart = defaultLunchStart;
        record.lunchEnd = defaultLunchEnd;
      }
      record.overtimeMinutes = totalOvertimeMinutes;
      record.overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
      record.overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);

      if (!record._isNew && record.id) {
        toUpdate.set(record.id, record);
      }
      processed++;
    }

    // 4. Persistencia masiva en PostgreSQL
    if (toCreate.length > 0) {
      await prisma.attendanceRecord.createMany({
        data: toCreate.map(({ _isNew, ...clean }) => clean),
        skipDuplicates: true,
      });
    }

    if (toUpdate.size > 0) {
      await prisma.$transaction(
        Array.from(toUpdate.values()).map((rec) =>
          prisma.attendanceRecord.update({
            where: { id: rec.id },
            data: {
              checkIn: rec.checkIn,
              checkOut: rec.checkOut,
              lunchStart: rec.lunchStart,
              lunchEnd: rec.lunchEnd,
              type: rec.type,
              status: rec.status,
              lateMinutes: rec.lateMinutes,
              observations: rec.observations,
              overtimeMinutes: rec.overtimeMinutes,
              overtime25Minutes: rec.overtime25Minutes,
              overtime35Minutes: rec.overtime35Minutes,
            },
          })
        )
      );
    }

    return NextResponse.json({
      status: 'success',
      processed,
      errors: Array.from(errorsSet),
    });
  } catch (error: any) {
    console.error('❌ Error en endpoint biométrico:', error);
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Error interno' },
      { status: 500 }
    );
  }
}