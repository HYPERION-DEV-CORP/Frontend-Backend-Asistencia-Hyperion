import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AttendanceType } from '@prisma/client';
import { BiometricPunchInput, processBiometricPunches } from '@/lib/biometric-processor';

// GET: Consultar estado del Modo Demo en vivo
export async function GET() {
  const company = await prisma.company.findFirst();
  return NextResponse.json({
    success: true,
    demoMode: company?.biometricDemoMode ?? false,
  });
}

// POST: Activar/desactivar Modo Demo físico, ejecutar escenarios simulados o limpiar día
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, dateStr, scenario, demoMode } = body;

    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json({ error: 'Empresa no configurada' }, { status: 400 });
    }

    // 1. Cambiar interruptor de Modo Demo Físico
    if (action === 'TOGGLE_DEMO') {
      const updated = await prisma.company.update({
        where: { id: company.id },
        data: { biometricDemoMode: Boolean(demoMode) },
      });
      return NextResponse.json({
        success: true,
        demoMode: updated.biometricDemoMode,
        message: updated.biometricDemoMode
          ? 'Modo Demo Físico ACTIVADO: los próximos 4 toques en el reloj llenarán Entrada, Refrigerio y Salida en secuencia.'
          : 'Modo Demo Físico DESACTIVADO: el reloj volvió a las reglas horarias reales de producción.',
      });
    }

    if (!userId || !dateStr) {
      return NextResponse.json({ error: 'userId y dateStr son obligatorios' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'Trabajador no encontrado' }, { status: 404 });
    }

    const dayDate = new Date(`${dateStr}T00:00:00.000Z`);

    // 2. Limpiar registro de prueba de ese empleado en esa fecha
    if (action === 'RESET_DAY') {
      await prisma.attendanceRecord.deleteMany({
        where: { userId: user.id, date: dayDate },
      });
      return NextResponse.json({
        success: true,
        message: `Asistencia del ${dateStr} limpiada para ${user.name} ${user.lastName}.`,
      });
    }

    // 3. Ejecutar batería de marcaciones con horas simuladas (probando las reglas reales)
    if (action === 'RUN_SCENARIO') {
      // Limpiamos primero ese día para ver el resultado limpio del escenario
      await prisma.attendanceRecord.deleteMany({
        where: { userId: user.id, date: dayDate },
      });

      const scenariosMap: Record<string, { time: string; method: AttendanceType }[]> = {
        // Escenario 1: Puntual con 4 marcaciones reales + duplicado de entrada
        JORNADA_COMPLETA_PUNTUAL: [
          { time: '08:52:10', method: 'BIOMETRIC_FINGERPRINT' },
          { time: '08:52:14', method: 'BIOMETRIC_FINGERPRINT' }, // Duplicado (debe conservar 08:52:10)
          { time: '13:05:00', method: 'PRESENTIAL_NFC' },        // Inicio refrigerio (1:00 - 1:30 pm)
          { time: '13:58:00', method: 'PRESENTIAL_NFC' },        // Fin refrigerio
          { time: '18:02:00', method: 'BIOMETRIC_FINGERPRINT' }, // Salida (>= 5:00 pm)
        ],
        // Escenario 2: Tardanza + Horas Extras (25% y 35%)
        TARDANZA_Y_HORAS_EXTRAS: [
          { time: '09:25:00', method: 'BIOMETRIC_FINGERPRINT' }, // Tardanza
          { time: '13:10:00', method: 'BIOMETRIC_FINGERPRINT' }, // Inicio refrigerio
          { time: '20:30:00', method: 'BIOMETRIC_FINGERPRINT' }, // Salida con > 2h extras
        ],
        // Escenario 3: Sábado (09:00 a 13:30 sin refrigerio)
        SABADO_SIN_REFRIGERIO: [
          { time: '08:58:00', method: 'BIOMETRIC_FINGERPRINT' },
          { time: '13:32:00', method: 'BIOMETRIC_FINGERPRINT' },
        ],
        // Escenario 4: Código no registrado en el reloj (va a UnmatchedBiometricLog)
        CODIGO_NO_RECONOCIDO: [
          { time: '08:55:00', method: 'BIOMETRIC_FINGERPRINT' },
        ],
      };

      const selectedPunches = scenariosMap[scenario] || scenariosMap.JORNADA_COMPLETA_PUNTUAL;
      const targetCode = scenario === 'CODIGO_NO_RECONOCIDO' ? '99887766' : user.dni;

      const inputs: BiometricPunchInput[] = selectedPunches.map((item) => ({
        empCode: targetCode,
        serialNo: 'SIMULADOR-WEB',
        method: item.method,
        punchTime: new Date(`${dateStr}T${item.time}.000-05:00`),
        dayKey: dateStr,
        dayDate,
      }));

      const result = await processBiometricPunches(inputs, {
        saveUnmatched: true,
        demoMode: false, // Evalúa las reglas estrictas reales de producción
      });

      return NextResponse.json({
        success: true,
        processed: result.processed,
        errors: result.errors,
        message: `Escenario "${scenario}" ejecutado (${result.processed} eventos procesados).`,
      });
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Error en simulador biométrico' },
      { status: 500 }
    );
  }
}