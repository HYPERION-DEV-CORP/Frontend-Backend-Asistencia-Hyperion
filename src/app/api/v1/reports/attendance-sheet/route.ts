// src/app/api/v1/reports/attendance-sheet/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DAYS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function formatLimaTime(dateVal: Date | null): string {
  if (!dateVal) return '';
  return new Date(dateVal).toLocaleTimeString('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const periodId = searchParams.get('periodId');
    let month = parseInt(searchParams.get('month') || '');
    let year = parseInt(searchParams.get('year') || '');

    if (!userId) {
      return NextResponse.json({ error: 'userId es obligatorio' }, { status: 400 });
    }

    if (periodId) {
      const period = await prisma.payrollPeriod.findUnique({ where: { id: periodId } });
      if (period) {
        const d = new Date(period.startDate);
        month = d.getUTCMonth() + 1;
        year = d.getUTCFullYear();
      }
    }

    if (!month || !year) {
      const now = new Date();
      month = now.getMonth() + 1;
      year = now.getFullYear();
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { company: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 });
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));

    const [records, monthlySignOff] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: {
          userId,
          date: { gte: startDate, lte: endDate },
        },
      }),
      prisma.monthlyAttendanceSignOff.findUnique({
        where: {
          userId_year_month: { userId, year, month },
        },
      }),
    ]);

    const recordMap = new Map(
      records.map((r) => [new Date(r.date).toISOString().split('T')[0], r])
    );

    const rows = [];
    const cursor = new Date(startDate);

    while (cursor <= endDate) {
      const isoDate = cursor.toISOString().split('T')[0];
      const dayOfWeek = cursor.getUTCDay();
      const isSunday = dayOfWeek === 0;
      const rec = recordMap.get(isoDate);
      const isHoliday = !isSunday && rec?.status === 'HOLIDAY';

      // Regla estricta: Domingos = DESCANSO SEMANAL. Lunes a Sábado = SOLO observación manual del admin (sin autorelleno).
      let observations = '';
      if (isSunday) {
        observations = 'DESCANSO SEMANAL';
      } else if (isHoliday) {
        observations = rec?.tareoObservation || 'FERIADO NO LABORABLE';
      } else if (rec?.tareoObservation) {
        observations = rec.tareoObservation;
      }

      const isRestOrHoliday = isSunday || isHoliday;
      const dailySignature =
        !isRestOrHoliday && rec?.checkIn
          ? rec.employeeSignature || user.signatureBase64 || null
          : null;

      rows.push({
        dayName: DAYS_ES[dayOfWeek],
        dateFormatted: `${cursor.getUTCDate()}/${month}/${year}`,
        isoDate,
        isSunday,
        isHoliday,
        checkIn: isRestOrHoliday ? '-' : formatLimaTime(rec?.checkIn || null),
        lunchStart: isRestOrHoliday ? '-' : formatLimaTime(rec?.lunchStart || null),
        lunchEnd: isRestOrHoliday ? '-' : formatLimaTime(rec?.lunchEnd || null),
        checkOut: isRestOrHoliday ? '-' : formatLimaTime(rec?.checkOut || null),
        dailySignature,
        observations,
      });

      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const monthName = startDate
      .toLocaleDateString('es-PE', { month: 'long', timeZone: 'UTC' })
      .toUpperCase();

    return NextResponse.json({
      success: true,
      header: {
        title: `REGISTRO DE ASISTENCIA - ${monthName} ${year}`,
        companyName: user.company?.name || 'Hyperion Digital Security S.A.C.',
        ruc: user.company?.ruc || '20608810987',
        employeeName: `${user.name} ${user.lastName}`,
        dni: user.dni,
        jobTitle: user.jobTitle,
        year,
        month,
      },
      closingSignOff: {
        closingSignature: monthlySignOff?.closingSignature || null,
        signedAt: monthlySignOff?.signedAt || null,
        hrSignature: monthlySignOff?.hrSignature || null,
      },
      rows,
    });
  } catch (error: any) {
    console.error('❌ Error generando hoja de asistencia:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}