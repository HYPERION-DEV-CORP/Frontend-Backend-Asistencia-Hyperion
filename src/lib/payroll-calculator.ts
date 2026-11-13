import { prisma } from '@/lib/prisma';

export async function calculatePayrollForPeriod(periodId?: string | null) {
  let dateFilter: { gte?: Date; lte?: Date } | undefined = undefined;
  let periodInfo = null;

  // 1. Si se envía periodId, buscar el rango de fechas exacto del corte
  if (periodId) {
    const period = await prisma.payrollPeriod.findUnique({
      where: { id: periodId },
    });

    if (period) {
      periodInfo = period;
      dateFilter = {
        gte: period.startDate,
        lte: period.endDate,
      };
    }
  } else {
    // Si no se envía periodId, tomar el período abierto más reciente por defecto
    const latestPeriod = await prisma.payrollPeriod.findFirst({
      orderBy: { startDate: 'desc' },
    });

    if (latestPeriod) {
      periodInfo = latestPeriod;
      dateFilter = {
        gte: latestPeriod.startDate,
        lte: latestPeriod.endDate,
      };
    }
  }

  // 2. Obtener usuarios activos (excluyendo administradores externos si aplica, o incluyendo todos)
  const users = await prisma.user.findMany({
    include: {
      payrollPolicy: true,
      attendanceRecords: {
        where: dateFilter ? { date: dateFilter } : undefined,
      },
    },
    orderBy: { lastName: 'asc' },
  });

  // 3. Calcular liquidación individual
  const payroll = users.map((user) => {
    const policy = user.payrollPolicy;
    const daysInMonth = policy?.daysInMonth || 30;
    const hoursPerDay = policy?.hoursPerDay || 8.0;
    const rate25 = policy?.overtimeFirst2HoursRate || 1.25;
    const rate35 = policy?.overtimeNextHoursRate || 1.35;

    // Tarifa por hora y por minuto según régimen (Ley 728: Sueldo / 30 / 8)
    const hourlyRate = user.baseSalary > 0 ? user.baseSalary / daysInMonth / hoursPerDay : 0;
    const minuteRate = hourlyRate / 60;

    // Sumar minutos acumulados en el período
    let totalLateMinutes = 0;
    let totalOvertime25Minutes = 0;
    let totalOvertime35Minutes = 0;
    let workedDays = 0;

    for (const rec of user.attendanceRecords) {
      if (rec.checkIn) workedDays++;
      totalLateMinutes += rec.lateMinutes || 0;
      totalOvertime25Minutes += rec.overtime25Minutes || 0;
      totalOvertime35Minutes += rec.overtime35Minutes || 0;
    }

    // Cálculo monetario
    const lateDiscount = totalLateMinutes * minuteRate;
    const payOvertime25 = (totalOvertime25Minutes / 60) * hourlyRate * rate25;
    const payOvertime35 = (totalOvertime35Minutes / 60) * hourlyRate * rate35;
    const totalOvertimePay = payOvertime25 + payOvertime35;

    const netSalary = Math.max(0, user.baseSalary - lateDiscount + totalOvertimePay);

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
      totalOvertime25Minutes,
      totalOvertime35Minutes,
      lateDiscount,
      totalOvertimePay,
      netSalary,
    };
  });

  return { payroll, period: periodInfo };
}