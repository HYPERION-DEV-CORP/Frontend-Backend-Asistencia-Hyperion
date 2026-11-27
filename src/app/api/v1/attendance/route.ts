// src/app/api/v1/attendance/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateDistanceInMeters } from '@/lib/geo';
import { calculateLunchExcessMinutes } from '@/lib/sst-monitor';
import { assertPeriodIsOpen } from '@/lib/payroll-period';

function parseTimeHHMM(
  timeStr: string | null | undefined,
  fallbackH: number,
  fallbackM: number
): [number, number] {
  if (!timeStr || !timeStr.includes(':')) return [fallbackH, fallbackM];
  const [h, m] = timeStr.split(':').map(Number);
  return [isNaN(h) ? fallbackH : h, isNaN(m) ? fallbackM : m];
}

function toTotalMinutes(timeStr: string | null | undefined, fallbackMinutes: number): number {
  if (!timeStr || !timeStr.includes(':')) return fallbackMinutes;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return fallbackMinutes;
  return h * 60 + m;
}

function getPeruParts(date: Date) {
  const peruDate = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const dayKey = peruDate.toISOString().slice(0, 10);
  const dayDate = new Date(`${dayKey}T00:00:00.000Z`);
  const dayOfWeek = peruDate.getUTCDay(); // 0=Dom ... 6=Sáb
  const hour = peruDate.getUTCHours();
  const minute = peruDate.getUTCMinutes();
  const totalMinutes = hour * 60 + minute;
  return { dayKey, dayDate, dayOfWeek, hour, minute, totalMinutes };
}

function buildPeruDateTime(dayKey: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${dayKey}T${hh}:${mm}:00.000-05:00`);
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
    const { dayKey, dayDate: today, dayOfWeek, totalMinutes } = getPeruParts(serverTimestamp);

    // 1. BUSCAR TRABAJADOR, SEDES ACTIVAS Y CONFIGURACIÓN DINÁMICA DE SU EMPRESA
    const user = await prisma.user.findFirst({
      where: { OR: [{ id: userId }, { dni: userId }] },
      include: {
        company: {
          include: {
            authorizedLocations: { where: { isActive: true } },
          },
        },
        homeAddresses: true,
        payrollPolicy: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado en la base de datos' },
        { status: 404 }
      );
    }

    const company = user.company;
    const checkInStartStr = company.biometricCheckInStart || '06:00';
    const checkInEndStr = company.biometricCheckInEnd || '11:59';
    const lunchWindowStartStr = company.lunchWindowStart || '13:00';
    const lunchWindowEndStr = company.lunchWindowEnd || '13:30';
    const lunchReturnEndStr = company.lunchReturnEnd || '16:59';
    const lunchDurationMinutes = company.lunchDurationMinutes ?? 60;
    const checkOutStartStr = company.biometricCheckOutStart || '17:00';
    const lunchDays = Array.isArray(company.lunchDays) ? company.lunchDays : [1, 2, 3, 4, 5];
    const saturdayWorkHours = company.saturdayWorkHours ?? 4.5;

    // 1.1. VERIFICAR QUE EL PERÍODO DE PLANILLA NO ESTÉ CERRADO
    await assertPeriodIsOpen(today, user.companyId);

    // ---------------------------------------------------------
    // 2. VALIDACIÓN DE GEOCERCAS MULTI-SEDE Y TRABAJO REMOTO
    // ---------------------------------------------------------
    let homeOfficeRemaining = 0;
    let matchedLocationId: string | null = null;
    let matchedLocationName: string | null = null;

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
      const activeLocations =
        company.authorizedLocations && company.authorizedLocations.length > 0
          ? company.authorizedLocations
          : [
              {
                id: null,
                name: 'Sede Principal',
                latitude: company.officeLat,
                longitude: company.officeLng,
                radiusM: company.radiusM,
              },
            ];

      let closestDistance = Infinity;
      let closestLocation = activeLocations[0];

      for (const loc of activeLocations) {
        const dist = calculateDistanceInMeters(
          latitude,
          longitude,
          loc.latitude,
          loc.longitude
        );
        if (dist < closestDistance) {
          closestDistance = dist;
          closestLocation = loc;
        }
        if (dist <= loc.radiusM) {
          matchedLocationId = loc.id;
          matchedLocationName = loc.name;
          break;
        }
      }

      if (!matchedLocationName) {
        return NextResponse.json(
          {
            error: `Fuera de las instalaciones autorizadas. Sede más cercana: "${closestLocation.name}" a ${Math.round(closestDistance)}m (Límite: ${closestLocation.radiusM}m).`,
          },
          { status: 403 }
        );
      }
    } else if (type === 'HOME_OFFICE') {
      if (!user.isRemoteAllowed) {
        return NextResponse.json(
          {
            error:
              'Su perfil no está autorizado para realizar trabajo remoto. Debe registrar su asistencia dentro de una sede autorizada.',
          },
          { status: 403 }
        );
      }

      const startOfMonth = new Date(`${dayKey.slice(0, 7)}-01T00:00:00.000Z`);
      const endOfMonth = new Date(
        Date.UTC(Number(dayKey.slice(0, 4)), Number(dayKey.slice(5, 7)), 0, 23, 59, 59)
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
            error: `Excedió su cuota mensual de Trabajo Remoto (${user.homeOfficeQuota} días).`,
          },
          { status: 403 }
        );
      }

      if (user.homeAddresses.length > 0) {
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
                'No se encuentra en el rango de ninguno de sus domicilios registrados para Trabajo Remoto (Límite 50m).',
            },
            { status: 403 }
          );
        }
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

    // A) REGISTRO DE INGRESO (CHECK_IN) - FRANJA DINÁMICA
    if (currentAction === 'CHECK_IN') {
      if (record) {
        return NextResponse.json(
          { error: 'Ya registró su entrada el día de hoy.' },
          { status: 400 }
        );
      }

      const checkInStartMin = toTotalMinutes(checkInStartStr, 6 * 60);
      const checkInEndMin = toTotalMinutes(checkInEndStr, 11 * 60 + 59);
      if (totalMinutes < checkInStartMin || totalMinutes > checkInEndMin) {
        return NextResponse.json(
          {
            error: `La marcación de entrada solo está habilitada entre ${checkInStartStr} y ${checkInEndStr}.`,
          },
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

      const [workHour, workMin] = parseTimeHHMM(user.workStartTime, 9, 0);
      const expectedTime = buildPeruDateTime(dayKey, workHour, workMin);
      const graceLimitTime = new Date(
        expectedTime.getTime() + user.toleranceMinutes * 60_000
      );

      let lateMinutes = 0;
      let status: 'PRESENT' | 'LATE' = 'PRESENT';

      if (serverTimestamp > graceLimitTime) {
        status = 'LATE';
        const diffMs = serverTimestamp.getTime() - expectedTime.getTime();
        const totalLateMinutes = Math.floor(diffMs / (1000 * 60));
        lateMinutes = Math.max(0, totalLateMinutes - user.toleranceMinutes);
      }

      record = await prisma.attendanceRecord.create({
        data: {
          userId: user.id,
          locationId: matchedLocationId,
          date: today,
          checkIn: serverTimestamp,
          type,
          status,
          lateMinutes,
          latitude,
          longitude,
          employeeSignature: signature || user.signatureBase64 || null,
          observations: matchedLocationName ? `Sede: ${matchedLocationName}` : null,
        },
      });

      return NextResponse.json({
        success: true,
        action: 'CHECK_IN',
        message: 'Entrada registrada con éxito',
        status: record.status,
        lateMinutes,
        locationName: matchedLocationName || 'Trabajo Remoto',
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

      if (!lunchDays.includes(dayOfWeek)) {
        return NextResponse.json(
          { error: 'El día de hoy no contempla turno de refrigerio según la política de la empresa.' },
          { status: 400 }
        );
      }

      const lunchStartMin = toTotalMinutes(lunchWindowStartStr, 13 * 60);
      const lunchEndMin = toTotalMinutes(lunchWindowEndStr, 13 * 60 + 30);

      if (totalMinutes < lunchStartMin) {
        return NextResponse.json(
          {
            error: `El horario permitido para iniciar el refrigerio es a partir de las ${lunchWindowStartStr}.`,
          },
          { status: 400 }
        );
      }

      if (totalMinutes > lunchEndMin) {
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

    // C) FIN DE REFRIGERIO (LUNCH_END) - DURACIÓN Y TOPE DINÁMICO DE EMPRESA
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

      const lunchReturnMaxMin = toTotalMinutes(lunchReturnEndStr, 16 * 60 + 59);
      if (totalMinutes > lunchReturnMaxMin) {
        return NextResponse.json(
          {
            error: `El plazo máximo para marcar fin de refrigerio era hasta las ${lunchReturnEndStr}.`,
          },
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

    // D) REGISTRO DE SALIDA (CHECK_OUT) - FRANJA DINÁMICA DE EMPRESA
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

      const isSaturday = dayOfWeek === 6;
      const checkInEndMin = toTotalMinutes(checkInEndStr, 11 * 60 + 59);
      const checkOutStartMin = toTotalMinutes(checkOutStartStr, 17 * 60);

      if (isSaturday) {
        if (totalMinutes <= checkInEndMin) {
          return NextResponse.json(
            {
              error: `La marcación de salida los sábados inicia después de las ${checkInEndStr}.`,
            },
            { status: 400 }
          );
        }
      } else {
        if (totalMinutes < checkOutStartMin) {
          return NextResponse.json(
            {
              error: `La marcación de salida está habilitada a partir de las ${checkOutStartStr}.`,
            },
            { status: 400 }
          );
        }
      }

      const [workHour, workMin] = parseTimeHHMM(user.workStartTime, 9, 0);
      const hasLunchToday = lunchDays.includes(dayOfWeek);
      const userHoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;

      const effectiveDayHours = isSaturday ? saturdayWorkHours : userHoursPerDay;
      const lunchMinutesToday = hasLunchToday ? lunchDurationMinutes : 0;

      const expectedStart = buildPeruDateTime(dayKey, workHour, workMin);
      const officialCheckOut = new Date(
        expectedStart.getTime() +
          (Math.round(effectiveDayHours * 60) + lunchMinutesToday) * 60_000
      );

      const [winStartH, winStartM] = parseTimeHHMM(lunchWindowStartStr, 13, 0);
      const defaultLunchStart = buildPeruDateTime(dayKey, winStartH, winStartM);
      const defaultLunchEnd = new Date(
        defaultLunchStart.getTime() + lunchDurationMinutes * 60_000
      );

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