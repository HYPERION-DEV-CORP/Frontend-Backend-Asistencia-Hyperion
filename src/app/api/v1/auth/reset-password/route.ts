// src/app/api/v1/auth/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = (body.identifier || body.email || body.dni || '').trim();
    const { code, newPassword } = body;

    if (!identifier || !code || !newPassword) {
      return NextResponse.json(
        { error: 'Todos los campos son obligatorios.' },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'La nueva contraseña debe tener al menos 6 caracteres.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ dni: identifier }, { email: identifier.toLowerCase() }],
      },
    });

    if (
      !user ||
      !user.resetToken ||
      user.resetToken !== String(code).trim() ||
      !user.resetTokenExpiresAt ||
      new Date() > user.resetTokenExpiresAt
    ) {
      return NextResponse.json(
        { error: 'El código ingresado es inválido o ya expiró.' },
        { status: 400 }
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        resetToken: null,
        resetTokenExpiresAt: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        performedById: user.id,
        entity: 'AUTH',
        entityId: user.id,
        action: 'RESET_PASSWORD_OTP',
        reason: 'Restablecimiento de contraseña mediante código de recuperación',
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Contraseña restablecida con éxito. Ya puedes iniciar sesión.',
    });
  } catch (error: any) {
    console.error('❌ Error en reset-password:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}