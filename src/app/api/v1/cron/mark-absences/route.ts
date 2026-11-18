// src/app/api/v1/cron/mark-absences/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  try {
    // Validar token secreto si se invoca desde Cron externo
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isExternalCron = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);

    if (cronSecret && authHeader && !isExternalCron) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      companyId,
      startDate: startParam,
      endDate: endParam,
      adminId,
      includeToday = true, // Desde el panel RRHH evalúa desde el día 1 del mes hasta hoy
    } = body;

    // Hora actual en Perú (UTC-5)
    const nowPeru = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const todayStr = nowPeru.toISOString().split('T')[0]; // Ej: "2026-11-17"
    const currentMonthStartStr = `${todayStr.slice(0, 7)}-01`; // Ej: "2026-11-01"

    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);

    // Por defecto: desde el 1ro del mes actual hasta hoy (o hasta ayer si es el cron de medianoche)
    const rangeStart = startParam
      ? new Date(`${startParam}T00:00:00.000Z`)
      : new Date(`${currentMonthStartStr}T00:00:00.000Z`);

    const defaultEnd = isExternalCron || !includeToday ? yesterdayDate : todayDate;
    const rangeEnd = endParam ? new Date(`${endParam}T00:00:00.000Z`) : defaultEnd;

    // Nunca marcar faltas para fechas futuras (mañana en adelante)
    const effectiveEnd = rangeEnd > todayDate ? todayDate : rangeEnd;

    if (rangeStart > effectiveEnd) {
      return NextResponse.json({
        success: true,
        createdAbsences: 0,
        message: 'No hay días pendientes por auditar en el rango seleccionado.',
      });
    }

    // Obtener empresas activas con el módulo AUTO_ABSENCE_CRON habilitado
    const companies = await prisma.company.findMany({
      where: {
        ...(companyId ? { id: companyId } : {}),
        subscriptionStatus: 'ACTIVE',
        enabledModules: { has: 'AUTO_ABSENCE_CRON' },
      },
      include: {
        users: {
          where: {
            isActive: true,
            isSubjectToSupervision: true,
          },
        },
      },
    });

    let createdAbsences = 0;

    for (const company of companies) {
      for (const user of company.users) {
        const cursor = new Date(rangeStart);

        while (cursor <= effectiveEnd) {
          const dayOfWeek = cursor.getUTCDay(); // 0 = Domingo, 6 = Sábado
          const cursorStr = cursor.toISOString().split('T')[0];

          // EXONERACIÓN TOTAL DE DOMINGOS (Descanso semanal obligatorio)
          if (dayOfWeek !== 0) {
            // 1. Verificar si el período de planilla está CERRADO
            const closedPeriod = await prisma.payrollPeriod.findFirst({
              where: {
                companyId: company.id,
                status: 'CLOSED',
                startDate: { lte: cursor },
                endDate: { gte: cursor },
              },
            });

            if (!closedPeriod) {
              // 2. Verificar si ya existe registro de asistencia (o si ya marcó hoy)
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
                  const isSaturday = dayOfWeek === 6;
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
                      observations: isSaturday
                        ? 'Falta injustificada detectada automáticamente (Sábado 09:00 - 13:30 sin marcación ni papeleta)'
                        : 'Falta injustificada detectada automáticamente (sin marcación ni papeleta)',
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
          newValue: `${createdAbsences} faltas injustificadas generadas (${rangeStart.toISOString().split('T')[0]} al ${effectiveEnd.toISOString().split('T')[0]})`,
          reason: 'Auditoría mensual de inasistencias (domingos exonerados)',
        },
      });
    }

    return NextResponse.json({
      success: true,
      createdAbsences,
      message: `Auditoría del mes completada (${rangeStart.toISOString().split('T')[0]} al ${effectiveEnd.toISOString().split('T')[0]}): ${createdAbsences} falta(s) injustificada(s) registrada(s). Domingos exonerados.`,
    });
  } catch (error: any) {
    console.error('❌ Error detectando faltas automáticas:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}