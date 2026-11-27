import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function getPeruDayDate(date: Date = new Date()): Date {
  const peruDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dayKey = peruDate.toISOString().slice(0, 10);
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'El parámetro userId es obligatorio' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { dni: userId }] },
      include: { company: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      );
    }

    const today = getPeruDayDate();

    const record = await prisma.attendanceRecord.findFirst({
      where: {
        userId: user.id,
        date: today,
      },
    });

    return NextResponse.json({
      success: true,
      isRemoteAllowed: user.isRemoteAllowed,
      record,
      companyConfig: {
        biometricCheckInStart: user.company.biometricCheckInStart ?? '06:00',
        biometricCheckInEnd: user.company.biometricCheckInEnd ?? '11:59',
        lunchWindowStart: user.company.lunchWindowStart ?? '13:00',
        lunchWindowEnd: user.company.lunchWindowEnd ?? '13:30',
        lunchReturnEnd: user.company.lunchReturnEnd ?? '16:59',
        lunchDurationMinutes: user.company.lunchDurationMinutes ?? 60,
        biometricCheckOutStart: user.company.biometricCheckOutStart ?? '17:00',
        lunchDays: user.company.lunchDays ?? [1, 2, 3, 4, 5],
        saturdayWorkHours: user.company.saturdayWorkHours ?? 4.5,
      },
    });
  } catch (error: any) {
    console.error('❌ Error consultando estado diario de asistencia:', error);
    return NextResponse.json(
      { error: error?.message || 'Error interno al consultar asistencia de hoy' },
      { status: 500 }
    );
  }
}