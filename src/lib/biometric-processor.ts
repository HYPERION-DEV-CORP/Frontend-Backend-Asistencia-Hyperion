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

function parseTimeHHMM(
  timeStr: string | null | undefined,
  fallbackH: number,
  fallbackM: number
): [number, number] {
  if (!timeStr || !timeStr.includes(':')) return [fallbackH, fallbackM];
  const [h, m] = timeStr.split(':').map(Number);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
}

/**
 * Extrae día de semana, hora y minutos en hora oficial de Perú (UTC-5),
 * evitando desfases si el servidor en la nube corre en UTC.
 */
function getPeruTimeParts(date: Date) {
  const peruDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dayOfWeek = peruDate.getUTCDay(); // 0 = Dom, 6 = Sáb
  const hour = peruDate.getUTCHours();
  const minute = peruDate.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;
  return { dayOfWeek, hour, minute, totalMinutes };
}

/**
 * Construye un Date en UTC correspondiente a una hora específica (HH:mm) del día Perú (dayKey: YYYY-MM-DD).
 */
function buildPeruDateTime(dayKey: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dayKey}T${hh}:${mm}:00.000-05:00`);
}

export async function processBiometricPunches(
  parsedPunches: BiometricPunchInput[],
  options: { saveUnmatched?: boolean } = { saveUnmatched: true }
) {
  if (parsedPunches.length === 0) {
    return { processed: 0, errors: [] as string[] };
  }

  // Orden cronológico ascendente: garantiza evaluar siempre primero la marcación más temprana
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

    // Ignorar domingos salvo autorización manual de RRHH
    if (isSunday) {
      continue;
    }

    const mapKey = `${user.id}_${p.dayKey}`;
    let record = recordMap.get(mapKey);
    const company = user.company;

    const [workHour, workMin] = parseTimeHHMM(user.workStartTime, 9, 0);
    const methodLabel = p.method === 'PRESENTIAL_NFC' ? 'Tarjeta RFID' : 'Huella';

    // Franjas horarias en minutos desde las 00:00 (Hora Perú)
    const NOON_MINUTES = 12 * 60; // 12:00 PM (720)
    const LUNCH_START_MIN = 13 * 60; // 01:00 PM (780)
    const LUNCH_END_MAX = 13 * 60 + 30; // 01:30 PM (810)
    const CHECKOUT_MIN_WEEKDAY = 17 * 60; // 05:00 PM (1020)

    // Helper interno para asegurar que exista el objeto AttendanceRecord del día
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

    // =========================================================================
    // REGLA 1: ENTRADA (Lunes a Sábado únicamente ANTES de las 12:00 PM)
    // =========================================================================
    if (totalMinutes < NOON_MINUTES) {
      const rec = ensureDayRecord();

      // Si ya existe una entrada previa, conservar siempre la más temprana (más baja)
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

    // =========================================================================
    // REGLA 3: SÁBADOS (>= 12:00 PM) -> SALIDA DIRECTA (SIN REFRIGERIO)
    // =========================================================================
    if (isSaturday) {
      // A partir de las 12:00 PM en sábado se toma como salida
      const rec = ensureDayRecord();

      // Conservar la primera marcación válida de salida (>= 12:00 PM) ante duplicados
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

    // =========================================================================
    // REGLA 2: LUNES A VIERNES - INICIO DE REFRIGERIO (01:00 PM a 01:30 PM)
    // =========================================================================
    if (totalMinutes >= LUNCH_START_MIN && totalMinutes <= LUNCH_END_MAX) {
      const rec = ensureDayRecord();

      // Conservar siempre la primera marcación dentro de 1:00 pm - 1:30 pm ante duplicados
      if (!rec.lunchStart || p.punchTime < new Date(rec.lunchStart)) {
        rec.lunchStart = p.punchTime;
        if (!rec._isNew && rec.id) {
          toUpdate.set(rec.id, rec);
        }
        processed++;
      }
      continue;
    }

    // =========================================================================
    // LUNES A VIERNES - RETORNO DE REFRIGERIO (01:31 PM a 04:59 PM)
    // =========================================================================
    if (totalMinutes > LUNCH_END_MAX && totalMinutes < CHECKOUT_MIN_WEEKDAY) {
      // Solo se registra fin de refrigerio si previamente marcó inicio de refrigerio
      if (record && record.lunchStart && !record.lunchEnd) {
        // Evitar doble lectura inmediata (< 5 minutos después de iniciar refrigerio)
        const diffFromStartMs = p.punchTime.getTime() - new Date(record.lunchStart).getTime();
        if (diffFromStartMs >= 5 * 60_000) {
          record.lunchEnd = p.punchTime;
          if (!record._isNew && record.id) {
            toUpdate.set(record.id, record);
          }
          processed++;
        }
      }
      // Antes de las 5:00 PM nunca se registra como salida en Lunes-Viernes
      continue;
    }

    // =========================================================================
    // REGLA 1B: LUNES A VIERNES - SALIDA (A partir de las 05:00 PM en adelante)
    // =========================================================================
    if (totalMinutes >= CHECKOUT_MIN_WEEKDAY) {
      const rec = ensureDayRecord();
      const lunchDurationMinutes = company.lunchDurationMinutes ?? 60;
      const lunchDays = Array.isArray(company.lunchDays)
        ? company.lunchDays
        : [1, 2, 3, 4, 5];
      const hasLunchToday = lunchDays.includes(dayOfWeek);

      // Si marcó inicio de refrigerio (1:00-1:30 pm) pero olvidó marcar retorno, completarlo automáticamente
      if (rec.lunchStart && !rec.lunchEnd) {
        rec.lunchEnd = new Date(
          new Date(rec.lunchStart).getTime() + lunchDurationMinutes * 60_000
        );
      }

      // Conservar la primera marcación de salida >= 5:00 PM ante duplicados en el reloj
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

  // Persistencia con deduplicación en UnmatchedBiometricLog
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