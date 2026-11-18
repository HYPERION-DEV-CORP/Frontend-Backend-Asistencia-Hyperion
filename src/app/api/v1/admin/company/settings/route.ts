// src/app/api/v1/admin/company/settings/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      settings: {
        id: company.id,
        name: company.name,
        ruc: company.ruc,
        lunchWindowStart: company.lunchWindowStart,
        lunchWindowEnd: company.lunchWindowEnd,
        lunchDurationMinutes: company.lunchDurationMinutes,
        lunchDays: company.lunchDays,
        saturdayWorkHours: company.saturdayWorkHours,
        officeLat: company.officeLat,
        officeLng: company.officeLng,
        radiusM: company.radiusM,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      lunchWindowStart,
      lunchWindowEnd,
      lunchDurationMinutes,
      lunchDays,
      saturdayWorkHours,
      officeLat,
      officeLng,
      radiusM,
    } = body;

    const adminId = req.headers.get('x-auth-user-id') || body.adminId;
    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    // Validación legal Perú: refrigerio mínimo 45 minutos (Art. 7 D.S. N° 007-2002-TR)
    const duration = Number(lunchDurationMinutes);
    if (isNaN(duration) || duration < 45 || duration > 180) {
      return NextResponse.json(
        { error: 'La duración del refrigerio debe estar entre 45 y 180 minutos (D.S. N° 007-2002-TR).' },
        { status: 400 }
      );
    }

    if (!lunchWindowStart || !lunchWindowEnd || lunchWindowStart >= lunchWindowEnd) {
      return NextResponse.json(
        { error: 'La hora de inicio de ventana debe ser anterior a la hora límite de salida.' },
        { status: 400 }
      );
    }

    const updated = await prisma.company.update({
      where: { id: company.id },
      data: {
        lunchWindowStart,
        lunchWindowEnd,
        lunchDurationMinutes: duration,
        lunchDays: Array.isArray(lunchDays) ? lunchDays.map(Number) : [1, 2, 3, 4, 5],
        saturdayWorkHours: saturdayWorkHours !== undefined ? Number(saturdayWorkHours) : company.saturdayWorkHours,
        officeLat: officeLat !== undefined ? Number(officeLat) : company.officeLat,
        officeLng: officeLng !== undefined ? Number(officeLng) : company.officeLng,
        radiusM: radiusM !== undefined ? Number(radiusM) : company.radiusM,
      },
    });

    if (adminId) {
      const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
      await prisma.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'COMPANY_SETTINGS',
          entityId: company.id,
          action: 'UPDATE_LUNCH_AND_SHIFT_POLICY',
          previousValue: `Ventana: ${company.lunchWindowStart}-${company.lunchWindowEnd} (${company.lunchDurationMinutes}m)`,
          newValue: `Ventana: ${updated.lunchWindowStart}-${updated.lunchWindowEnd} (${updated.lunchDurationMinutes}m), Sáb: ${updated.saturdayWorkHours}h`,
          reason: 'Actualización de parámetros corporativos de refrigerio y jornada',
          ipAddress,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Configuración corporativa actualizada con éxito.',
      settings: updated,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}