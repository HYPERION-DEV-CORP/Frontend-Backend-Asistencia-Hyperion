// src/app/api/v1/admin/subscription/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET: Consultar estado de suscripción, días restantes de trial y módulos activos
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

    const now = new Date();
    let daysRemaining: number | null = null;
    let isExpired = company.subscriptionStatus === 'EXPIRED';

    if (company.planType === 'TRIAL' && company.trialEndsAt) {
      const diffMs = company.trialEndsAt.getTime() - now.getTime();
      daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      if (diffMs <= 0) {
        isExpired = true;
      }
    }

    return NextResponse.json({
      success: true,
      subscription: {
        companyId: company.id,
        companyName: company.name,
        ruc: company.ruc,
        planType: company.planType,
        subscriptionStatus: isExpired ? 'EXPIRED' : company.subscriptionStatus,
        trialStartsAt: company.trialStartsAt,
        trialEndsAt: company.trialEndsAt,
        daysRemaining,
        enabledModules: company.enabledModules,
      },
    });
  } catch (error: any) {
    console.error('❌ Error consultando suscripción:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH: Administrar módulos, iniciar/extender prueba gratuita de 7 días o cambiar plan
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      companyId,
      adminId,
      enabledModules,
      planType,
      subscriptionStatus,
      startTrialWeek, // booleano: true para iniciar/reiniciar 7 días de prueba desde hoy
      extendTrialDays, // número: sumar X días adicionales al trial actual
    } = body;

    const targetCompany = companyId
      ? await prisma.company.findUnique({ where: { id: companyId } })
      : await prisma.company.findFirst();

    if (!targetCompany) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    const updateData: any = {};

    if (Array.isArray(enabledModules)) {
      updateData.enabledModules = enabledModules;
    }

    if (planType) {
      updateData.planType = planType;
    }

    if (subscriptionStatus) {
      updateData.subscriptionStatus = subscriptionStatus;
    }

    // Iniciar o reiniciar prueba gratuita exacta de 7 días (1 semana)
    if (startTrialWeek === true) {
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      updateData.planType = 'TRIAL';
      updateData.subscriptionStatus = 'ACTIVE';
      updateData.trialStartsAt = now;
      updateData.trialEndsAt = sevenDaysLater;
    }

    // Extender días adicionales sobre la fecha actual o vigente
    if (typeof extendTrialDays === 'number' && extendTrialDays > 0) {
      const baseDate =
        targetCompany.trialEndsAt && targetCompany.trialEndsAt > new Date()
          ? targetCompany.trialEndsAt
          : new Date();
      updateData.trialEndsAt = new Date(
        baseDate.getTime() + extendTrialDays * 24 * 60 * 60 * 1000
      );
      updateData.subscriptionStatus = 'ACTIVE';
    }

    const updatedCompany = await prisma.company.update({
      where: { id: targetCompany.id },
      data: updateData,
    });

    if (adminId) {
      await prisma.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'COMPANY_SUBSCRIPTION',
          entityId: targetCompany.id,
          action: 'UPDATE_MODULES_AND_SUBSCRIPTION',
          previousValue: JSON.stringify({
            plan: targetCompany.planType,
            status: targetCompany.subscriptionStatus,
            modules: targetCompany.enabledModules,
          }),
          newValue: JSON.stringify({
            plan: updatedCompany.planType,
            status: updatedCompany.subscriptionStatus,
            modules: updatedCompany.enabledModules,
            trialEndsAt: updatedCompany.trialEndsAt,
          }),
          reason: 'Actualización de módulos habilitados o período de prueba desde administración',
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Configuración de módulos y suscripción actualizada',
      company: updatedCompany,
    });
  } catch (error: any) {
    console.error('❌ Error actualizando suscripción/módulos:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}