// src/app/api/v1/cron/mark-absences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // Validar token secreto si se invoca desde Cron externo
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { companyId, startDate: startParam, endDate: endParam, adminId } = body;

    // Por defecto evalúa los últimos 7 días hasta ayer (hora Perú)
    const nowPeru = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const todayStr = nowPeru.toISOString().split('T')[0];
    const yesterday = new Date(`${todayStr}T00:00:00.000Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const defaultStart = new Date(yesterday);
    defaultStart.setUTCDate(defaultStart.getUTCDate() - 6);

    const rangeStart = startParam ? new Date(`${startParam}T00:00:00.000Z`) : defaultStart;
    const rangeEnd = endParam ? new Date(`${endParam}T00:00:00.000Z`) : yesterday;

    // Nunca marcar faltas para hoy o fechas futuras
    const effectiveEnd = rangeEnd > yesterday ? yesterday : rangeEnd;

    if (rangeStart > effectiveEnd) {
      return NextResponse.json({
        success: true,
        createdAbsences: 0,
        message: 'No hay días pasados pendientes por auditar en el rango.',
      });
    }

    // Obtener empresas con el módulo AUTO_ABSENCE_CRON habilitado y suscripción activa
    const companies = await prisma.company.findMany({
      where: {
        ...(companyId ? { id: companyId } : {}),
        subscriptionStatus: 'ACTIVE',
        enabledModules: { has: 'AUTO_ABSENCE_CRON' },
      },
      include: {
        users: {
          where: { isActive: true, role: { not: 'ADMIN' } },
        },
      },
    });

    let createdAbsences = 0;

    for (const company of companies) {
      for (const user of company.users) {
        const cursor = new Date(rangeStart);

        while (cursor <= effectiveEnd) {
          const dayOfWeek = cursor.getUTCDay(); // 0 = Domingo
          const cursorStr = cursor.toISOString().split('T')[0];

          // Omitir domingos (día de descanso semanal obligatorio)
          if (dayOfWeek !== 0) {
            // 1. Verificar si el período está cerrado
            const closedPeriod = await prisma.payrollPeriod.findFirst({
              where: {
                companyId: company.id,
                status: 'CLOSED',
                startDate: { lte: cursor },
                endDate: { gte: cursor },
              },
            });

            if (!closedPeriod) {
              // 2. Verificar si ya existe registro de asistencia ese día
              const existingRecord = await prisma.attendanceRecord.findUnique({
                where: {
                  userId_date: {
                    userId: user.id,
                    date: cursor,
                  },
                },
              });

              if (!existingRecord) {
                // 3. Verificar si tiene una papeleta aprobada (vacaciones, descanso médico, comisión o permiso)
                const dayStartUtc = new Date(`${cursorStr}T05:00:00.000Z`);
                const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 60 * 60 * 1000);

                const approvedPermission = await prisma.permissionRequest.findFirst({
                  where: {
                    userId: user.id,
                    status: 'APPROVED',
                    startDate: { lt: dayEndUtc },
                    endDate: { gt: dayStartUtc },
                  },
                });

                if (!approvedPermission) {
                  await prisma.attendanceRecord.create({
                    data: {
                      userId: user.id,
                      date: cursor,
                      checkIn: null,
                      checkOut: null,
                      status: 'ABSENT',
                      lateMinutes: 0,
                      overtimeMinutes: 0,
                      latitude: company.officeLat,
                      longitude: company.officeLng,
                      observations:
                        'Falta injustificada detectada automáticamente (sin marcación ni papeleta)',
                    },
                  });
                  createdAbsences++;
                }
              }
            }
          }

          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
    }

    if (adminId && createdAbsences > 0) {
      await prisma.auditLog.create({
        data: {
          performedById: adminId,
          entity: 'ATTENDANCE_RECORD',
          entityId: 'AUTO_ABSENCE_BATCH',
          action: 'DETECT_UNJUSTIFIED_ABSENCES',
          newValue: `${createdAbsences} faltas injustificadas registradas`,
          reason: 'Ejecución de auditoría automática de inasistencias',
        },
      });
    }

    return NextResponse.json({
      success: true,
      createdAbsences,
      message: `Auditoría completada: ${createdAbsences} falta(s) injustificada(s) registrada(s).`,
    });
  } catch (error: any) {
    console.error('❌ Error detectando faltas automáticas:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}