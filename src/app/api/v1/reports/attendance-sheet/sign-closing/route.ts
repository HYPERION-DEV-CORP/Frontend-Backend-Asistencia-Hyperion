// src/app/api/v1/reports/attendance-sheet/sign-closing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, year, month, closingSignature } = body;

    if (!userId || !year || !month || !closingSignature) {
      return NextResponse.json(
        { error: 'Faltan datos obligatorios (userId, year, month, closingSignature).' },
        { status: 400 }
      );
    }

    const cleanClosing = String(closingSignature)
      .replace(/^data:image\/\w+;base64,/, '')
      .trim();

    if (cleanClosing.length < 100) {
      return NextResponse.json(
        { error: 'Debe trazar una firma válida en el recuadro antes de confirmar.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, signatureBase64: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Trabajador no encontrado.' }, { status: 404 });
    }

    // REGLA OBLIGATORIA: La firma de cierre de mes NO puede ser la firma inicial del perfil
    const cleanProfileSig = (user.signatureBase64 || '')
      .replace(/^data:image\/\w+;base64,/, '')
      .trim();

    if (cleanProfileSig && cleanClosing === cleanProfileSig) {
      return NextResponse.json(
        {
          error:
            'No puedes reutilizar la firma inicial de tu perfil. Por favor, dibuja nuevamente tu firma para conformar el Tareo SUNAFIL del mes.',
        },
        { status: 400 }
      );
    }

    const signOff = await prisma.monthlyAttendanceSignOff.upsert({
      where: {
        userId_year_month: {
          userId,
          year: Number(year),
          month: Number(month),
        },
      },
      update: {
        closingSignature: cleanClosing,
        signedAt: new Date(),
      },
      create: {
        userId,
        year: Number(year),
        month: Number(month),
        closingSignature: cleanClosing,
        signedAt: new Date(),
      },
    });

    await prisma.auditLog.create({
      data: {
        performedById: user.id,
        entity: 'MONTHLY_ATTENDANCE_SIGNOFF',
        entityId: signOff.id,
        action: 'SIGN_MONTHLY_TAREO',
        reason: `Trabajador firmó conformidad de Tareo SUNAFIL (${month}/${year})`,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Tareo SUNAFIL mensual firmado y confirmado correctamente.',
      signOff,
    });
  } catch (error: any) {
    console.error('❌ Error firmando cierre mensual:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}