// src/app/api/v1/admin/attendance/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertPeriodIsOpen } from '@/lib/payroll-period';
import { calculateLunchExcessMinutes } from '@/lib/sst-monitor';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const recordId = resolvedParams?.id;

    if (!recordId) {
      return NextResponse.json({ error: 'ID de registro no recibido' }, { status: 400 });
    }

    const body = await req.json();
    const {
      newCheckIn,
      newLunchStart,
      newLunchEnd,
      newCheckOut,
      reason,
      documentUrl,
      adminId,
    } = body;

    // 1. Validación de motivo exigido por SUNAFIL
    if (!reason || !reason.trim() || reason.trim().length < 10) {
      return NextResponse.json(
        { error: 'SUNAFIL exige un motivo justificado (mínimo 10 caracteres) para la rectificación manual.' },
        { status: 400 }
      );
    }

    if (!adminId) {
      return NextResponse.json(
        { error: 'Se requiere el ID del administrador que autoriza la modificación.' },
        { status: 401 }
      );
    }

    // 2. Consulta de la marcación previa
    const rawRecord = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        user: {
          include: { payrollPolicy: true },
        },
      },
    });

    if (!rawRecord || !rawRecord.user) {
      return NextResponse.json({ error: 'Registro de asistencia no encontrado' }, { status: 404 });
    }

    const record = rawRecord as typeof rawRecord & { user: any };
    const user = record.user;

    // 3. Bloqueo de Periodos Cerrados
    // Verifica que la fecha de la marcación no esté dentro de un periodo cerrado para la empresa
    await assertPeriodIsOpen(record.date, user.companyId);

    const dateObj = new Date(record.date);
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    // 4. Reconstrucción de Fechas
    let updatedCheckIn = record.checkIn;
    if (newCheckIn && newCheckIn.includes(':')) {
      updatedCheckIn = new Date(`${dateStr}T${newCheckIn}:00.000`);
    }

    let updatedLunchStart = record.lunchStart;
    if (newLunchStart && newLunchStart.includes(':')) {
      updatedLunchStart = new Date(`${dateStr}T${newLunchStart}:00.000`);
    }

    let updatedLunchEnd = record.lunchEnd;
    if (newLunchEnd && newLunchEnd.includes(':')) {
      updatedLunchEnd = new Date(`${dateStr}T${newLunchEnd}:00.000`);
    }

    let updatedCheckOut = record.checkOut;
    if (newCheckOut && newCheckOut.includes(':')) {
      updatedCheckOut = new Date(`${dateStr}T${newCheckOut}:00.000`);
    }

    // 5. Cálculo de Tardanza por Ingreso
    let lateMinutes = 0;
    let status: 'PRESENT' | 'LATE' = 'PRESENT';

    if (updatedCheckIn && user.workStartTime) {
      const [startHours, startMinutes] = user.workStartTime.split(':').map(Number);
      const expectedStartTime = new Date(
        `${dateStr}T${String(startHours).padStart(2, '0')}:${String(startMinutes).padStart(2, '0')}:00.000`
      );
      const graceLimitTime = new Date(
        expectedStartTime.getTime() + (user.toleranceMinutes || 10) * 60 * 1000
      );

      if (updatedCheckIn > graceLimitTime) {
        status = 'LATE';
        const diffMs = updatedCheckIn.getTime() - expectedStartTime.getTime();
        const totalLateMinutes = Math.floor(diffMs / (1000 * 60));
        lateMinutes = Math.max(0, totalLateMinutes - (user.toleranceMinutes || 10));
      }
    }

    // 5.1. Control de Exceso de Refrigerio (D.S. N° 007-2002-TR)
    const { totalLunchMinutes, excessMinutes } = calculateLunchExcessMinutes(
      updatedLunchStart,
      updatedLunchEnd,
      60 // 60 minutos permitidos según tu cálculo de jornada (totalShiftHours = userHoursPerDay + 1.0)
    );

    if (excessMinutes > 0) {
      lateMinutes += excessMinutes;
      status = 'LATE';
    }

    const lunchNote =
      excessMinutes > 0
        ? ` | Exceso refrigerio: ${totalLunchMinutes} min (+${excessMinutes} min añadidos a tardanza)`
        : '';

    // 6. Cálculo de Horas Extras (25% y 35%)
    let totalOvertimeMinutes = 0;
    let overtime25Minutes = 0;
    let overtime35Minutes = 0;

    if (updatedCheckOut && user.workStartTime) {
      const [workHour, workMin] = user.workStartTime.split(':').map(Number);
      const userHoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;
      const totalShiftHours = userHoursPerDay + 1.0; // Jornada + 1h de refrigerio

      const officialCheckOut = new Date(
        new Date(
          `${dateStr}T${String(workHour).padStart(2, '0')}:${String(workMin).padStart(2, '0')}:00.000`
        ).getTime() +
          totalShiftHours * 60 * 60 * 1000
      );

      if (updatedCheckOut > officialCheckOut) {
        const diffMs = updatedCheckOut.getTime() - officialCheckOut.getTime();
        totalOvertimeMinutes = Math.floor(diffMs / (1000 * 60));
        overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
        overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);
      }
    }

    // Si cambió la hora de salida, las nuevas horas extras vuelven a estado pendiente de aprobación
    const checkOutChanged = record.checkOut?.getTime() !== updatedCheckOut?.getTime();
    const isOvertimeApproved = checkOutChanged ? false : record.isOvertimeApproved;

    // Captura de metadatos forenses
    const ipAddress =
      req.headers.get('x-forwarded-for')?.split(',')[0] ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';
    const userAgent = req.headers.get('user-agent') || 'Desconocido';

    // 7. Transacción atómica: Actualización de marcación + Logs de auditoría
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.attendanceRecord.update({
        where: { id: recordId },
        data: {
          checkIn: updatedCheckIn,
          lunchStart: updatedLunchStart,
          lunchEnd: updatedLunchEnd,
          checkOut: updatedCheckOut,
          status,
          lateMinutes,
          overtimeMinutes: totalOvertimeMinutes,
          overtime25Minutes,
          overtime35Minutes,
          isOvertimeApproved,
          isModifiedByHR: true,
          hrModificationReason: reason.trim(),
          documentUrl: documentUrl || record.documentUrl,
          observations: `Editado por RRHH (${adminId}): ${reason.trim()}${lunchNote}`,
        },
      });

      // Detalle campo por campo en AttendanceAuditLog (incluyendo refrigerios)
      const auditEntries: Array<{
        attendanceId: string;
        modifiedById: string;
        fieldModified: string;
        previousValue: Date | null;
        newValue: Date | null;
        reason: string;
        documentUrl?: string | null;
        ipAddress: string;
        userAgent: string;
      }> = [];

      if (record.checkIn?.getTime() !== updatedCheckIn?.getTime()) {
        auditEntries.push({
          attendanceId: recordId,
          modifiedById: adminId,
          fieldModified: 'checkIn',
          previousValue: record.checkIn,
          newValue: updatedCheckIn,
          reason: reason.trim(),
          documentUrl: documentUrl || null,
          ipAddress,
          userAgent,
        });
      }

      if (record.lunchStart?.getTime() !== updatedLunchStart?.getTime()) {
        auditEntries.push({
          attendanceId: recordId,
          modifiedById: adminId,
          fieldModified: 'lunchStart',
          previousValue: record.lunchStart,
          newValue: updatedLunchStart,
          reason: reason.trim(),
          documentUrl: documentUrl || null,
          ipAddress,
          userAgent,
        });
      }

      if (record.lunchEnd?.getTime() !== updatedLunchEnd?.getTime()) {
        auditEntries.push({
          attendanceId: recordId,
          modifiedById: adminId,
          fieldModified: 'lunchEnd',
          previousValue: record.lunchEnd,
          newValue: updatedLunchEnd,
          reason: reason.trim(),
          documentUrl: documentUrl || null,
          ipAddress,
          userAgent,
        });
      }

      if (checkOutChanged) {
        auditEntries.push({
          attendanceId: recordId,
          modifiedById: adminId,
          fieldModified: 'checkOut',
          previousValue: record.checkOut,
          newValue: updatedCheckOut,
          reason: reason.trim(),
          documentUrl: documentUrl || null,
          ipAddress,
          userAgent,
        });
      }

      if (auditEntries.length > 0) {
        await tx.attendanceAuditLog.createMany({
          data: auditEntries,
        });
      }

      // Registro general de sistema en AuditLog
      await tx.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'ATTENDANCE_RECORD',
          entityId: recordId,
          action: 'RECTIFY_ATTENDANCE_AND_OVERTIME',
          previousValue: `Tardanza: ${record.lateMinutes}m, HE: ${record.overtimeMinutes}m`,
          newValue: `Tardanza: ${lateMinutes}m, HE: ${totalOvertimeMinutes}m (25%: ${overtime25Minutes}m, 35%: ${overtime35Minutes}m)`,
          reason: `${reason.trim()}${lunchNote}`,
          ipAddress,
        },
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      message: 'Marcación y Horas Extras recalculadas y auditadas exitosamente',
      record: result,
    });
  } catch (error: any) {
    console.error('❌ Error actualizando asistencia:', error);
    return NextResponse.json(
      { error: error.message || 'Error interno del servidor al procesar rectificación' },
      { status: error.message?.includes('cerrado') ? 409 : 500 }
    );
  }
}