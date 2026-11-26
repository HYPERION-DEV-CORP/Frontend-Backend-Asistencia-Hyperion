import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get('companyId');

    const company = companyId
      ? await prisma.company.findUnique({ where: { id: companyId } })
      : await prisma.company.findFirst();

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      companyId: company.id,
      companyName: company.name,
      schedule: {
        biometricCheckInStart: company.biometricCheckInStart,
        biometricCheckInEnd: company.biometricCheckInEnd,
        lunchWindowStart: company.lunchWindowStart,
        lunchWindowEnd: company.lunchWindowEnd,
        lunchReturnEnd: company.lunchReturnEnd,
        lunchDurationMinutes: company.lunchDurationMinutes,
        biometricCheckOutStart: company.biometricCheckOutStart,
        lunchDays: company.lunchDays,
        saturdayWorkHours: company.saturdayWorkHours,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error al obtener configuración horaria' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      companyId,
      biometricCheckInStart,
      biometricCheckInEnd,
      lunchWindowStart,
      lunchWindowEnd,
      lunchReturnEnd,
      lunchDurationMinutes,
      biometricCheckOutStart,
      lunchDays,
      saturdayWorkHours,
    } = body;

    const times = [
      biometricCheckInStart,
      biometricCheckInEnd,
      lunchWindowStart,
      lunchWindowEnd,
      lunchReturnEnd,
      biometricCheckOutStart,
    ];

    if (times.some((t) => !t || !TIME_REGEX.test(t))) {
      return NextResponse.json(
        { error: 'Todas las horas deben tener formato válido HH:mm (ej. 08:30).' },
        { status: 400 }
      );
    }

    if (toMinutes(biometricCheckInStart) >= toMinutes(biometricCheckInEnd)) {
      return NextResponse.json(
        { error: 'El inicio de ingreso debe ser menor al fin de ingreso.' },
        { status: 400 }
      );
    }
    if (toMinutes(biometricCheckInEnd) >= toMinutes(lunchWindowStart)) {
      return NextResponse.json(
        { error: 'El fin de ingreso debe ser anterior al inicio de refrigerio.' },
        { status: 400 }
      );
    }
    if (toMinutes(lunchWindowStart) >= toMinutes(lunchWindowEnd)) {
      return NextResponse.json(
        { error: 'El inicio de refrigerio debe ser menor al límite de salida a refrigerio.' },
        { status: 400 }
      );
    }
    if (toMinutes(lunchWindowEnd) >= toMinutes(lunchReturnEnd)) {
      return NextResponse.json(
        { error: 'El límite de retorno de refrigerio debe ser posterior al inicio de refrigerio.' },
        { status: 400 }
      );
    }
    if (toMinutes(lunchReturnEnd) >= toMinutes(biometricCheckOutStart)) {
      return NextResponse.json(
        { error: 'El límite de retorno de refrigerio debe ser anterior a la hora de salida.' },
        { status: 400 }
      );
    }

    const targetCompany = companyId
      ? await prisma.company.findUnique({ where: { id: companyId } })
      : await prisma.company.findFirst();

    if (!targetCompany) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    const updated = await prisma.company.update({
      where: { id: targetCompany.id },
      data: {
        biometricCheckInStart,
        biometricCheckInEnd,
        lunchWindowStart,
        lunchWindowEnd,
        lunchReturnEnd,
        lunchDurationMinutes: Number(lunchDurationMinutes ?? 60),
        biometricCheckOutStart,
        lunchDays: Array.isArray(lunchDays) ? lunchDays.map(Number) : [1, 2, 3, 4, 5],
        saturdayWorkHours: Number(saturdayWorkHours ?? 4.5),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Franjas horarias del biométrico actualizadas correctamente.',
      schedule: updated,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error al guardar configuración horaria' },
      { status: 500 }
    );
  }
}