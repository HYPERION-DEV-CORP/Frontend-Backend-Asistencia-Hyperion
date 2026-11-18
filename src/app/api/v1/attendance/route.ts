// src/app/api/v1/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateDistanceInMeters } from '@/lib/geo';
import { calculateLunchExcessMinutes } from '@/lib/sst-monitor';
import { assertPeriodIsOpen } from '@/lib/payroll-period';

// Helper para convertir "HH:mm" a [hora, minuto]
function parseTimeHHMM(timeStr: string | null | undefined, fallbackH: number, fallbackM: number): [number, number] {
  if (!timeStr || !timeStr.includes(':')) return [fallbackH, fallbackM];
  const [h, m] = timeStr.split(':').map(Number);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, type, actionType, lat, lng, signature, qrContent } = body;

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return NextResponse.json(
        { error: 'Las coordenadas GPS son inválidas o no fueron recibidas.' },
        { status: 400 }
      );
    }

    const serverTimestamp = new Date();
    const today = new Date(serverTimestamp);
    today.setHours(0, 0, 0, 0);

    // 1. BUSCAR TRABAJADOR Y CONFIGURACIÓN DINÁMICA DE SU EMPRESA
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { dni: userId }] },
      include: { company: true, homeAddresses: true, payrollPolicy: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado en la base de datos' },
        { status: 404 }
      );
    }

    const company = user.company;
    const lunchWindowStartStr = company.lunchWindowStart || '13:00';
    const lunchWindowEndStr = company.lunchWindowEnd || '13:30';
    const lunchDurationMinutes = company.lunchDurationMinutes ?? 60;
    const lunchDays = Array.isArray(company.lunchDays) ? company.lunchDays : [1, 2, 3, 4, 5];
    const saturdayWorkHours = company.saturdayWorkHours ?? 4.5;

    // 1.1. VERIFICAR QUE EL PERÍODO DE PLANILLA NO ESTÉ CERRADO
    await assertPeriodIsOpen(today, user.companyId);

    // ---------------------------------------------------------
    // 2. VALIDACIÓN DE GEOCERCAS (OFICINA VS. HOME OFFICE)
    // ---------------------------------------------------------
    let homeOfficeRemaining = 0;

    if (type === 'PRESENTIAL_QR') {
      if (!qrContent || qrContent !== company.qrSecret) {
        return NextResponse.json(
          { error: 'Código QR de oficina inválido' },
          { status: 400 }
        );
      }
    }

    if (
      [
        'PRESENTIAL_QR',
        'PRESENTIAL_NFC',
        'BIOMETRIC_FINGERPRINT',
        'FACIAL_RECOGNITION',
      ].includes(type)
    ) {
      const distance = calculateDistanceInMeters(
        latitude,
        longitude,
        company.officeLat,
        company.officeLng
      );
      if (distance > company.radiusM) {
        return NextResponse.json(
          {
            error: `Fuera del rango de la oficina: ${Math.round(distance)}m (Límite: ${company.radiusM}m)`,
          },
          { status: 403 }
        );
      }
    } else if (type === 'HOME_OFFICE') {
      if (user.homeAddresses.length === 0) {
        return NextResponse.json(
          { error: 'No tiene domicilios registrados para Home Office.' },
          { status: 400 }
        );
      }

      const startOfMonth = new Date(
        serverTimestamp.getFullYear(),
        serverTimestamp.getMonth(),
        1
      );
      const endOfMonth = new Date(
        serverTimestamp.getFullYear(),
        serverTimestamp.getMonth() + 1,
        0,
        23,
        59,
        59
      );

      const homeOfficeCount = await prisma.attendanceRecord.count({
        where: {
          userId: user.id,
          type: 'HOME_OFFICE',
          date: { gte: startOfMonth, lte: endOfMonth },
        },
      });

      if (
        homeOfficeCount >= user.homeOfficeQuota &&
        (actionType === 'CHECK_IN' || !actionType)
      ) {
        return NextResponse.json(
          {
            error: `Excedió su cuota mensual de Home Office (${user.homeOfficeQuota} días).`,
          },
          { status: 403 }
        );
      }

      const enRango = user.homeAddresses.some((addr) => {
        const dist = calculateDistanceInMeters(
          latitude,
          longitude,
          addr.latitude,
          addr.longitude
        );
        return dist <= 50.0;
      });

      if (!enRango) {
        return NextResponse.json(
          {
            error:
              'No se encuentra en el rango de ninguno de sus domicilios registrados (Límite 50m).',
          },
          { status: 403 }
        );
      }

      homeOfficeRemaining = user.homeOfficeQuota - (homeOfficeCount + 1);
    }

    // ---------------------------------------------------------
    // 3. REGISTRO SEGÚN EL CICLO CON CUMPLIMIENTO SUNAFIL
    // ---------------------------------------------------------
    let record = await prisma.attendanceRecord.findFirst({
      where: { userId: user.id, date: today },
    });

    const currentAction = actionType || 'CHECK_IN';

    // A) REGISTRO DE INGRESO (CHECK_IN)
    if (currentAction === 'CHECK_IN') {
      if (record) {
        return NextResponse.json(
          { error: 'Ya registró su entrada el día de hoy.' },
          { status: 400 }
        );
      }

      const lastRecord = await prisma.attendanceRecord.findFirst({
        where: { userId: user.id, checkOut: { not: null } },
        orderBy: { checkOut: 'desc' },
      });

      if (lastRecord && lastRecord.checkOut) {
        const restMs =
          serverTimestamp.getTime() - lastRecord.checkOut.getTime();
        const restHours = restMs / (1000 * 60 * 60);
        if (restHours < 12) {
          const remainingMinutes = Math.ceil((12 - restHours) * 60);
          return NextResponse.json(
            {
              error: `Infracción a la Ley de Teletrabajo: Debe cumplir 12 horas continuas de desconexión digital. Le faltan ${remainingMinutes} minuto(s).`,
            },
            { status: 403 }
          );
        }
      }

      const [workHour, workMin] = user.workStartTime.split(':').map(Number);
      const graceLimitTime = new Date(serverTimestamp);
      graceLimitTime.setHours(workHour, workMin + user.toleranceMinutes, 0, 0);

      let lateMinutes = 0;
      let status: 'PRESENT' | 'LATE' = 'PRESENT';

      if (serverTimestamp > graceLimitTime) {
        status = 'LATE';
        const expectedTime = new Date(serverTimestamp);
        expectedTime.setHours(workHour, workMin, 0, 0);

        const diffMs = serverTimestamp.getTime() - expectedTime.getTime();
        const totalLateMinutes = Math.floor(diffMs / (1000 * 60));

        lateMinutes = Math.max(0, totalLateMinutes - user.toleranceMinutes);
      }

      record = await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          date: today,
          checkIn: serverTimestamp,
          type,
          status,
          lateMinutes,
          latitude,
          longitude,
          employeeSignature: signature || null,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'CHECK_IN',
        message: 'Entrada registrada con éxito',
        status: record.status,
        lateMinutes,
        homeOfficeRemaining:
          type === 'HOME_OFFICE' ? homeOfficeRemaining : undefined,
        record,
      });
    }

    // B) INICIO DE REFRIGERIO (LUNCH_START) - VENTANA DINÁMICA DE EMPRESA
    else if (currentAction === 'LUNCH_START') {
      if (!record) {
        return NextResponse.json(
          { error: 'Debe marcar su entrada primero.' },
          { status: 400 }
        );
      }

      if (record.lunchStart) {
        return NextResponse.json(
          { error: 'Ya registró inicio de refrigerio el día de hoy.' },
          { status: 400 }
        );
      }

      const dayOfWeek = serverTimestamp.getDay(); // 0=Dom ... 6=Sáb
      if (!lunchDays.includes(dayOfWeek)) {
        return NextResponse.json(
          { error: 'El día de hoy no contempla turno de refrigerio según la política de la empresa.' },
          { status: 400 }
        );
      }

      const [winStartH, winStartM] = parseTimeHHMM(lunchWindowStartStr, 13, 0);
      const [winEndH, winEndM] = parseTimeHHMM(lunchWindowEndStr, 13, 30);

      const windowStart = new Date(serverTimestamp);
      windowStart.setHours(winStartH, winStartM, 0, 0);

      const windowEnd = new Date(serverTimestamp);
      windowEnd.setHours(winEndH, winEndM, 0, 0);

      if (serverTimestamp < windowStart) {
        return NextResponse.json(
          {
            error: `El horario permitido para iniciar el refrigerio es a partir de las ${lunchWindowStartStr}.`,
          },
          { status: 400 }
        );
      }

      if (serverTimestamp > windowEnd) {
        return NextResponse.json(
          {
            error: `Ha superado la hora límite para salir a refrigerio (Máximo ${lunchWindowEndStr}).`,
          },
          { status: 400 }
        );
      }

      record = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: { lunchStart: serverTimestamp },
      });

      return NextResponse.json({
        success: true,
        action: 'LUNCH_START',
        message: `Inicio de refrigerio registrado con éxito. Su tiempo de refrigerio es de ${lunchDurationMinutes} minutos.`,
        lunchDurationMinutes,
        record,
      });
    }

    // C) FIN DE REFRIGERIO (LUNCH_END) - DURACIÓN DINÁMICA DE EMPRESA
    else if (currentAction === 'LUNCH_END') {
      if (!record || !record.lunchStart) {
        return NextResponse.json(
          { error: 'No ha registrado inicio de refrigerio previamente.' },
          { status: 400 }
        );
      }
      if (record.lunchEnd) {
        return NextResponse.json(
          { error: 'Ya registró fin de refrigerio el día de hoy.' },
          { status: 400 }
        );
      }

      const requiredMinutes = lunchDurationMinutes;
      const { totalLunchMinutes, excessMinutes } = calculateLunchExcessMinutes(
        record.lunchStart,
        serverTimestamp,
        requiredMinutes
      );

      if (totalLunchMinutes < requiredMinutes) {
        const remaining = requiredMinutes - totalLunchMinutes;
        return NextResponse.json(
          {
            error: `Su tiempo de refrigerio obligatorio es de ${requiredMinutes} minutos. Le faltan ${remaining} minuto(s).`,
          },
          { status: 400 }
        );
      }

      const updatedLateMinutes = (record.lateMinutes || 0) + excessMinutes;
      const updatedStatus = excessMinutes > 0 ? 'LATE' : record.status;
      const lunchObservation =
        excessMinutes > 0
          ? `${record.observations ? record.observations + ' | ' : ''}Exceso refrigerio: ${totalLunchMinutes} min (+${excessMinutes} min añadidos a tardanza)`
          : record.observations;

      record = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          lunchEnd: serverTimestamp,
          lateMinutes: updatedLateMinutes,
          status: updatedStatus,
          observations: lunchObservation,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'LUNCH_END',
        message:
          excessMinutes > 0
            ? `Fin de refrigerio registrado con ${excessMinutes} min de exceso (sumados a tardanza).`
            : 'Fin de refrigerio registrado con éxito',
        excessMinutes,
        record,
      });
    }

    // D) REGISTRO DE SALIDA (CHECK_OUT)
    else if (currentAction === 'CHECK_OUT') {
      if (!record || !record.checkIn) {
        return NextResponse.json(
          { error: 'Debe marcar su entrada primero.' },
          { status: 400 }
        );
      }
      if (record.checkOut) {
        return NextResponse.json(
          { error: 'Ya registró su salida el día de hoy.' },
          { status: 400 }
        );
      }

      const [workHour, workMin] = user.workStartTime.split(':').map(Number);
      const dayOfWeek = record.date.getDay();
      const isSaturday = dayOfWeek === 6;
      const hasLunchToday = lunchDays.includes(dayOfWeek);
      const userHoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;

      const effectiveDayHours = isSaturday ? saturdayWorkHours : userHoursPerDay;
      const lunchMinutesToday = hasLunchToday ? lunchDurationMinutes : 0;

      const officialCheckOut = new Date(record.date);
      officialCheckOut.setHours(workHour, workMin, 0, 0);
      officialCheckOut.setMinutes(
        officialCheckOut.getMinutes() + Math.round(effectiveDayHours * 60) + lunchMinutesToday
      );

      const [winStartH, winStartM] = parseTimeHHMM(lunchWindowStartStr, 13, 0);
      const defaultLunchStart = new Date(record.date);
      defaultLunchStart.setHours(winStartH, winStartM, 0, 0);

      const defaultLunchEnd = new Date(defaultLunchStart);
      defaultLunchEnd.setMinutes(defaultLunchEnd.getMinutes() + lunchDurationMinutes);

      const shouldAutoAssignLunch =
        hasLunchToday &&
        !record.lunchStart &&
        !record.lunchEnd &&
        record.checkIn < defaultLunchStart &&
        serverTimestamp > defaultLunchEnd;

      const finalLunchStart = shouldAutoAssignLunch
        ? defaultLunchStart
        : record.lunchStart;
      const finalLunchEnd = shouldAutoAssignLunch
        ? defaultLunchEnd
        : record.lunchEnd;

      let totalOvertimeMinutes = 0;
      if (serverTimestamp > officialCheckOut) {
        const diffMs = serverTimestamp.getTime() - officialCheckOut.getTime();
        totalOvertimeMinutes = Math.floor(diffMs / (1000 * 60));
      }

      let overtime25Minutes = 0;
      let overtime35Minutes = 0;

      if (totalOvertimeMinutes > 0) {
        overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
        overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);
      }

      record = await prisma.attendanceRecord.update({
        where: { id: record.id },
        data: {
          checkOut: serverTimestamp,
          lunchStart: finalLunchStart,
          lunchEnd: finalLunchEnd,
          overtimeMinutes: totalOvertimeMinutes,
          overtime25Minutes,
          overtime35Minutes,
          isOvertimeApproved: false,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'CHECK_OUT',
        message: 'Salida registrada con éxito',
        overtimeMinutes: totalOvertimeMinutes,
        overtime25Minutes,
        overtime35Minutes,
        record,
      });
    }

    return NextResponse.json(
      { error: 'Acción de marcación no válida.' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('❌ Error interno en la API de Marcación:', error);
    return NextResponse.json(
      { error: error?.message || 'Error interno en la marcación' },
      { status: error?.message?.includes('cerrado') ? 409 : 500 }
    );
  }
}