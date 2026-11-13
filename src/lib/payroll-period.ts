// src/lib/payroll-period.ts
import { prisma } from '@/lib/prisma';

export async function assertPeriodIsOpen(targetDate: Date, companyId?: string) {
  const period = await prisma.payrollPeriod.findFirst({
    where: {
      ...(companyId ? { companyId } : {}),
      startDate: { lte: targetDate },
      endDate: { gte: targetDate },
      status: 'CLOSED',
    },
  });

  if (period) {
    throw new Error(
      `El registro corresponde al periodo de planilla cerrado "${period.name}". No se permiten modificaciones manuales.`
    );
  }
}