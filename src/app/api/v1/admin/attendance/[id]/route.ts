// src/app/api/v1/admin/attendance/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPeriodIsOpen } from "@/lib/payroll-period";
import { calculateLunchExcessMinutes } from "@/lib/sst-monitor";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const resolvedParams = await params;
    const recordId = resolvedParams?.id;

    if (!recordId) {
      return NextResponse.json(
        { error: "ID de registro no recibido" },
        { status: 400 },
      );
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
        {
          error:
            "SUNAFIL exige un motivo justificado (mínimo 10 caracteres) para la rectificación manual.",
        },
        { status: 400 },
      );
    }

    if (!adminId) {
      return NextResponse.json(
        {
          error:
            "Se requiere el ID del administrador que autoriza la modificación.",
        },
        { status: 401 },
      );
    }

    // 2. Consulta de la marcación previa (incluyendo company y payrollPolicy)
    const rawRecord = await prisma.attendanceRecord.findUnique({
      where: { id: recordId },
      include: {
        user: {
          include: {
            payrollPolicy: true,
            company: true,
          },
        },
      },
    });

    if (!rawRecord || !rawRecord.user) {
      return NextResponse.json(
        { error: "Registro de asistencia no encontrado" },
        { status: 404 },
      );
    }

    const record = rawRecord as typeof rawRecord & { user: any };
    const user = record.user;

    // 3. Bloqueo de Periodos Cerrados
    await assertPeriodIsOpen(record.date, user.companyId);

    // 3.1. Bloquear edición si existe una papeleta aprobada SIN GOCE que afecte la jornada de ese día
    const recordDateStr = new Date(record.date).toISOString().split("T")[0];
    const [wH, wM] = (user.workStartTime || "09:00").split(":").map(Number);
    const userHoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;
    const configuredLunchMinutes = user.company?.lunchDurationMinutes ?? 60;
    const isSaturday = new Date(record.date).getUTCDay() === 6;

    const effectiveDayHours = isSaturday
      ? (user.company?.saturdayWorkHours ?? 4.5)
      : userHoursPerDay;
    const lunchHours = isSaturday ? 0 : configuredLunchMinutes / 60;

    // Inicio y fin del turno en hora Perú (UTC-5 -> +5h en UTC)
    const shiftStartUtc = new Date(
      `${recordDateStr}T${String(wH).padStart(2, "0")}:${String(wM).padStart(2, "0")}:00.000Z`,
    );
    shiftStartUtc.setUTCHours(shiftStartUtc.getUTCHours() + 5);

    const shiftEndUtc = new Date(
      shiftStartUtc.getTime() + (effectiveDayHours + lunchHours) * 60 * 60 * 1000,
    );

    const activeUnpaidPermit = await prisma.permissionRequest.findFirst({
      where: {
        userId: record.userId,
        status: "APPROVED",
        reason: { contains: "SIN GOCE", mode: "insensitive" },
        startDate: { lt: shiftEndUtc },
        endDate: { gt: shiftStartUtc },
      },
    });

    if (activeUnpaidPermit) {
      return NextResponse.json(
        {
          error:
            "Este día está cubierto por una Papeleta aprobada SIN GOCE DE HABER. No se pueden modificar ni asignar horas trabajadas sobre una licencia sin goce.",
        },
        { status: 409 },
      );
    }

    // Usamos directamente recordDateStr (YYYY-MM-DD) para evitar desfases de día por zona horaria
    const dateStr = recordDateStr;

    // 4. Reconstrucción de Fechas (permite editar solo ingreso sin rellenar refrigerio/salida, y también limpiar campos)
    let updatedCheckIn = record.checkIn;
    if (newCheckIn && typeof newCheckIn === "string" && newCheckIn.includes(":")) {
      updatedCheckIn = new Date(`${dateStr}T${newCheckIn}:00.000`);
    }

    let updatedLunchStart = record.lunchStart;
    if (newLunchStart === null || newLunchStart === "") {
      updatedLunchStart = null;
    } else if (typeof newLunchStart === "string" && newLunchStart.includes(":")) {
      updatedLunchStart = new Date(`${dateStr}T${newLunchStart}:00.000`);
    }

    let updatedLunchEnd = record.lunchEnd;
    if (newLunchEnd === null || newLunchEnd === "") {
      updatedLunchEnd = null;
    } else if (typeof newLunchEnd === "string" && newLunchEnd.includes(":")) {
      updatedLunchEnd = new Date(`${dateStr}T${newLunchEnd}:00.000`);
    }

    let updatedCheckOut = record.checkOut;
    if (newCheckOut === null || newCheckOut === "") {
      updatedCheckOut = null;
    } else if (typeof newCheckOut === "string" && newCheckOut.includes(":")) {
      updatedCheckOut = new Date(`${dateStr}T${newCheckOut}:00.000`);
    }

    // 5. Cálculo de Tardanza por Ingreso
    let lateMinutes = 0;
    let status: "PRESENT" | "LATE" = "PRESENT";

    if (updatedCheckIn && user.workStartTime) {
      const [startHours, startMinutes] = user.workStartTime
        .split(":")
        .map(Number);
      const expectedStartTime = new Date(
        `${dateStr}T${String(startHours).padStart(2, "0")}:${String(startMinutes).padStart(2, "0")}:00.000`,
      );
      const graceLimitTime = new Date(
        expectedStartTime.getTime() + (user.toleranceMinutes || 10) * 60 * 1000,
      );

      if (updatedCheckIn > graceLimitTime) {
        status = "LATE";
        const diffMs = updatedCheckIn.getTime() - expectedStartTime.getTime();
        const totalLateMinutes = Math.floor(diffMs / (1000 * 60));
        lateMinutes = Math.max(
          0,
          totalLateMinutes - (user.toleranceMinutes || 10),
        );
      }
    }

    // 5.1. Control de Exceso de Refrigerio según duración configurada en la empresa (D.S. N° 007-2002-TR)
    const { totalLunchMinutes, excessMinutes } = calculateLunchExcessMinutes(
      updatedLunchStart,
      updatedLunchEnd,
      configuredLunchMinutes,
    );

    if (excessMinutes > 0) {
      lateMinutes += excessMinutes;
      status = "LATE";
    }

    const lunchNote =
      excessMinutes > 0
        ? ` | Exceso refrigerio: ${totalLunchMinutes} min (+${excessMinutes} min añadidos a tardanza)`
        : "";

    // 6. Cálculo de Horas Extras (25% y 35%) según jornada del día y duración de refrigerio configurada
    let totalOvertimeMinutes = 0;
    let overtime25Minutes = 0;
    let overtime35Minutes = 0;

    if (updatedCheckOut && user.workStartTime) {
      const [workHour, workMin] = user.workStartTime.split(":").map(Number);
      const totalShiftHours = effectiveDayHours + lunchHours;

      const officialCheckOut = new Date(
        new Date(
          `${dateStr}T${String(workHour).padStart(2, "0")}:${String(workMin).padStart(2, "0")}:00.000`,
        ).getTime() +
          totalShiftHours * 60 * 60 * 1000,
      );

      if (updatedCheckOut > officialCheckOut) {
        const diffMs = updatedCheckOut.getTime() - officialCheckOut.getTime();
        totalOvertimeMinutes = Math.floor(diffMs / (1000 * 60));
        overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
        overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);
      }
    }

    const checkOutChanged =
      record.checkOut?.getTime() !== updatedCheckOut?.getTime();
    const isOvertimeApproved = checkOutChanged
      ? false
      : record.isOvertimeApproved;

    // Captura de metadatos forenses
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "Desconocido";

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
          fieldModified: "checkIn",
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
          fieldModified: "lunchStart",
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
          fieldModified: "lunchEnd",
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
          fieldModified: "checkOut",
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

      await tx.auditLog.create({
        data: {
          performedById: adminId,
          entity: "ATTENDANCE_RECORD",
          entityId: recordId,
          action: "RECTIFY_ATTENDANCE_AND_OVERTIME",
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
      message: "Marcación y Horas Extras recalculadas y auditadas exitosamente",
      record: result,
    });
  } catch (error: any) {
    console.error("❌ Error actualizando asistencia:", error);
    return NextResponse.json(
      {
        error:
          error.message ||
          "Error interno del servidor al procesar rectificación",
      },
      {
        status:
          error.message?.includes("cerrado") ||
          error.message?.includes("bloqueado")
            ? 409
            : 500,
      },
    );
  }
}