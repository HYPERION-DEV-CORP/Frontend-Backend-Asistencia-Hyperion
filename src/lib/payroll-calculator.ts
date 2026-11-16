import { prisma } from '@/lib/prisma';

export async function calculatePayrollForPeriod(periodId?: string | null) {
  let dateFilter: { gte?: Date; lte?: Date } | undefined = undefined;
  let permDateFilter: { startDate?: { lte: Date }; endDate?: { gte: Date } } | undefined = undefined;
  let periodInfo = null;

  // 1. Buscar rango exacto del período
  if (periodId) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
    });

    if (period) {
      periodInfo = period;
      const endOfDay = new Date(period.endDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      dateFilter = { gte: period.startDate, lte: endOfDay };
      permDateFilter = { startDate: { lte: endOfDay }, endDate: { gte: period.startDate } };
    }
  } else {
    const latestPeriod = await prisma.payrollPeriod.findFirst({
      orderBy: { startDate: 'desc' },
    });

    if (latestPeriod) {
      periodInfo = latestPeriod;
      const endOfDay = new Date(latestPeriod.endDate);
      endOfDay.setUTCHours(23, 59, 59, 999);
      dateFilter = { gte: latestPeriod.startDate, lte: endOfDay };
      permDateFilter = { startDate: { lte: endOfDay }, endDate: { gte: latestPeriod.startDate } };
    }
  }

  // 2. Consultar usuarios, asistencias y papeletas aprobadas
  const [users, approvedPermissions] = await Promise.all([
    prisma.user.findMany({
      include: {
        payrollPolicy: true,
        attendanceRecords: {
          where: dateFilter ? { date: dateFilter } : undefined,
        },
      },
      orderBy: { lastName: 'asc' },
    }),
    prisma.permissionRequest.findMany({
      where: {
        status: 'APPROVED',
        ...(permDateFilter || {}),
      },
    }),
  ]);

  // 3. Calcular liquidación individual
  const payroll = users.map((user) => {
    const policy = user.payrollPolicy;
    const daysInMonth = policy?.daysInMonth || 30;
    const hoursPerDay = policy?.hoursPerDay || 8.0;
    const rate25 = policy?.overtimeFirst2HoursRate || 1.25;
    const rate35 = policy?.overtimeNextHoursRate || 1.35;

    const hourlyRate = user.baseSalary > 0 ? user.baseSalary / daysInMonth / hoursPerDay : 0;
    const minuteRate = hourlyRate / 60;

    let totalLateMinutes = 0;
    let totalOvertime25Minutes = 0;
    let totalOvertime35Minutes = 0;
    let workedDays = 0;

    for (const rec of user.attendanceRecords) {
      if (rec.checkIn) workedDays++;
      totalLateMinutes += rec.lateMinutes || 0;

      if (rec.isOvertimeApproved && rec.overtimeMinutes > 0) {
        totalOvertime25Minutes += rec.overtime25Minutes || 0;
        totalOvertime35Minutes += rec.overtime35Minutes || 0;
      }
    }

    // Cálculo de Permisos Aprobados SIN GOCE DE HABER (solo días/horas efectivamente no laborados)
    const userUnpaidPermissions = approvedPermissions.filter(
      (p) => p.userId === user.id && p.reason?.toUpperCase().includes('SIN GOCE')
    );

    let unpaidLeaveMinutes = 0;
    const [workH, workM] = (user.workStartTime || '09:00').split(':').map(Number);
    const shiftStartMins = workH * 60 + workM;
    const shiftEndMins = shiftStartMins + hoursPerDay * 60 + 60; // +60 min refrigerio

    for (const perm of userUnpaidPermissions) {
      const peruStart = new Date(new Date(perm.startDate).getTime() - 5 * 60 * 60 * 1000);
      const peruEnd = new Date(new Date(perm.endDate).getTime() - 5 * 60 * 60 * 1000);

      const startDayStr = peruStart.toISOString().split('T')[0];
      const endDayStr = peruEnd.toISOString().split('T')[0];

      const cursor = new Date(`${startDayStr}T00:00:00.000Z`);
      const limit = new Date(`${endDayStr}T00:00:00.000Z`);

      while (cursor <= limit) {
        const cursorStr = cursor.toISOString().split('T')[0];
        const inPeriodStart = !periodInfo || cursor >= new Date(periodInfo.startDate);
        const inPeriodEnd =
          !periodInfo ||
          cursor <= new Date(new Date(periodInfo.endDate).setUTCHours(23, 59, 59, 999));

        if (inPeriodStart && inPeriodEnd) {
          const attendanceThatDay = user.attendanceRecords.find(
            (r) => new Date(r.date).toISOString().split('T')[0] === cursorStr
          );
          const actuallyWorked = Boolean(
            attendanceThatDay?.checkIn && attendanceThatDay?.checkOut
          );

          if (!actuallyWorked) {
            const dayStartMins =
              cursorStr === startDayStr
                ? Math.max(shiftStartMins, peruStart.getUTCHours() * 60 + peruStart.getUTCMinutes())
                : shiftStartMins;

            const dayEndMins =
              cursorStr === endDayStr
                ? Math.min(shiftEndMins, peruEnd.getUTCHours() * 60 + peruEnd.getUTCMinutes())
                : shiftEndMins;

            if (dayEndMins > dayStartMins) {
              let rawAbsentMins = dayEndMins - dayStartMins;
              if (rawAbsentMins > hoursPerDay * 60) {
                rawAbsentMins = hoursPerDay * 60;
              }
              unpaidLeaveMinutes += rawAbsentMins;
            }
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const lateDiscount = Math.round(totalLateMinutes * minuteRate * 100) / 100;
    const unpaidLeaveDiscount = Math.round(unpaidLeaveMinutes * minuteRate * 100) / 100;
    const payOvertime25 = Math.round((totalOvertime25Minutes / 60) * hourlyRate * rate25 * 100) / 100;
    const payOvertime35 = Math.round((totalOvertime35Minutes / 60) * hourlyRate * rate35 * 100) / 100;
    const totalOvertimePay = Math.round((payOvertime25 + payOvertime35) * 100) / 100;

    const netSalary = Math.max(
      0,
      Math.round((user.baseSalary - lateDiscount - unpaidLeaveDiscount + totalOvertimePay) * 100) / 100
    );

    return {
      userId: user.id,
      fullName: `${user.name} ${user.lastName}`,
      docType: user.docType || 'DNI',
      dni: user.dni,
      jobTitle: user.jobTitle,
      regimenName: policy?.name || 'Régimen General 728',
      workedDays,
      baseSalary: user.baseSalary,
      hourlyRate,
      totalLateMinutes,
      unpaidLeaveMinutes,
      totalOvertime25Minutes,
      totalOvertime35Minutes,
      lateDiscount,
      unpaidLeaveDiscount,
      overtime25Pay: payOvertime25,
      overtime35Pay: payOvertime35,
      totalOvertimePay,
      netSalary,
    };
  });

  return { payroll, period: periodInfo };
}