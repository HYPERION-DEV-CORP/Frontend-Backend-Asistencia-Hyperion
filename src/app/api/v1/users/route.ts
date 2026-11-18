// src/app/api/v1/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

// 1. OBTENER LISTA DE TRABAJADORES
export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        payrollPolicy: true,
        company: true,
      },
    });

    return NextResponse.json({ success: true, users });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: 'Error al consultar la lista de usuarios', details: error?.message },
      { status: 500 }
    );
  }
}

// 2. REGISTRAR UN NUEVO TRABAJADOR
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      dni,
      docType,
      biometricCode,
      role,
      isSubjectToSupervision,
      name,
      lastName,
      email,
      jobTitle,
      workStartTime,
      toleranceMinutes,
      homeOfficeQuota,
      baseSalary,
      payrollPolicyId,
    } = body;

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ dni }, { email }],
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'El DNI o el correo electrónico ya se encuentra registrado.' },
        { status: 400 }
      );
    }

    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json(
        { error: 'No existe una empresa registrada en la base de datos.' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash('123456', 10);

    const newUser = await prisma.user.create({
      data: {
        dni,
        docType: docType || 'DNI',
        biometricCode:
          biometricCode && String(biometricCode).trim() !== ''
            ? String(biometricCode).trim().padStart(8, '0')
            : null,
        role: role && ['ADMIN', 'HR', 'EMPLOYEE'].includes(role) ? role : 'EMPLOYEE',
        isSubjectToSupervision:
          typeof isSubjectToSupervision === 'boolean' ? isSubjectToSupervision : true,
        name,
        lastName,
        email,
        passwordHash,
        jobTitle: jobTitle || 'Empleado',
        workStartTime: workStartTime || '09:00',
        toleranceMinutes: toleranceMinutes ? parseInt(String(toleranceMinutes)) : 10,
        homeOfficeQuota: homeOfficeQuota ? parseInt(String(homeOfficeQuota)) : 4,
        baseSalary: baseSalary ? parseFloat(String(baseSalary)) : 0.0,
        payrollPolicyId:
          payrollPolicyId && String(payrollPolicyId).trim() !== '' ? payrollPolicyId : null,
        companyId: company.id,
      },
      include: {
        payrollPolicy: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Trabajador registrado con éxito. Contraseña inicial: 123456',
      user: newUser,
    });
  } catch (error: any) {
    console.error('Error registrando trabajador:', error);
    return NextResponse.json(
      { error: 'Error al guardar el nuevo trabajador', details: error?.message },
      { status: 500 }
    );
  }
}