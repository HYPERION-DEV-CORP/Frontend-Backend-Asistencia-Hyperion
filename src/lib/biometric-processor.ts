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

export async function processBiometricPunches(
  parsedPunches: BiometricPunchInput[],
  options: { saveUnmatched?: boolean } = { saveUnmatched: true }
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
    const methodLabel = p.method === 'PRESENTIAL_NFC' ? 'Tarjeta RFID' : 'Huella';

    // A) Primera marcación del día -> CHECK_IN
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
        record.checkIn = p.punchTime;
        record.type = p.method;
        record.status = status;
        record.lateMinutes = lateMinutes;
        record.observations = `Sincronizado desde Biométrico - ${methodLabel} (${p.serialNo})`;
        toUpdate.set(record.id, record);
      } else {
        const newRec = {
          userId: user.id,
          date: p.dayDate,
          checkIn: p.punchTime,
          lunchStart: null as Date | null,
          lunchEnd: null as Date | null,
          checkOut: null as Date | null,
          type: p.method,
          status,
          lateMinutes,
          overtimeMinutes: 0,
          overtime25Minutes: 0,
          overtime35Minutes: 0,
          latitude: company.officeLat,
          longitude: company.officeLng,
          employeeSignature: user.signatureBase64 || null,
          observations: `Sincronizado desde Biométrico - ${methodLabel} (${p.serialNo})`,
          _isNew: true,
        };
        recordMap.set(mapKey, newRec);
        toCreate.push(newRec);
      }

      processed++;
      continue;
    }

    // B) Marcaciones siguientes del día -> CHECK_OUT + Refrigerio + HE
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