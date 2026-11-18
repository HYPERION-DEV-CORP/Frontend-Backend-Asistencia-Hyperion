// src/app/api/v1/hr/payroll/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const SATURDAY_WORK_HOURS = 4.5; // Sábados: 9:00 AM a 1:30 PM (4 horas y 30 minutos)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const periodId = searchParams.get('periodId');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');

    let dateFilter = {};
    let permDateFilter = {};
    let periodLabel = 'Consolidado General';
    let periodDetails = null;

    if (periodId) {
      const selectedPeriod = await prisma.payrollPeriod.findUnique({
        where: { id: periodId },
      });

      if (selectedPeriod) {
        periodDetails = selectedPeriod;
        periodLabel = selectedPeriod.name;
        const endOfDay = new Date(selectedPeriod.endDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        dateFilter = {
          date: {
            gte: selectedPeriod.startDate,
            lte: endOfDay,
          },
        };
        permDateFilter = {
          startDate: { lte: endOfDay },
          endDate: { gte: selectedPeriod.startDate },
        };
      }
    } else if (monthParam && yearParam) {
      const month = parseInt(monthParam);
      const year = parseInt(yearParam);
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);
      dateFilter = { date: { gte: startDate, lte: endDate } };
      permDateFilter = {
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      };
      periodLabel = `${monthParam}/${yearParam}`;
    }

    const users = await prisma.user.findMany({
      include: {
        company: true,
        payrollPolicy: true,
        attendanceRecords: {
          where: dateFilter,
        },
        permissionsRequest: {
          where: {
            status: 'APPROVED',
            ...permDateFilter,
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

      const dailyRate = baseSalary > 0 ? baseSalary / daysInMonth : 0;
      const hourlyRate = dailyRate > 0 ? dailyRate / hoursPerDay : 0;
      const minuteRate = hourlyRate / 60;

      let totalLateMinutes = 0;
      let totalOvertime25Minutes = 0;
      let totalOvertime35Minutes = 0;
      let absenceDays = 0;
      let absenceHours = 0;

      u.attendanceRecords.forEach((r) => {
        if (r.status === 'ABSENT') {
          const dayOfWeek = new Date(r.date).getUTCDay(); // 0 = Domingo, 6 = Sábado
          if (dayOfWeek === 0) return;

          absenceDays += 1;
          absenceHours += dayOfWeek === 6 ? SATURDAY_WORK_HOURS : hoursPerDay;
          return;
        }

        totalLateMinutes += r.lateMinutes || 0;

        if (
          r.isOvertimeApproved &&
          r.overtimeMinutes &&
          r.overtimeMinutes > 0
        ) {
          totalOvertime25Minutes += r.overtime25Minutes || 0;
          totalOvertime35Minutes += r.overtime35Minutes || 0;
        }
      });

      // 1. Filtrar estrictamente papeletas aprobadas SIN GOCE DE HABER
      const userUnpaidPermissions = (u.permissionsRequest || []).filter((p) =>
        p.reason?.toUpperCase().includes('SIN GOCE')
      );

      // 2. Calcular minutos no remunerados según la jornada real del día (L-V: 8h + 1h ref | Sáb: 4.5h continuo)
      let unpaidLeaveMinutes = 0;
      const [workH, workM] = (u.workStartTime || '09:00').split(':').map(Number);
      const shiftStartMins = workH * 60 + workM;

      for (const perm of userUnpaidPermissions) {
        const pStart = new Date(perm.startDate);
        const pEnd = new Date(perm.endDate);

        // Convertir límites a hora local Perú (UTC-5)
        const peruStart = new Date(pStart.getTime() - 5 * 60 * 60 * 1000);
        const peruEnd = new Date(pEnd.getTime() - 5 * 60 * 60 * 1000);

        const startDayStr = peruStart.toISOString().split('T')[0];
        const endDayStr = peruEnd.toISOString().split('T')[0];

        const cursor = new Date(`${startDayStr}T00:00:00.000Z`);
        const limit = new Date(`${endDayStr}T00:00:00.000Z`);

        while (cursor <= limit) {
          const dayOfWeek = cursor.getUTCDay();
          const cursorStr = cursor.toISOString().split('T')[0];
          const inPeriodStart =
            !periodDetails || cursor >= new Date(periodDetails.startDate);
          const inPeriodEnd =
            !periodDetails ||
            cursor <=
              new Date(
                new Date(periodDetails.endDate).setUTCHours(23, 59, 59, 999)
              );

          // Domingos (0) no son laborables
          if (dayOfWeek !== 0 && inPeriodStart && inPeriodEnd) {
            const isSaturday = dayOfWeek === 6;
            const dayWorkHours = isSaturday ? SATURDAY_WORK_HOURS : hoursPerDay;
            const lunchDurationMins = isSaturday ? 0 : 60;
            const shiftEndMins =
              shiftStartMins + dayWorkHours * 60 + lunchDurationMins;

            const attendanceThatDay = u.attendanceRecords.find(
              (r) => new Date(r.date).toISOString().split('T')[0] === cursorStr
            );
            const actuallyWorked = Boolean(
              attendanceThatDay?.checkIn && attendanceThatDay?.checkOut
            );

            if (!actuallyWorked) {
              const dayStartMins =
                cursorStr === startDayStr
                  ? Math.max(
                      shiftStartMins,
                      peruStart.getUTCHours() * 60 + peruStart.getUTCMinutes()
                    )
                  : shiftStartMins;

              const dayEndMins =
                cursorStr === endDayStr
                  ? Math.min(
                      shiftEndMins,
                      peruEnd.getUTCHours() * 60 + peruEnd.getUTCMinutes()
                    )
                  : shiftEndMins;

              if (dayEndMins > dayStartMins) {
                let rawAbsentMins = dayEndMins - dayStartMins;
                if (rawAbsentMins > dayWorkHours * 60) {
                  rawAbsentMins = dayWorkHours * 60;
                }
                unpaidLeaveMinutes += rawAbsentMins;
              }
            }
          }
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }

      // Descuento proporcional por horas efectivas de los días faltados (L-V = 8h, Sáb = 4.5h)
      const absenceDiscount =
        Math.round(absenceHours * hourlyRate * 100) / 100;
      const lateDiscount =
        Math.round(totalLateMinutes * minuteRate * 100) / 100;
      const unpaidLeaveDiscount =
        Math.round(unpaidLeaveMinutes * minuteRate * 100) / 100;
      const overtime25Pay =
        Math.round(totalOvertime25Minutes * (minuteRate * factor25) * 100) /
        100;
      const overtime35Pay =
        Math.round(totalOvertime35Minutes * (minuteRate * factor35) * 100) /
        100;

      const totalOvertimePay =
        Math.round((overtime25Pay + overtime35Pay) * 100) / 100;
      const netSalary = Math.max(
        0,
        Math.round(
          (baseSalary +
            totalOvertimePay -
            lateDiscount -
            unpaidLeaveDiscount -
            absenceDiscount) *
            100
        ) / 100
      );

      return {
        userId: u.id,
        fullName: `${u.name} ${u.lastName}`,
        docType: u.docType || 'DNI',
        dni: u.dni,
        jobTitle: u.jobTitle,
        regimenName: policy?.name || 'Estándar General 728',
        baseSalary,
        dailyRate: Math.round(dailyRate * 100) / 100,
        hourlyRate: Math.round(hourlyRate * 100) / 100,
        minuteRate: Number(minuteRate.toFixed(4)),
        absenceDays,
        absenceHours,
        absenceDiscount,
        totalLateMinutes,
        unpaidLeaveMinutes,
        totalOvertime25Minutes,
        totalOvertime35Minutes,
        lateDiscount,
        unpaidLeaveDiscount,
        overtime25Pay,
        overtime35Pay,
        totalOvertimePay,
        netSalary,
      };
    });

    return NextResponse.json({
      success: true,
      period: periodLabel,
      periodDetails,
      company: users[0]?.company?.name || 'HYPERION DIGITAL SECURITY S.A.C.',
      ruc: users[0]?.company?.ruc || '20608810987',
      payroll: payrollReport,
    });
  } catch (error: any) {
    console.error('❌ Error calculando planilla:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}