// src/app/api/v1/auth/forgot-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const identifier = (body.identifier || body.email || body.dni || '').trim();

    if (!identifier) {
      return NextResponse.json(
        { error: 'Ingresa tu DNI o correo electrónico registrado.' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ dni: identifier }, { email: identifier.toLowerCase() }],
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'No existe ninguna cuenta asociada a ese DNI o correo.' },
        { status: 404 }
      );
    }

    // Generar código OTP numérico de 6 dígitos válido por 15 minutos
    const otpCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: otpCode,
        resetTokenExpiresAt: expiresAt,
      },
    });

    // Si tienes RESEND_API_KEY en .env, envía el correo real por HTTPS (sin dependencias extra)
    if (process.env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'Hyperion Asistencia <no-reply@hyperion.pe>',
          to: [user.email],
          subject: 'Código de recuperación de contraseña - Hyperion',
          html: `<p>Hola <b>${user.name}</b>,</p><p>Tu código de verificación para restablecer tu contraseña es:</p><h2 style="letter-spacing:4px;">${otpCode}</h2><p>Este código expira en 15 minutos.</p>`,
        }),
      }).catch((e) => console.error('Error enviando correo Resend:', e));
    }

    // Enmascarar correo para mostrar en pantalla (ej: j***@hyperion.pe)
    const [localPart, domain] = user.email.split('@');
    const maskedEmail = `${localPart.slice(0, 2)}***@${domain}`;

    return NextResponse.json({
      success: true,
      message: `Hemos enviado un código de 6 dígitos a ${maskedEmail}.`,
      maskedEmail,
      // Si no hay proveedor de correo configurado aún, devuelve devCode para pruebas
      ...(!process.env.RESEND_API_KEY ? { devCode: otpCode } : {}),
    });
  } catch (error: any) {
    console.error('❌ Error en forgot-password:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}