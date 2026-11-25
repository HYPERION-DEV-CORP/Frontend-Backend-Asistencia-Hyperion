import { NextRequest, NextResponse } from 'next/server';
import { AttendanceType } from '@prisma/client';
import {
  BiometricPunchInput,
  processBiometricPunches,
} from '@/lib/biometric-processor';

const API_KEY = process.env.BIOMETRIC_API_KEY || 'HYPERION_BIOMETRIC_KEY_2026';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = req.headers.get('x-api-key') || searchParams.get('api_key');

    if (key !== API_KEY) {
      return NextResponse.json(
        { status: 'error', message: 'API Key inválida' },
        { status: 401 }
      );
    }

    const rawBody = await req.json();
    const punches = Array.isArray(rawBody) ? rawBody : [rawBody];
    if (punches.length === 0) {
      return NextResponse.json({ status: 'success', processed: 0, errors: [] });
    }

    const parsedPunches: BiometricPunchInput[] = [];

    for (const item of punches) {
      const empCode = String(item.EmployeeCode || '').trim();
      const punchStr = String(item.PunchDateAndTime || '').trim();
      if (!empCode || !punchStr) continue;

      const punchTime = new Date(
        punchStr.includes('T') ? punchStr : `${punchStr.replace(' ', 'T')}-05:00`
      );
      if (isNaN(punchTime.getTime())) continue;

      const dayDate = new Date(`${punchStr.slice(0, 10)}T00:00:00.000Z`);
      const dayKey = punchStr.slice(0, 10);

      const method: AttendanceType =
        item.VerificationMethod === 'BIOMETRIC_RFID'
          ? 'PRESENTIAL_NFC'
          : 'BIOMETRIC_FINGERPRINT';

      parsedPunches.push({
        empCode,
        serialNo: String(item.SerialNo || 'Reloj'),
        method,
        punchTime,
        dayKey,
        dayDate,
      });
    }

    const result = await processBiometricPunches(parsedPunches, {
      saveUnmatched: true,
    });

    return NextResponse.json({
      status: 'success',
      processed: result.processed,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('❌ Error en endpoint biométrico:', error);
    return NextResponse.json(
      { status: 'error', message: error?.message || 'Error interno' },
      { status: 500 }
    );
  }
}