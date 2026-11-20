import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BIOMETRIC_API_KEY =
  process.env.BIOMETRIC_API_KEY || 'HYPERION_BIOMETRIC_KEY_2026';

export async function POST(req: NextRequest) {
  try {
    // 1. Validar token de seguridad (Header x-api-key o Bearer)
    const authHeader =
      req.headers.get('x-api-key') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (authHeader !== BIOMETRIC_API_KEY) {
      return NextResponse.json(
        { status: 'error', message: 'API Key biométrica inválida o ausente' },
        { status: 401 }
      );
    }

    const rawBody = await req.json();
    const logs = Array.isArray(rawBody)
      ? rawBody
      : Array.isArray(rawBody.data)
      ? rawBody.data
      : [rawBody];

    let processed = 0;
    const errors: string[] = [];

    for (const item of logs) {
      const rawCode = String(
        item.EmployeeCode || item.EnrollmentId || item.Cardno || ''
      ).trim();

      if (!rawCode) {
        errors.push('Registro sin EmployeeCode/EnrollmentId');
        continue;
      }

      const trimmedCode = rawCode.replace(/^0+/, '') || rawCode;

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { dni: rawCode },
            { dni: trimmedCode },
            { dni: { endsWith: trimmedCode } },
          ],
        },
      });

      if (!user) {
        errors.push(`Trabajador no encontrado para código: ${rawCode}`);
        continue;
      }

      const dateTimeStr = String(item.PunchDateAndTime || '').trim();
      const punchDate = dateTimeStr
        ? new Date(dateTimeStr.replace(' ', 'T') + '-05:00')
        : new Date();

      if (isNaN(punchDate.getTime())) {
        errors.push(`Fecha inválida en registro de ${rawCode}: ${dateTimeStr}`);
        continue;
      }

      const dayKey = dateTimeStr.slice(0, 10); // yyyy-MM-dd
      const recordDate = new Date(`${dayKey}T00:00:00.000-05:00`);

      const existing = await prisma.attendanceRecord.findFirst({
        where: {
          userId: user.id,
          date: recordDate,
        },
      });

      const deviceInfo = `Biométrico ${item.DeviceName || item.DevicesId || 'Reloj Sede'} (SN: ${item.SerialNo || 'N/A'})`;
      const userSig = (user as any).signatureBase64 || (user as any).signature || null;

      if (!existing) {
        // 1ra marcación del día -> Ingreso
        await (prisma.attendanceRecord as any).create({
          data: {
            userId: user.id,
            date: recordDate,
            checkIn: punchDate,
            status: 'PRESENT',
            ...(userSig ? { signature: userSig } : {}),
            notes: `Marcación vía ${deviceInfo}`,
          },
        });
      } else {
        // Evitar duplicados si el reloj reenvía un log con menos de 2 minutos de diferencia
        const times = [
          existing.checkIn,
          existing.lunchStart,
          existing.lunchEnd,
          existing.checkOut,
        ].filter(Boolean) as Date[];

        const isDuplicate = times.some(
          (t) => Math.abs(t.getTime() - punchDate.getTime()) < 2 * 60 * 1000
        );
        if (isDuplicate) continue;

        // Asignar secuencialmente: Ingreso -> Inicio Ref. -> Fin Ref. -> Salida
        const updateData: any = {};
        if (!existing.checkIn) {
          updateData.checkIn = punchDate;
        } else if (!existing.lunchStart) {
          updateData.lunchStart = punchDate;
        } else if (!existing.lunchEnd) {
          updateData.lunchEnd = punchDate;
        } else if (!existing.checkOut) {
          updateData.checkOut = punchDate;
        } else {
          updateData.checkOut = punchDate;
        }

        const existingRecord = existing as any;
        if (!existingRecord.signature && userSig) {
          updateData.signature = userSig;
        }

        await prisma.attendanceRecord.update({
          where: { id: existing.id },
          data: updateData,
        });
      }

      processed++;
    }

    return NextResponse.json({
      status: 'success',
      processed,
      errors,
    });
  } catch (error: any) {
    console.error('Error procesando marcación biométrica:', error);
    return NextResponse.json(
      { status: 'error', message: error.message || 'Error interno del servidor' },
      { status: 500 }
    );
  }
}