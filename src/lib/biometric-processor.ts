import { prisma } from '@/lib/prisma';
import { AttendanceType } from '@prisma/client';

export interface BiometricPunchInput {
  empCode: string;
  serialNo: string;
  method: AttendanceType;
  punchTime: Date;
  dayKey: string;
  dayDate: Date;
}

export interface ProcessBiometricOptions {
  saveUnmatched?: boolean;
}

function parseTimeHHMM(
  timeStr: string | null | undefined,
  fallbackH: number,
  fallbackM: number
): [number, number] {
  if (!timeStr || !timeStr.includes(':')) return [fallbackH, fallbackM];
  const [h, m] = timeStr.split(':').map(Number);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
}

function toTotalMinutes(timeStr: string | null | undefined, fallbackMinutes: number): number {
  if (!timeStr || !timeStr.includes(':')) return fallbackMinutes;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return fallbackMinutes;
  return h * 60 + m;
}

function getPeruTimeParts(date: Date) {
  const peruDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dayOfWeek = peruDate.getUTCDay(); // 0 = Dom, 6 = Sáb
  const hour = peruDate.getUTCHours();
  const minute = peruDate.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;
  return { dayOfWeek, hour, minute, totalMinutes };
}

function buildPeruDateTime(dayKey: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dayKey}T${hh}:${mm}:00.000-05:00`);
}

export async function processBiometricPunches(
  parsedPunches: BiometricPunchInput[],
  options: ProcessBiometricOptions = { saveUnmatched: true }
) {
  if (parsedPunches.length === 0) {
    return { processed: 0, errors: [] as string[] };
  }

  parsedPunches.sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());

  const errorsSet = new Set<string>();
  const codeCandidates = new Set<string>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (const p of parsedPunches) {
    codeCandidates.add(p.empCode);
    if (p.empCode.length < 8) {
      codeCandidates.add(p.empCode.padStart(8, '0'));
    }
    const stripped = p.empCode.replace(/^0+/, '');
    if (stripped) codeCandidates.add(stripped);

    if (!minDate || p.dayDate < minDate) minDate = p.dayDate;
    if (!maxDate || p.dayDate > maxDate) maxDate = p.dayDate;
  }

  const candidatesArr = Array.from(codeCandidates);
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { dni: { in: candidatesArr } },
        { biometricCode: { in: candidatesArr } },
      ],
    },
    include: { company: true, payrollPolicy: true },
  });

  const userByCode = new Map<string, (typeof users)[0]>();
  for (const u of users) {
    userByCode.set(u.dni, u);
    if (u.biometricCode) {
      userByCode.set(u.biometricCode, u);
      userByCode.set(u.biometricCode.replace(/^0+/, ''), u);
    }
  }

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
  const unmatchedToSave: any[] = [];
  let processed = 0;

  for (const p of parsedPunches) {
    const user =
      userByCode.get(p.empCode) ||
      userByCode.get(p.empCode.padStart(8, '0')) ||
      userByCode.get(p.empCode.replace(/^0+/, ''));

    if (!user) {
      errorsSet.add(`Trabajador no encontrado para código: ${p.empCode}`);
      unmatchedToSave.push({
        rawCode: p.empCode,
        punchTime: p.punchTime,
        type: p.method,
        serialNo: p.serialNo,
      });
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

    const { dayOfWeek, totalMinutes } = getPeruTimeParts(p.punchTime);
    const isSaturday = dayOfWeek === 6;
    const isSunday = dayOfWeek === 0;

    if (isSunday) {
      continue;
    }

    const mapKey = `${user.id}_${p.dayKey}`;
    let record = recordMap.get(mapKey);
    const company = user.company;

    const [workHour, workMin] = parseTimeHHMM(user.workStartTime, 9, 0);
    const methodLabel = p.method === 'PRESENTIAL_NFC' ? 'Tarjeta RFID' : 'Huella';

    const ensureDayRecord = () => {
      if (!record) {
        record = {
          userId: user.id,
          date: p.dayDate,
          checkIn: null as Date | null,
          lunchStart: null as Date | null,
          lunchEnd: null as Date | null,
          checkOut: null as Date | null,
          type: p.method,
          status: 'PRESENT',
          lateMinutes: 0,
          overtimeMinutes: 0,
          overtime25Minutes: 0,
          overtime35Minutes: 0,
          latitude: company.officeLat,
          longitude: company.officeLng,
          employeeSignature: user.signatureBase64 || null,
          observations: `Sincronizado desde Biométrico - ${methodLabel} (${p.serialNo})`,
          _isNew: true,
        };
        recordMap.set(mapKey, record);
        toCreate.push(record);
      } else if (record.status === 'ABSENT') {
        record.status = 'PRESENT';
        record.type = p.method;
        record.observations = `Sincronizado desde Biométrico - ${methodLabel} (${p.serialNo})`;
        if (!record._isNew && record.id) toUpdate.set(record.id, record);
      }
      return record;
    };

    // Franjas horarias dinámicas configuradas por la empresa (en minutos desde las 00:00)
    const checkInStartMin = toTotalMinutes(company.biometricCheckInStart, 6 * 60);
    const checkInEndMin = toTotalMinutes(company.biometricCheckInEnd, 11 * 60 + 59);
    const lunchStartMin = toTotalMinutes(company.lunchWindowStart, 13 * 60);
    const lunchEndMax = toTotalMinutes(company.lunchWindowEnd, 13 * 60 + 30);
    const lunchReturnMax = toTotalMinutes(company.lunchReturnEnd, 16 * 60 + 59);
    const checkOutMinWeekday = toTotalMinutes(company.biometricCheckOutStart, 17 * 60);

    // 1. ENTRADA (Dentro de la franja de ingreso configurada por la empresa)
    if (totalMinutes >= checkInStartMin && totalMinutes <= checkInEndMin) {
      const rec = ensureDayRecord();

      if (!rec.checkIn || p.punchTime < new Date(rec.checkIn)) {
        const expectedTime = buildPeruDateTime(p.dayKey, workHour, workMin);
        const graceLimitTime = new Date(
          expectedTime.getTime() + user.toleranceMinutes * 60_000
        );

        let lateMinutes = 0;
        let status: 'PRESENT' | 'LATE' = 'PRESENT';

        if (p.punchTime > graceLimitTime) {
          status = 'LATE';
          lateMinutes = Math.max(
            0,
            Math.floor((p.punchTime.getTime() - expectedTime.getTime()) / 60_000) -
              user.toleranceMinutes
          );
        }

        rec.checkIn = p.punchTime;
        rec.type = p.method;
        rec.status = status;
        rec.lateMinutes = lateMinutes;
        rec.observations = `Sincronizado desde Biométrico - ${methodLabel} (${p.serialNo})`;

        if (!rec._isNew && rec.id) {
          toUpdate.set(rec.id, rec);
        }
        processed++;
      }
      continue;
    }

    // 2. SÁBADOS (Después de la franja de ingreso -> Salida directa sin refrigerio)
    if (isSaturday && totalMinutes > checkInEndMin) {
      const rec = ensureDayRecord();

      if (!rec.checkOut || p.punchTime < new Date(rec.checkOut)) {
        const saturdayWorkHours = company.saturdayWorkHours ?? 4.5;
        const expectedStart = buildPeruDateTime(p.dayKey, workHour, workMin);
        const officialCheckOut = new Date(
          expectedStart.getTime() + Math.round(saturdayWorkHours * 60) * 60_000
        );

        const totalOvertimeMinutes =
          p.punchTime > officialCheckOut
            ? Math.floor((p.punchTime.getTime() - officialCheckOut.getTime()) / 60_000)
            : 0;

        rec.checkOut = p.punchTime;
        rec.lunchStart = null;
        rec.lunchEnd = null;
        rec.overtimeMinutes = totalOvertimeMinutes;
        rec.overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
        rec.overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);

        if (!rec._isNew && rec.id) {
          toUpdate.set(rec.id, rec);
        }
        processed++;
      }
      continue;
    }

    // 3. INICIO DE REFRIGERIO (Dentro de la ventana configurada)
    if (totalMinutes >= lunchStartMin && totalMinutes <= lunchEndMax) {
      const rec = ensureDayRecord();

      if (!rec.lunchStart || p.punchTime < new Date(rec.lunchStart)) {
        rec.lunchStart = p.punchTime;
        if (!rec._isNew && rec.id) {
          toUpdate.set(rec.id, rec);
        }
        processed++;
      }
      continue;
    }

    // 4. RETORNO DE REFRIGERIO (Entre fin de ventana de salida y límite de retorno)
    if (totalMinutes > lunchEndMax && totalMinutes <= lunchReturnMax) {
      if (record && record.lunchStart && !record.lunchEnd) {
        const diffFromStartMs = p.punchTime.getTime() - new Date(record.lunchStart).getTime();
        if (diffFromStartMs >= 5 * 60_000) {
          record.lunchEnd = p.punchTime;
          if (!record._isNew && record.id) {
            toUpdate.set(record.id, record);
          }
          processed++;
        }
      }
      continue;
    }

    // 5. SALIDA (A partir de biometricCheckOutStart en adelante)
    if (totalMinutes >= checkOutMinWeekday) {
      const rec = ensureDayRecord();
      const lunchDurationMinutes = company.lunchDurationMinutes ?? 60;
      const lunchDays = Array.isArray(company.lunchDays)
        ? company.lunchDays
        : [1, 2, 3, 4, 5];
      const hasLunchToday = lunchDays.includes(dayOfWeek);

      if (rec.lunchStart && !rec.lunchEnd) {
        rec.lunchEnd = new Date(
          new Date(rec.lunchStart).getTime() + lunchDurationMinutes * 60_000
        );
      }

      if (!rec.checkOut || p.punchTime < new Date(rec.checkOut)) {
        const effectiveDayHours = user.payrollPolicy?.hoursPerDay || 8.0;
        const lunchMinutesToday = hasLunchToday ? lunchDurationMinutes : 0;

        const expectedStart = buildPeruDateTime(p.dayKey, workHour, workMin);
        const officialCheckOut = new Date(
          expectedStart.getTime() +
            (Math.round(effectiveDayHours * 60) + lunchMinutesToday) * 60_000
        );

        const totalOvertimeMinutes =
          p.punchTime > officialCheckOut
            ? Math.floor((p.punchTime.getTime() - officialCheckOut.getTime()) / 60_000)
            : 0;

        rec.checkOut = p.punchTime;
        rec.overtimeMinutes = totalOvertimeMinutes;
        rec.overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
        rec.overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);

        if (!rec._isNew && rec.id) {
          toUpdate.set(rec.id, rec);
        }
        processed++;
      }
    }
  }

  if (options.saveUnmatched !== false && unmatchedToSave.length > 0) {
    const existingUnmatched = await prisma.unmatchedBiometricLog.findMany({
      where: {
        resolved: false,
        rawCode: { in: unmatchedToSave.map((u) => u.rawCode) },
      },
      select: { rawCode: true, punchTime: true },
    });

    const existingKeys = new Set(
      existingUnmatched.map((e) => `${e.rawCode}|${e.punchTime.toISOString()}`)
    );

    const deduplicatedUnmatched = unmatchedToSave.filter(
      (u) => !existingKeys.has(`${u.rawCode}|${u.punchTime.toISOString()}`)
    );

    if (deduplicatedUnmatched.length > 0) {
      await prisma.unmatchedBiometricLog.createMany({
        data: deduplicatedUnmatched,
      });
    }
  }

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

  return {
    processed,
    errors: Array.from(errorsSet),
  };
}