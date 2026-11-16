// src/lib/module-guard.ts
import { prisma } from '@/lib/prisma';

export type SystemModule =
  | 'ATTENDANCE_QR'
  | 'BIOMETRIC_SYNC'
  | 'AUTO_ABSENCE_CRON'
  | 'DIGITAL_SIGNATURE'
  | 'PLAME_EXPORT'
  | 'AUDIT_FORENSIC';

export async function assertModuleEnabled(companyId: string, moduleKey: SystemModule) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      planType: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      enabledModules: true,
    },
  });

  if (!company) {
    throw new Error('EMPRESA_NO_ENCONTRADA');
  }

  // 1. Verificar estado de cuenta y vencimiento de prueba gratuita (7 días)
  const now = new Date();
  if (company.subscriptionStatus === 'SUSPENDED' || company.subscriptionStatus === 'EXPIRED') {
    throw new Error('SUBSCRIPTION_INACTIVE: Su suscripción se encuentra suspendida o expirada.');
  }

  if (company.planType === 'TRIAL' && company.trialEndsAt && now > company.trialEndsAt) {
    // Actualizar estado automáticamente a EXPIRED en BD para mantener consistencia
    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionStatus: 'EXPIRED' },
    });
    throw new Error('TRIAL_EXPIRED: El período de prueba gratuita de 7 días ha finalizado.');
  }

  // 2. Verificar si el módulo está habilitado para este cliente
  if (!company.enabledModules.includes(moduleKey)) {
    throw new Error(`MODULE_DISABLED: El módulo [${moduleKey}] no está activo en su plan actual.`);
  }

  return true;
}