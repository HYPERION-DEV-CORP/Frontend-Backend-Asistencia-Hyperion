// src/app/api/v1/reports/payroll-excel/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import ExcelJS from 'exceljs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const periodId = searchParams.get('periodId');
    const monthParam = searchParams.get('month');
    const yearParam = searchParams.get('year');

    let fileSuffix = `${yearParam || 'Consolidado'}_${monthParam || 'General'}`;
    let monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59, 999);

    if (periodId) {
      const selectedPeriod = await prisma.payrollPeriod.findUnique({
        where: { id: periodId },
      });

      if (selectedPeriod) {
        monthStart = new Date(selectedPeriod.startDate);
        monthEnd = new Date(selectedPeriod.endDate);
        monthEnd.setUTCHours(23, 59, 59, 999);
        fileSuffix = selectedPeriod.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      }
    } else if (monthParam && yearParam) {
      const month = parseInt(monthParam);
      const year = parseInt(yearParam);
      monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    }

    const refYear = monthStart.getUTCFullYear();
    const refMonth = monthStart.getUTCMonth();
    const cutoffStart = new Date(Date.UTC(refYear, refMonth - 1, 28, 0, 0, 0));
    const cutoffEnd = new Date(Date.UTC(refYear, refMonth, 27, 23, 59, 59, 999));

    const queryStart = cutoffStart < monthStart ? cutoffStart : monthStart;
    const queryEnd = monthEnd > cutoffEnd ? monthEnd : cutoffEnd;

    let totalSundaysInMonth = 0;
    const dayCursor = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), monthStart.getUTCDate()));
    const dayLimit = new Date(Date.UTC(monthEnd.getUTCFullYear(), monthEnd.getUTCMonth(), monthEnd.getUTCDate()));
    while (dayCursor <= dayLimit) {
      if (dayCursor.getUTCDay() === 0) totalSundaysInMonth++;
      dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
    }

    const users = await prisma.user.findMany({
      where: { isActive: true },
      include: {
        company: true,
        payrollPolicy: true,
        attendanceRecords: {
          where: { date: { gte: queryStart, lte: queryEnd } },
        },
      },
      orderBy: { name: 'asc' },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pre-Nómina Mensual');

    worksheet.columns = [
      { header: 'DNI', key: 'dni', width: 12 },
      { header: 'Trabajador', key: 'worker', width: 28 },
      { header: 'Cargo / Puesto', key: 'jobTitle', width: 22 },
      { header: 'Sueldo Base (S/)', key: 'baseSalary', width: 16 },
      { header: 'Días Trab.', key: 'workedDays', width: 12 },
      { header: 'Domingos', key: 'sundaysCount', width: 12 },
      { header: 'Días Comp.', key: 'computableDays', width: 12 },
      { header: 'Haber Ganado (S/)', key: 'earnedBaseSalary', width: 18 },
      { header: 'Desc. Tardanza (S/)', key: 'lateDiscount', width: 18 },
      { header: 'Total H.E. (S/)', key: 'totalOvertimePay', width: 16 },
      { header: 'Bruto Comp. (S/)', key: 'grossSalary', width: 17 },
      { header: 'AFP/ONP 13% (S/)', key: 'pensionDiscount', width: 18 },
      { header: 'Neto a Pagar (S/)', key: 'netSalary', width: 18 },
    ];

    users.forEach((u) => {
      const policy = u.payrollPolicy;
      const baseSalary = u.baseSalary || 0;
      const daysInMonth = policy?.daysInMonth || 30;
      const hoursPerDay = policy?.hoursPerDay || 8.0;
      const factor25 = policy?.overtimeFirst2HoursRate || 1.25;
      const factor35 = policy?.overtimeNextHoursRate || 1.35;
      const pensionRate = u.pensionRate ?? 13.0;

      const dailyRate = baseSalary > 0 ? baseSalary / daysInMonth : 0;
      const hourlyRate = dailyRate > 0 ? dailyRate / hoursPerDay : 0;
      const minuteRate = hourlyRate / 60;

      const monthRecords = u.attendanceRecords.filter((r) => {
        const d = new Date(r.date);
        return d >= monthStart && d <= monthEnd;
      });

      const cutoffRecords = u.attendanceRecords.filter((r) => {
        const d = new Date(r.date);
        return d >= cutoffStart && d <= cutoffEnd;
      });

      let workedDays = 0;
      if (!u.isSubjectToSupervision) {
        workedDays = daysInMonth - totalSundaysInMonth;
      } else {
        monthRecords.forEach((r) => {
          if (new Date(r.date).getUTCDay() === 0) return;
          if (
            (r.status === 'PRESENT' || r.status === 'LATE' || r.status === 'HOLIDAY') &&
            (r.checkIn || r.status === 'HOLIDAY')
          ) {
            workedDays += 1;
          }
        });
      }

      let totalLateMinutes = 0;
      let totalOvertime25Minutes = 0;
      let totalOvertime35Minutes = 0;

      cutoffRecords.forEach((r) => {
        if (r.status === 'ABSENT') return;
        totalLateMinutes += r.lateMinutes || 0;
        if (r.isOvertimeApproved && r.overtimeMinutes && r.overtimeMinutes > 0) {
          totalOvertime25Minutes += r.overtime25Minutes || 0;
          totalOvertime35Minutes += r.overtime35Minutes || 0;
        }
      });

      const computableDays = Math.min(daysInMonth, workedDays + totalSundaysInMonth);
      const earnedBaseSalary = Math.round(computableDays * dailyRate * 100) / 100;
      const lateDiscount = Math.round(totalLateMinutes * minuteRate * 100) / 100;
      const overtime25Pay = Math.round(totalOvertime25Minutes * (minuteRate * factor25) * 100) / 100;
      const overtime35Pay = Math.round(totalOvertime35Minutes * (minuteRate * factor35) * 100) / 100;
      const totalOvertimePay = Math.round((overtime25Pay + overtime35Pay) * 100) / 100;
      const grossSalary = Math.max(
        0,
        Math.round((earnedBaseSalary + totalOvertimePay - lateDiscount) * 100) / 100
      );
      const pensionDiscount = Math.round(grossSalary * (pensionRate / 100) * 100) / 100;
      const netSalary = Math.max(0, Math.round((grossSalary - pensionDiscount) * 100) / 100);

      const row = worksheet.addRow({
        dni: u.dni,
        worker: `${u.name} ${u.lastName}`,
        jobTitle: u.jobTitle,
        baseSalary,
        workedDays,
        sundaysCount: totalSundaysInMonth,
        computableDays,
        earnedBaseSalary,
        lateDiscount,
        totalOvertimePay,
        grossSalary,
        pensionDiscount,
        netSalary,
      });

      [
        'baseSalary',
        'earnedBaseSalary',
        'lateDiscount',
        'totalOvertimePay',
        'grossSalary',
        'pensionDiscount',
        'netSalary',
      ].forEach((col) => {
        row.getCell(col).numFmt = '"S/"#,##0.00';
      });
    });

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: users.length + 1, column: 13 },
    };

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '005F87' },
    };

    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=Liquidacion_Planilla_HYPERION_${fileSuffix}.xlsx`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}