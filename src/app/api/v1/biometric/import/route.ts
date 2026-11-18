// src/app/api/v1/biometric/import/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertModuleEnabled } from '@/lib/module-guard';

interface RawPunch {
  enNo: string;
  deviceName: string;
  mode: string;
  inOut: string;
  dateTimeStr: string;
  timestamp: Date;
}

const formatTimePeru = (date: Date | null | undefined) => {
  if (!date) return '--:--';
  return date.toLocaleTimeString('es-PE', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const adminId = (formData.get('adminId') as string) || null;
    const companyIdParam = (formData.get('companyId') as string) || null;
    const filterType = (formData.get('filterType') as string) || 'ALL'; // 'ALL' | 'SINGLE_MONTH' | 'RANGE'
    const startMonth = (formData.get('startMonth') as string) || null; // Ej: "2026-11"
    const endMonth = (formData.get('endMonth') as string) || null;     // Ej: "2026-12"
    const customMappingRaw = formData.get('mapping') as string | null;
    const customMapping: Record<string, string> = customMappingRaw
      ? JSON.parse(customMappingRaw)
      : {};

    if (!file) {
      return NextResponse.json(
        { error: 'No se recibió el archivo del biométrico (.txt)' },
        { status: 400 }
      );
    }

    // Calcular rango opcional de meses (si filterType === 'ALL', ambos quedan en null)
    let minDateStr: string | null = null;
    let maxDateStr: string | null = null;

    if (filterType === 'SINGLE_MONTH' && startMonth) {
      minDateStr = `${startMonth}-01`;
      const [y, m] = startMonth.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      maxDateStr = `${startMonth}-${String(lastDay).padStart(2, '0')}`;
    } else if (filterType === 'RANGE') {
      if (startMonth) minDateStr = `${startMonth}-01`;
      if (endMonth) {
        const [y, m] = endMonth.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        maxDateStr = `${endMonth}-${String(lastDay).padStart(2, '0')}`;
      }
    }

    // Obtener empresa y verificar que el módulo BIOMETRIC_SYNC y la suscripción estén activos
    const company = companyIdParam
      ? await prisma.company.findUnique({ where: { id: companyIdParam } })
      : await prisma.company.findFirst();

    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    await assertModuleEnabled(company.id, 'BIOMETRIC_SYNC');

    // 1. Decodificar archivo (UTF-16LE con BOM como ALOG_001.txt o UTF-8)
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let content = '';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      content = new TextDecoder('utf-16le').decode(bytes);
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      content = new TextDecoder('utf-16be').decode(bytes);
    } else {
      content = new TextDecoder('utf-8').decode(bytes);
    }

    // 2. Parsear líneas tabuladas y aplicar filtro de rango de meses si corresponde
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const punches: RawPunch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split('\t').map((c) => c.trim());
      if (i === 0 && (cols[0] === 'No' || cols[2] === 'EnNo')) continue;
      if (cols.length < 10) continue;

      const enNo = cols[2];
      const deviceName = cols[3];
      const mode = cols[5];
      const inOut = cols[6];
      const dateTimeStr = cols[9];

      const dateOnly = dateTimeStr.split(' ')[0]; // "YYYY-MM-DD"
      if (minDateStr && dateOnly < minDateStr) continue;
      if (maxDateStr && dateOnly > maxDateStr) continue;

      const isoLocal = dateTimeStr.replace(' ', 'T') + '-05:00';
      const parsedDate = new Date(isoLocal);
      if (isNaN(parsedDate.getTime())) continue;

      punches.push({
        enNo,
        deviceName,
        mode,
        inOut,
        dateTimeStr,
        timestamp: parsedDate,
      });
    }

    if (punches.length === 0) {
      return NextResponse.json(
        { error: 'El archivo no contiene marcaciones válidas para el periodo seleccionado.' },
        { status: 400 }
      );
    }

    // 3. Obtener usuarios de la empresa para emparejar EnNo -> User
    const users = await prisma.user.findMany({
      where: { companyId: company.id },
      include: { payrollPolicy: true },
    });

    const resolveUser = (enNo: string) => {
      const paddedEnNo = enNo.padStart(8, '0');

      if (customMapping[paddedEnNo] || customMapping[enNo]) {
        const mappedId = customMapping[paddedEnNo] || customMapping[enNo];
        return users.find((u) => u.id === mappedId) || null;
      }

      const byCode = users.find(
        (u) => u.biometricCode && u.biometricCode.padStart(8, '0') === paddedEnNo
      );
      if (byCode) return byCode;

      return null;
    };

    // 4. Agrupar marcaciones por (enNo + Fecha YYYY-MM-DD)
    const dailyGroups = new Map<
      string,
      { enNo: string; deviceName: string; dateStr: string; items: RawPunch[] }
    >();

    for (const p of punches) {
      const dateStr = p.dateTimeStr.split(' ')[0];
      const key = `${p.enNo}_${dateStr}`;
      if (!dailyGroups.has(key)) {
        dailyGroups.set(key, {
          enNo: p.enNo,
          deviceName: p.deviceName,
          dateStr,
          items: [],
        });
      }
      dailyGroups.get(key)!.items.push(p);
    }

    let importedCount = 0;
    let mergedCount = 0;
    let unchangedCount = 0;
    let skippedProtectedCount = 0;
    const unmappedUsers = new Map<string, { enNo: string; deviceName: string; count: number }>();

    const pickEarliest = (a: Date | null | undefined, b: Date | null | undefined): Date | null => {
      if (a && b) return a.getTime() <= b.getTime() ? a : b;
      return a ?? b ?? null;
    };

    for (const group of dailyGroups.values()) {
      const user = resolveUser(group.enNo);

      if (!user) {
        const existing = unmappedUsers.get(group.enNo);
        unmappedUsers.set(group.enNo, {
          enNo: group.enNo,
          deviceName: group.deviceName,
          count: (existing?.count || 0) + group.items.length,
        });
        continue;
      }

      if (!user.biometricCode) {
        await prisma.user.update({
          where: { id: user.id },
          data: { biometricCode: group.enNo.padStart(8, '0') },
        });
        user.biometricCode = group.enNo.padStart(8, '0');
      }

      const recordDate = new Date(`${group.dateStr}T00:00:00.000Z`);

      // Verificar si el período está CERRADO
      const closedPeriod = await prisma.payrollPeriod.findFirst({
        where: {
          companyId: company.id,
          status: 'CLOSED',
          startDate: { lte: recordDate },
          endDate: { gte: recordDate },
        },
      });
      if (closedPeriod) {
        skippedProtectedCount++;
        continue;
      }

      // Ordenar y eliminar rebotes (< 5 minutos)
      const sorted = group.items.sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
      );
      const cleanPunches: RawPunch[] = [];
      for (const item of sorted) {
        const prev = cleanPunches[cleanPunches.length - 1];
        if (!prev || item.timestamp.getTime() - prev.timestamp.getTime() >= 5 * 60 * 1000) {
          cleanPunches.push(item);
        }
      }

      let bioCheckIn: Date | null = null;
      let bioCheckOut: Date | null = null;

      if (cleanPunches.length === 1) {
        const only = cleanPunches[0];
        const hour = parseInt(only.dateTimeStr.split(' ')[1].split(':')[0], 10);
        if (only.inOut === 'DutyOff' && hour >= 13) {
          bioCheckOut = only.timestamp;
        } else {
          bioCheckIn = only.timestamp;
        }
      } else if (cleanPunches.length >= 2) {
        bioCheckIn = cleanPunches[0].timestamp;
        bioCheckOut = cleanPunches[cleanPunches.length - 1].timestamp;
      }

      const existingRecord = await prisma.attendanceRecord.findUnique({
        where: {
          userId_date: {
            userId: user.id,
            date: recordDate,
          },
        },
      });

      // Proteger días con Licencia Sin Goce o ya rectificados manualmente por RRHH
      if (
        existingRecord?.observations?.includes('SIN GOCE') ||
        existingRecord?.isModifiedByHR
      ) {
        skippedProtectedCount++;
        continue;
      }

      // Fusión: "El que marcó primero gana" (Celular vs Biométrico)
      const finalCheckIn = pickEarliest(existingRecord?.checkIn, bioCheckIn);
      const finalCheckOut = pickEarliest(existingRecord?.checkOut, bioCheckOut);

      // 👉 AQUÍ VA EL CÁLCULO AUTOMÁTICO DE REFRIGERIO (13:00 A 14:00 LUNES A VIERNES)
      const isWeekday = recordDate.getUTCDay() >= 1 && recordDate.getUTCDay() <= 5;
      const defaultLunchStart = new Date(`${group.dateStr}T13:00:00-05:00`);
      const defaultLunchEnd = new Date(`${group.dateStr}T14:00:00-05:00`);

      let finalLunchStart = existingRecord?.lunchStart ?? null;
      let finalLunchEnd = existingRecord?.lunchEnd ?? null;

      if (
        isWeekday &&
        !finalLunchStart &&
        !finalLunchEnd &&
        finalCheckIn &&
        finalCheckOut &&
        finalCheckIn < defaultLunchStart &&
        finalCheckOut > defaultLunchEnd
      ) {
        finalLunchStart = defaultLunchStart;
        finalLunchEnd = defaultLunchEnd;
      }

      // Idempotencia: si no hubo ningún cambio en marcas ni refrigerio y no estaba como ABSENT, omitir
      const sameIn =
        (existingRecord?.checkIn?.getTime() ?? null) === (finalCheckIn?.getTime() ?? null);
      const sameOut =
        (existingRecord?.checkOut?.getTime() ?? null) === (finalCheckOut?.getTime() ?? null);
      const sameLunchStart =
        (existingRecord?.lunchStart?.getTime() ?? null) === (finalLunchStart?.getTime() ?? null);
      const sameLunchEnd =
        (existingRecord?.lunchEnd?.getTime() ?? null) === (finalLunchEnd?.getTime() ?? null);

      if (
        existingRecord &&
        existingRecord.status !== 'ABSENT' &&
        sameIn &&
        sameOut &&
        sameLunchStart &&
        sameLunchEnd
      ) {
        unchangedCount++;
        continue;
      }

      // Recalcular Tardanza y Horas Extras sobre finalCheckIn y finalCheckOut
      let lateMinutes = 0;
      let status: 'PRESENT' | 'LATE' = 'PRESENT';
      const [wH, wM] = (user.workStartTime || '09:00').split(':').map(Number);

      if (finalCheckIn) {
        const expectedStart = new Date(
          `${group.dateStr}T${String(wH).padStart(2, '0')}:${String(wM).padStart(2, '0')}:00-05:00`
        );
        const graceLimit = new Date(
          expectedStart.getTime() + (user.toleranceMinutes || 10) * 60 * 1000
        );
        if (finalCheckIn > graceLimit) {
          status = 'LATE';
          const totalDiff = Math.floor((finalCheckIn.getTime() - expectedStart.getTime()) / 60000);
          lateMinutes = Math.max(0, totalDiff - (user.toleranceMinutes || 10));
        }
      }

      let totalOvertimeMinutes = 0;
      let overtime25Minutes = 0;
      let overtime35Minutes = 0;
      const hoursPerDay = user.payrollPolicy?.hoursPerDay || 8.0;

      if (finalCheckOut) {
        const isSaturday = recordDate.getUTCDay() === 6;
        const expectedStart = new Date(
          `${group.dateStr}T${String(wH).padStart(2, '0')}:${String(wM).padStart(2, '0')}:00-05:00`
        );
        // Sábados: 09:00 a 13:30 (4.5 horas sin refrigerio) | Lunes a Viernes: 8h + 1h refrigerio
        const officialOut = isSaturday
          ? new Date(expectedStart.getTime() + 4.5 * 3600 * 1000)
          : new Date(expectedStart.getTime() + (hoursPerDay + 1.0) * 3600 * 1000);

        if (finalCheckOut > officialOut) {
          const rawOt = Math.floor((finalCheckOut.getTime() - officialOut.getTime()) / 60000);
          totalOvertimeMinutes = Math.max(0, rawOt - lateMinutes);
          overtime25Minutes = Math.min(totalOvertimeMinutes, 120);
          overtime35Minutes = Math.max(0, totalOvertimeMinutes - 120);
        }
      }

      const traceNote =
        existingRecord && existingRecord.status !== 'ABSENT'
          ? `Fusión App (${formatTimePeru(existingRecord.checkIn)} / ${formatTimePeru(existingRecord.checkOut)}) + Biométrico #${group.enNo} (${formatTimePeru(bioCheckIn)} / ${formatTimePeru(bioCheckOut)}) -> Aplicado: ${formatTimePeru(finalCheckIn)} / ${formatTimePeru(finalCheckOut)}`
          : `Biométrico #${group.enNo} (${group.deviceName}): IN ${formatTimePeru(finalCheckIn)} | OUT ${formatTimePeru(finalCheckOut)}`;

      if (existingRecord) {
        await prisma.attendanceRecord.update({
          where: { id: existingRecord.id },
          data: {
            checkIn: finalCheckIn,
            lunchStart: finalLunchStart,
            lunchEnd: finalLunchEnd,
            checkOut: finalCheckOut,
            type:
              existingRecord.status === 'ABSENT'
                ? 'BIOMETRIC_FINGERPRINT'
                : existingRecord.type,
            status,
            lateMinutes,
            overtimeMinutes: totalOvertimeMinutes,
            overtime25Minutes,
            overtime35Minutes,
            observations: traceNote,
          },
        });
        mergedCount++;
      } else {
        await prisma.attendanceRecord.create({
          data: {
            userId: user.id,
            date: recordDate,
            checkIn: finalCheckIn,
            lunchStart: finalLunchStart,
            lunchEnd: finalLunchEnd,
            checkOut: finalCheckOut,
            type: 'BIOMETRIC_FINGERPRINT',
            status,
            lateMinutes,
            overtimeMinutes: totalOvertimeMinutes,
            overtime25Minutes,
            overtime35Minutes,
            latitude: company.officeLat,
            longitude: company.officeLng,
            observations: traceNote,
          },
        });
        importedCount++;
      }
    }

    if (adminId && (importedCount > 0 || mergedCount > 0)) {
      await prisma.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'ATTENDANCE_RECORD',
          entityId: file.name,
          action: 'IMPORT_BIOMETRIC_ALOG',
          newValue: `Nuevos: ${importedCount}, Fusionados: ${mergedCount}, Sin cambios: ${unchangedCount}`,
          reason: 'Sincronización idempotente de marcaciones biométricas',
        },
      });
    }

    return NextResponse.json({
      success: true,
      importedDays: importedCount,
      mergedDays: mergedCount,
      unchangedDays: unchangedCount,
      skippedProtectedDays: skippedProtectedCount,
      unmappedUsers: Array.from(unmappedUsers.values()),
    });
  } catch (error: any) {
    console.error('❌ Error importando biométrico:', error);
    const isForbidden =
      error.message?.includes('MODULE_DISABLED') ||
      error.message?.includes('TRIAL_EXPIRED') ||
      error.message?.includes('SUBSCRIPTION_INACTIVE');
    return NextResponse.json(
      { error: error.message },
      { status: isForbidden ? 403 : 500 }
    );
  }
}