// src/app/api/v1/admin/attendance/[id]/approve-overtime/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertPeriodIsOpen } from '@/lib/payroll-period';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const recordId = resolvedParams?.id;
    const { decision, adminId } = await req.json(); 
    // decision puede ser: 'APPROVE' (Procede), 'REJECT' (No procede), o 'REVOKE' (Anular)

    if (!recordId || !adminId || !decision) {
      return NextResponse.json(
        { error: 'Faltan parámetros obligatorios (recordId, decision o adminId).' },
        { status: 400 }
      );
    }

    const record = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: { user: true },
    });

    if (!record) {
      return NextResponse.json({ error: 'Marcación no encontrada.' }, { status: 404 });
    }

    // 1. Verificar que el período de planilla no esté cerrado
    await assertPeriodIsOpen(record.date, record.user.companyId);

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';

    // 2. Ejecutar decisión en transacción atómica
    const updated = await prisma.$transaction(async (tx) => {
      if (decision === 'APPROVE') {
        const att = await tx.attendanceRecord.update({
          where: { id: recordId },
          data: {
            isOvertimeApproved: true,
            approvedBy: adminId,
          },
        });

        await tx.auditLog.create({
          data: {
            performedById: adminId,
            entity: 'ATTENDANCE_RECORD',
            entityId: recordId,
            action: 'APPROVE_OVERTIME',
            previousValue: `HE: ${record.overtimeMinutes} min (Pendiente)`,
            newValue: `HE Aprobadas: ${record.overtimeMinutes} min`,
            reason: 'Gerencia/RRHH declaró que PROCEDE el pago de horas extras.',
            ipAddress,
          },
        });
        return att;
      }

      if (decision === 'REJECT') {
        // Si NO PROCEDE: se anulan los minutos extras para que no queden pendientes ni se paguen
        const att = await tx.attendanceRecord.update({
          where: { id: recordId },
          data: {
            overtimeMinutes: 0,
            overtime25Minutes: 0,
            overtime35Minutes: 0,
            isOvertimeApproved: false,
            approvedBy: adminId,
            observations: `${record.observations ? record.observations + ' | ' : ''}H.E. Rechazadas por RRHH (No procede)`,
          },
        });

        await tx.auditLog.create({
          data: {
            performedById: adminId,
            entity: 'ATTENDANCE_RECORD',
            entityId: recordId,
            action: 'REJECT_OVERTIME',
            previousValue: `HE registradas: ${record.overtimeMinutes} min`,
            newValue: `HE: 0 min (No procede)`,
            reason: 'Gerencia/RRHH declaró que NO PROCEDE el sobretiempo (permanencia no autorizada).',
            ipAddress,
          },
        });
        return att;
      }

      // REVOKE (Volver a estado pendiente)
      const att = await tx.attendanceRecord.update({
        where: { id: recordId },
        data: {
          isOvertimeApproved: false,
          approvedBy: null,
        },
      });

      await tx.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'ATTENDANCE_RECORD',
          entityId: recordId,
          action: 'REVOKE_OVERTIME',
          previousValue: `Aprobado: true`,
          newValue: `Aprobado: false (Pendiente)`,
          reason: 'Gerencia/RRHH anuló la aprobación previa de horas extras.',
          ipAddress,
        },
      });
      return att;
    });

    return NextResponse.json({
      success: true,
      record: updated,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Error al procesar decisión de horas extras.' },
      { status: error.message?.includes('cerrado') ? 409 : 500 }
    );
  }
}