import { prisma } from '@/lib/prisma';

const DEFAULT_MAX_LUNCH_MINUTES = 60; // Mínimo legal Perú: 45 min (ajustable a 60 según política)

export function calculateLunchExcessMinutes(
  lunchStart?: Date | null,
  lunchEnd?: Date | null,
  allowedMinutes = DEFAULT_MAX_LUNCH_MINUTES
): { totalLunchMinutes: number; excessMinutes: number } {
  if (!lunchStart || !lunchEnd) {
    return { totalLunchMinutes: 0, excessMinutes: 0 };
  }

  const diffMs = new Date(lunchEnd).getTime() - new Date(lunchStart).getTime();
  if (diffMs <= 0) {
    return { totalLunchMinutes: 0, excessMinutes: 0 };
  }

  const totalLunchMinutes = Math.round(diffMs / 60000);
  const excessMinutes = Math.max(0, totalLunchMinutes - allowedMinutes);

  return { totalLunchMinutes, excessMinutes };
}

export async function getSstWorkloadAlerts() {
  // Analizar los últimos 7 días calendario
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const users = await prisma.user.findMany({
    include: {
      payrollPolicy: true,
      attendanceRecords: {
        where: {
          date: { gte: sevenDaysAgo },
        },
        orderBy: { date: 'desc' },
      },
    },
    orderBy: { lastName: 'asc' },
  });

  return users.map((u) => {
    let totalEffectiveMinutes7d = 0;
    let totalLunchExcessMinutes7d = 0;
    let daysWithoutLunch = 0;
    let maxDailyHours = 0;

    for (const rec of u.attendanceRecords) {
      if (rec.checkIn && rec.checkOut) {
        const grossMs = new Date(rec.checkOut).getTime() - new Date(rec.checkIn).getTime();
        const grossMinutes = Math.max(0, Math.round(grossMs / 60000));

        const { totalLunchMinutes, excessMinutes } = calculateLunchExcessMinutes(
          rec.lunchStart,
          rec.lunchEnd,
          DEFAULT_MAX_LUNCH_MINUTES
        );

        // Descontar el tiempo real de refrigerio para obtener horas efectivas laboradas
        const effectiveMinutes = Math.max(0, grossMinutes - totalLunchMinutes);
        totalEffectiveMinutes7d += effectiveMinutes;
        totalLunchExcessMinutes7d += excessMinutes;

        const dailyHours = effectiveMinutes / 60;
        if (dailyHours > maxDailyHours) {
          maxDailyHours = dailyHours;
        }

        // Alerta SST: Jornada mayor a 6 horas sin haber marcado refrigerio
        if (grossMinutes > 360 && (!rec.lunchStart || !rec.lunchEnd)) {
          daysWithoutLunch++;
        }
      }
    }

    const weeklyEffectiveHours = Number((totalEffectiveMinutes7d / 60).toFixed(2));
    const alerts: { level: 'HIGH' | 'MEDIUM'; message: string }[] = [];

    if (weeklyEffectiveHours > 48) {
      alerts.push({
        level: 'HIGH',
        message: `Exceso de jornada máxima (Ley 29783 / Art. 25 Const.): ${weeklyEffectiveHours}h acumuladas en 7 días (Límite: 48h).`,
      });
    }

    if (maxDailyHours > 10) {
      alerts.push({
        level: 'HIGH',
        message: `Riesgo de fatiga aguda: Jornada diaria de ${maxDailyHours.toFixed(1)}h continuas detectada.`,
      });
    }

    if (daysWithoutLunch > 0) {
      alerts.push({
        level: 'MEDIUM',
        message: `Incumplimiento de descanso: ${daysWithoutLunch} día(s) laborado(s) >6h sin registro de refrigerio.`,
      });
    }

    if (totalLunchExcessMinutes7d > 15) {
      alerts.push({
        level: 'MEDIUM',
        message: `Exceso acumulado de refrigerio: +${totalLunchExcessMinutes7d} min sobre el límite de ${DEFAULT_MAX_LUNCH_MINUTES} min.`,
      });
    }

    return {
      userId: u.id,
      fullName: `${u.name} ${u.lastName}`,
      dni: u.dni,
      jobTitle: u.jobTitle,
      weeklyEffectiveHours,
      maxDailyHours: Number(maxDailyHours.toFixed(2)),
      totalLunchExcessMinutes7d,
      daysWithoutLunch,
      riskLevel: alerts.some((a) => a.level === 'HIGH')
        ? 'ALTO'
        : alerts.length > 0
        ? 'MEDIO'
        : 'NORMAL',
      alerts,
    };
  });
}