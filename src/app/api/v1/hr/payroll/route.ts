// src/app/api/v1/hr/payroll/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const SATURDAY_WORK_HOURS = 4.5;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const periodId = searchParams.get('periodId');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');

    let periodLabel = 'Consolidado General';
    let periodDetails = null;

    // 1. Ventana Calendario del Mes (Día 1 al 30/31) -> Días trabajados, Domingos, Faltas y Permisos
    let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

    if (periodId) {
      const selectedPeriod = await prisma.payrollPeriod.findUnique({
        where: { id: periodId },
      });

      if (selectedPeriod) {
        periodDetails = selectedPeriod;
        periodLabel = selectedPeriod.name;
        monthStart = new Date(selectedPeriod.startDate);
        monthEnd = new Date(selectedPeriod.endDate);
        monthEnd.setUTCHours(23, 59, 59, 999);
      }
    } else if (monthParam && yearParam) {
      const month = parseInt(monthParam);
      const year = parseInt(yearParam);
      monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      periodLabel = `${monthParam.padStart(2, '0')}/${yearParam}`;
    }

    // 2. Ventana de Corte (Día 28 del mes anterior al 27 del mes actual) -> Tardanzas y Horas Extras
    const refYear = monthStart.getUTCFullYear();
    const refMonth = monthStart.getUTCMonth(); // 0-11
    const cutoffStart = new Date(Date.UTC(refYear, refMonth - 1, 28, 0, 0, 0));
    const cutoffEnd = new Date(Date.UTC(refYear, refMonth, 27, 23, 59, 59, 999));

    // Rango amplio para traer asistencias de ambas ventanas en una sola consulta
    const queryStart = cutoffStart < monthStart ? cutoffStart : monthStart;
    const queryEnd = monthEnd > cutoffEnd ? monthEnd : cutoffEnd;

    // Contar días calendario y domingos del mes seleccionado
    let totalCalendarDays = 0;
    let totalSundaysInMonth = 0;
    const dayCursor = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), monthStart.getUTCDate()));
    const dayLimit = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth(), monthEnd.getUTCDate()));

    while (dayCursor <= dayLimit) {
      totalCalendarDays++;
      if (dayCursor.getUTCDay() === 0) totalSundaysInMonth++;
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }

    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: {
        company: true,
        payrollPolicy: true,
        attendanceRecords: {
          where: {
            date: { gte: queryStart, lte: queryEnd },
          },
        },
        permissionsRequest: {
          where: {
            status: 'APPROVED',
            startDate: { lte: monthEnd },
            endDate: { gte: monthStart },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const payrollReport = users.map((u) => {
      const baseSalary = u.baseSalary || 0;
      const policy = u.payrollPolicy;
      const daysInMonth = policy?.daysInMonth || 30;
      const hoursPerDay = policy?.hoursPerDay || 8.0;
      const factor25 = policy?.overtimeFirst2HoursRate || 1.25;
      const factor35 = policy?.overtimeNextHoursRate || 1.35;
      const pensionRate = u.pensionRate ?? 13.0; // 13% AFP/ONP

      const dailyRate = baseSalary > 0 ? baseSalary / daysInMonth : 0;
      const hourlyRate = dailyRate > 0 ? dailyRate / hoursPerDay : 0;
      const minuteRate = hourlyRate / 60;

      // Registros dentro del mes calendario (1 al 30/31)
      const monthRecords = u.attendanceRecords.filter((r) => {
        const d = new Date(r.date);
        return d >= monthStart && d <= monthEnd;
      });

      // Registros dentro del corte (28 mes anterior al 27 mes actual)
      const cutoffRecords = u.attendanceRecords.filter((r) => {
        const d = new Date(r.date);
        return d >= cutoffStart && d <= cutoffEnd;
      });

      let workedDays = 0;
      let absenceDays = 0;

      if (!u.isSubjectToSupervision) {
        // Personal no fiscalizado: se computa el mes completo (30 días)
        workedDays = daysInMonth - totalSundaysInMonth;
      } else {
        monthRecords.forEach((r) => {
          const dayOfWeek = new Date(r.date).getUTCDay();
          if (dayOfWeek === 0) return; // Domingo se computa como descanso semanal

          if (r.status === 'ABSENT') {
            absenceDays += 1;
          } else if (
            (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HOLIDAY') &&
            (r.checkIn || r.status === 'HOLIDAY')
          ) {
            workedDays += 1;
          }
        });
      }

      // Cálculo de Tardanzas y Horas Extras SOLO en ventana de corte (28 prev - 27 actual)
      let totalLateMinutes = 0;
      let totalOvertime25Minutes = 0;
      let totalOvertime35Minutes = 0;

      cutoffRecords.forEach((r) => {
        if (r.status === 'ABSENT') return; // Las faltas NO entran en el corte 28-27
        totalLateMinutes += r.lateMinutes || 0;

        if (r.isOvertimeApproved && r.overtimeMinutes && r.overtimeMinutes > 0) {
          totalOvertime25Minutes += r.overtime25Minutes || 0;
          totalOvertime35Minutes += r.overtime35Minutes || 0;
        }
      });

      // Permisos aprobados SIN GOCE DE HABER dentro del mes calendario
      const userUnpaidPermissions = (u.permissionsRequest || []).filter((p) =>
        p.reason?.toUpperCase().includes('SIN GOCE')
      );

      let unpaidLeaveMinutes = 0;
      const [workH, workM] = (u.workStartTime || '09:00').split(':').map(Number);
      const shiftStartMins = workH * 60 + workM;

      for (const perm of userUnpaidPermissions) {
        const peruStart = new Date(new Date(perm.startDate).getTime() - 5 * 60 * 60 * 1000);
        const peruEnd = new Date(new Date(perm.endDate).getTime() - 5 * 60 * 60 * 1000);

        const startDayStr = peruStart.toISOString().split('T')[0];
        const endDayStr = peruEnd.toISOString().split('T')[0];

        const cursor = new Date(`${startDayStr}T00:00:00.000Z`);
        const limit = new Date(`${endDayStr}T00:00:00.000Z`);

        while (cursor <= limit) {
          const dayOfWeek = cursor.getUTCDay();
          const cursorStr = cursor.toISOString().split('T')[0];

          if (dayOfWeek !== 0 && cursor >= monthStart && cursor <= monthEnd) {
            const isSaturday = dayOfWeek === 6;
            const dayWorkHours = isSaturday ? SATURDAY_WORK_HOURS : hoursPerDay;
            const lunchDurationMins = isSaturday ? 0 : 60;
            const shiftEndMins = shiftStartMins + dayWorkHours * 60 + lunchDurationMins;

            const attendanceThatDay = monthRecords.find(
              (r) => new Date(r.date).toISOString().split('T')[0] === cursorStr
            );
            const actuallyWorked = Boolean(attendanceThatDay?.checkIn && attendanceThatDay?.checkOut);

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
                const rawAbsentMins = Math.min(dayEndMins - dayStartMins, dayWorkHours * 60);
                unpaidLeaveMinutes += rawAbsentMins;
              }
            }
          }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      // Días computables pagados: Días trabajados + Domingos (tope 30 días comerciales en Perú)
      const computableDays = Math.min(daysInMonth, workedDays + totalSundaysInMonth);
      const earnedBaseSalary = Math.round(computableDays * dailyRate * 100) / 100;

      const lateDiscount = Math.round(totalLateMinutes * minuteRate * 100) / 100;
      const unpaidLeaveDiscount = Math.round(unpaidLeaveMinutes * minuteRate * 100) / 100;
      const overtime25Pay = Math.round(totalOvertime25Minutes * (minuteRate * factor25) * 100) / 100;
      const overtime35Pay = Math.round(totalOvertime35Minutes * (minuteRate * factor35) * 100) / 100;
      const totalOvertimePay = Math.round((overtime25Pay + overtime35Pay) * 100) / 100;

      // Remuneración Bruta Computable
      const grossSalary = Math.max(
        0,
        Math.round((earnedBaseSalary + totalOvertimePay - lateDiscount - unpaidLeaveDiscount) * 100) / 100
      );

      // Descuento AFP / ONP (13% sobre remuneración bruta)
      const pensionDiscount = Math.round(grossSalary * (pensionRate / 100) * 100) / 100;

      // Neto a Pagar
      const netSalary = Math.max(0, Math.round((grossSalary - pensionDiscount) * 100) / 100);

      return {
        userId: u.id,
        fullName: `${u.name} ${u.lastName}`,
        docType: u.docType || 'DNI',
        dni: u.dni,
        jobTitle: u.jobTitle,
        regimenName: policy?.name || 'Estándar General 728',
        pensionSystem: u.pensionSystem || 'AFP',
        pensionRate,
        baseSalary,
        dailyRate: Math.round(dailyRate * 100) / 100,
        hourlyRate: Math.round(hourlyRate * 100) / 100,
        workedDays,
        sundaysCount: totalSundaysInMonth,
        computableDays,
        absenceDays,
        earnedBaseSalary,
        totalLateMinutes,
        unpaidLeaveMinutes,
        totalOvertime25Minutes,
        totalOvertime35Minutes,
        lateDiscount,
        unpaidLeaveDiscount,
        overtime25Pay,
        overtime35Pay,
        totalOvertimePay,
        grossSalary,
        pensionDiscount,
        netSalary,
      };
    });

    return NextResponse.json({
      success: true,
      period: periodLabel,
      periodDetails,
      cutoffRange: {
        start: cutoffStart.toISOString().split('T')[0],
        end: cutoffEnd.toISOString().split('T')[0],
      },
      company: users[0]?.company?.name || 'HYPERION DIGITAL SECURITY S.A.C.',
      ruc: users[0]?.company?.ruc || '20608810987',
      payroll: payrollReport,
    });
  } catch (error: any) {
    console.error('❌ Error calculando planilla:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}