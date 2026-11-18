// src/app/api/v1/attendance/today/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const record = await prisma.attendanceRecord.findFirst({
      where: {
        userId: user.id,
        date: today,
      },
    });

    return NextResponse.json({
      success: true,
      record: record || null,
      companyConfig: {
        lunchWindowStart: user.company.lunchWindowStart ?? '13:00',
        lunchWindowEnd: user.company.lunchWindowEnd ?? '13:30',
        lunchDurationMinutes: user.company.lunchDurationMinutes ?? 60,
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