// src/app/api/v1/user/signature/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId es obligatorio' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, signatureBase64: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      hasSignature: Boolean(user.signatureBase64),
      signatureBase64: user.signatureBase64,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, signatureBase64 } = body;

    if (!userId || !signatureBase64 || typeof signatureBase64 !== 'string') {
      return NextResponse.json(
        { error: 'Se requiere userId y una firma digital válida en Base64.' },
        { status: 400 }
      );
    }

    // Validación mínima de longitud para evitar lienzos en blanco
    const cleanBase64 = signatureBase64.replace(/^data:image\/\w+;base64,/, '').trim();
    if (cleanBase64.length < 100) {
      return NextResponse.json(
        { error: 'El trazo de la firma es demasiado corto o está vacío.' },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { signatureBase64: cleanBase64 },
      select: { id: true, dni: true, name: true, lastName: true },
    });

    await prisma.auditLog.create({
      data: {
        performedById: updated.id,
        entity: 'USER_SIGNATURE',
        entityId: updated.id,
        action: 'UPDATE_PROFILE_SIGNATURE',
        reason: 'Trabajador configuró/actualizó su firma digital desde la aplicación móvil',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Firma digital guardada en tu perfil correctamente.',
    });
  } catch (error: any) {
    console.error('❌ Error guardando firma de perfil:', error);
    return NextResponse.json({ error: error.message || 'Error al guardar firma' }, { status: 500 });
  }
}