// src/app/api/v1/admin/attendance/manual-note/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPeriodIsOpen } from "@/lib/payroll-period";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, date, isHoliday, tareoObservation, adminId } = body;

    if (!date || !adminId) {
      return NextResponse.json(
        { error: "La fecha y el ID del administrador son obligatorios." },
        { status: 400 },
      );
    }

    const targetDate = new Date(`${date}T00:00:00.000Z`);
    if (isNaN(targetDate.getTime())) {
      return NextResponse.json({ error: "Fecha inválida." }, { status: 400 });
    }

    if (targetDate.getUTCDay() === 0) {
      return NextResponse.json(
        { error: "Los días domingo siempre son Descanso Semanal y no requieren registro manual." },
        { status: 400 },
      );
    }

    const markAsHoliday = Boolean(isHoliday);
    const cleanObs =
      typeof tareoObservation === "string" && tareoObservation.trim()
        ? tareoObservation.trim()
        : markAsHoliday
          ? "FERIADO NO LABORABLE"
          : null;

    if (!markAsHoliday && !cleanObs) {
      return NextResponse.json(
        { error: "Debes marcar el día como feriado o escribir una observación." },
        { status: 400 },
      );
    }

    const targetUsers =
      userId && userId !== "ALL"
        ? await prisma.user.findMany({ where: { id: userId, isActive: true } })
        : await prisma.user.findMany({ where: { isActive: true } });

    if (targetUsers.length === 0) {
      return NextResponse.json({ error: "No se encontraron trabajadores activos." }, { status: 404 });
    }

    await assertPeriodIsOpen(targetDate, targetUsers[0].companyId);

    for (const u of targetUsers) {
      await prisma.attendanceRecord.upsert({
        where: {
          userId_date: {
            userId: u.id,
            date: targetDate,
          },
        },
        update: {
          ...(markAsHoliday
            ? {
                status: "HOLIDAY",
                checkIn: null,
                lunchStart: null,
                lunchEnd: null,
                checkOut: null,
                lateMinutes: 0,
                overtimeMinutes: 0,
                overtime25Minutes: 0,
                overtime35Minutes: 0,
              }
            : {}),
          tareoObservation: cleanObs,
          isModifiedByHR: true,
          hrModificationReason: cleanObs || "Observación administrativa SUNAFIL",
        },
        create: {
          userId: u.id,
          date: targetDate,
          status: markAsHoliday ? "HOLIDAY" : "PRESENT",
          tareoObservation: cleanObs,
          isModifiedByHR: true,
          hrModificationReason: cleanObs || "Observación administrativa SUNAFIL",
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `Se registró correctamente para ${targetUsers.length} trabajador(es).`,
    });
  } catch (error: any) {
    console.error("❌ Error en manual-note:", error);
    return NextResponse.json(
      { error: error.message || "Error al guardar observación/feriado." },
      { status: error.message?.includes("cerrado") ? 409 : 500 },
    );
  }
}