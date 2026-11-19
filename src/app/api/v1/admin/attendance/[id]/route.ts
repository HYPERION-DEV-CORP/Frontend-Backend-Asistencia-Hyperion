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
      isHoliday,
      tareoObservation,
      reason,
      documentUrl,
      adminId,
    } = body;

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

    await assertPeriodIsOpen(record.date, user.companyId);

    const recordDateStr = new Date(record.date).toISOString().split("T")[0];
    const dayOfWeek = new Date(record.date).getUTCDay();
    if (dayOfWeek === 0) {
      return NextResponse.json(
        { error: "Los días domingo corresponden siempre a Descanso Semanal y no son editables." },
        { status: 400 },
      );
    }

    const [wH, wM] = (user.workStartTime || "09:00").split(":").map(Number);
    const userHoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;
    const configuredLunchMinutes = user.company?.lunchDurationMinutes ?? 60;
    const isSaturday = dayOfWeek === 6;

    const effectiveDayHours = isSaturday
      ? (user.company?.saturdayWorkHours ?? 4.5)
      : userHoursPerDay;
    const lunchHours = isSaturday ? 0 : configuredLunchMinutes / 60;

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

    const dateStr = recordDateStr;
    const markAsHoliday = Boolean(isHoliday);

    let updatedCheckIn = markAsHoliday ? null : record.checkIn;
    if (!markAsHoliday) {
      if (newCheckIn === null || newCheckIn === "") {
        updatedCheckIn = null;
      } else if (typeof newCheckIn === "string" && newCheckIn.includes(":")) {
        updatedCheckIn = new Date(`${dateStr}T${newCheckIn}:00.000`);
      }
    }

    let updatedLunchStart = markAsHoliday ? null : record.lunchStart;
    if (!markAsHoliday) {
      if (newLunchStart === null || newLunchStart === "") {
        updatedLunchStart = null;
      } else if (typeof newLunchStart === "string" && newLunchStart.includes(":")) {
        updatedLunchStart = new Date(`${dateStr}T${newLunchStart}:00.000`);
      }
    }

    let updatedLunchEnd = markAsHoliday ? null : record.lunchEnd;
    if (!markAsHoliday) {
      if (newLunchEnd === null || newLunchEnd === "") {
        updatedLunchEnd = null;
      } else if (typeof newLunchEnd === "string" && newLunchEnd.includes(":")) {
        updatedLunchEnd = new Date(`${dateStr}T${newLunchEnd}:00.000`);
      }
    }

    let updatedCheckOut = markAsHoliday ? null : record.checkOut;
    if (!markAsHoliday) {
      if (newCheckOut === null || newCheckOut === "") {
        updatedCheckOut = null;
      } else if (typeof newCheckOut === "string" && newCheckOut.includes(":")) {
        updatedCheckOut = new Date(`${dateStr}T${newCheckOut}:00.000`);
      }
    }

    let lateMinutes = 0;
    let status: "PRESENT" | "LATE" | "HOLIDAY" = markAsHoliday ? "HOLIDAY" : "PRESENT";

    if (!markAsHoliday && updatedCheckIn && user.workStartTime) {
      const [startHours, startMinutes] = user.workStartTime.split(":").map(Number);
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
        lateMinutes = Math.max(0, totalLateMinutes - (user.toleranceMinutes || 10));
      }
    }

    const { totalLunchMinutes, excessMinutes } = markAsHoliday
      ? { totalLunchMinutes: 0, excessMinutes: 0 }
      : calculateLunchExcessMinutes(
          updatedLunchStart,
          updatedLunchEnd,
          configuredLunchMinutes,
        );

    if (!markAsHoliday && excessMinutes > 0) {
      lateMinutes += excessMinutes;
      status = "LATE";
    }

    const lunchNote =
      !markAsHoliday && excessMinutes > 0
        ? ` | Exceso refrigerio: ${totalLunchMinutes} min (+${excessMinutes} min añadidos a tardanza)`
        : "";

    let totalOvertimeMinutes = 0;
    let overtime25Minutes = 0;
    let overtime35Minutes = 0;

    if (!markAsHoliday && updatedCheckOut && user.workStartTime) {
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

    const checkOutChanged = record.checkOut?.getTime() !== updatedCheckOut?.getTime();
    const isOvertimeApproved = markAsHoliday || checkOutChanged ? false : record.isOvertimeApproved;

    // Observación manual limpia para Tareo SUNAFIL
    const finalTareoObs =
      typeof tareoObservation === "string"
        ? tareoObservation.trim() || (markAsHoliday ? "FERIADO NO LABORABLE" : null)
        : markAsHoliday
          ? "FERIADO NO LABORABLE"
          : record.tareoObservation;

    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0] ||
      req.headers.get("x-real-ip") ||
      "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "Desconocido";

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
          tareoObservation: finalTareoObs,
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
          action: markAsHoliday ? "MARK_HOLIDAY_AND_OBSERVATION" : "RECTIFY_ATTENDANCE_AND_OVERTIME",
          previousValue: `Estado: ${record.status}, Tardanza: ${record.lateMinutes}m, HE: ${record.overtimeMinutes}m`,
          newValue: `Estado: ${status}, Tardanza: ${lateMinutes}m, HE: ${totalOvertimeMinutes}m, TareoObs: ${finalTareoObs || 'N/A'}`,
          reason: `${reason.trim()}${lunchNote}`,
          ipAddress,
        },
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      message: "Marcación y observación SUNAFIL actualizadas exitosamente",
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