import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';

const secretKey = new TextEncoder().encode(
  process.env.JWT_SECRET || 'hyperion_super_secret_jwt_key_2026_sunafil'
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Soporta tanto el campo 'dni' (marcador empleados) como 'identifier' (login gerencial)
    const loginInput = (body.identifier || body.dni || '').trim();
    const { password, portal } = body;

    if (!loginInput || !password) {
      return NextResponse.json(
        { error: 'Debe ingresar DNI/Correo y contraseña' },
        { status: 400 }
      );
    }

    // Buscar por DNI o por Email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { dni: loginInput },
          { email: loginInput.toLowerCase() },
        ],
      },
      include: { company: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'El DNI o correo ingresado no está registrado en el sistema' },
        { status: 401 }
      );
    }

    // Si el login se realiza desde el portal administrativo (/login), restringir a ADMIN y HR
    if (portal === 'ADMIN' && user.role !== 'ADMIN' && user.role !== 'HR') {
      return NextResponse.json(
        { error: 'Acceso denegado. Este portal es exclusivo para Gerencia y Recursos Humanos.' },
        { status: 403 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return NextResponse.json(
        { error: 'Contraseña incorrecta' },
        { status: 401 }
      );
    }

    // Generar JWT para la sesión
    const token = await new SignJWT({
      userId: user.id,
      role: user.role,
      companyId: user.companyId,
      dni: user.dni,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(secretKey);

    // Registrar en AuditLog si es acceso gerencial
    if (portal === 'ADMIN') {
      const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
      await prisma.auditLog.create({
        data: {
          performedById: user.id,
          entity: 'AUTH',
          entityId: user.id,
          action: 'ADMIN_LOGIN',
          reason: `Inicio de sesión en panel de RRHH (${user.role})`,
          ipAddress,
        },
      });
    }

    // Respuesta conservando exactamente la estructura previa + companyConfig dinámico + estado de firma
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        dni: user.dni,
        email: user.email,
        name: `${user.name} ${user.lastName}`,
        jobTitle: user.jobTitle,
        companyName: user.company.name,
        companyId: user.companyId,
        role: user.role,
        isRemoteAllowed: user.isRemoteAllowed,
        hasSignature: Boolean(user.signatureBase64),
      },
      companyConfig: {
        lunchWindowStart: user.company.lunchWindowStart ?? '13:00',
        lunchWindowEnd: user.company.lunchWindowEnd ?? '13:30',
        lunchDurationMinutes: user.company.lunchDurationMinutes ?? 60,
        lunchDays: user.company.lunchDays ?? [1, 2, 3, 4, 5],
        saturdayWorkHours: user.company.saturdayWorkHours ?? 4.5,
      },
    });

    if (portal === 'ADMIN' || user.role === 'ADMIN' || user.role === 'HR') {
      response.cookies.set('hyperion_session', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 12,
        path: '/',
      });
    }

    return response;
  } catch (error: any) {
    console.error('Error en autenticación:', error);
    return NextResponse.json(
      { error: 'Error en el servidor al autenticar' },
      { status: 500 }
    );
  }
}