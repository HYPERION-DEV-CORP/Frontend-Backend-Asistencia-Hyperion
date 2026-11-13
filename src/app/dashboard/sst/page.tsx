'use client';

import { useState, useEffect } from 'react';
import { HardHat, AlertTriangle, CheckCircle2, Clock, UtensilsCrossed } from 'lucide-react';

interface SstWorkerReport {
  userId: string;
  fullName: string;
  dni: string;
  jobTitle: string;
  weeklyEffectiveHours: number;
  maxDailyHours: number;
  totalLunchExcessMinutes7d: number;
  daysWithoutLunch: number;
  riskLevel: 'ALTO' | 'MEDIO' | 'NORMAL';
  alerts: { level: 'HIGH' | 'MEDIUM'; message: string }[];
}

export default function SstDashboardPage() {
  const [workers, setWorkers] = useState<SstWorkerReport[]>([]);
  const [summary, setSummary] = useState({
    totalWorkers: 0,
    highRiskCount: 0,
    mediumRiskCount: 0,
    compliantCount: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/hr/sst')
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setWorkers(data.workers || []);
          setSummary(data.summary);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Cabecera Ley 29783 */}
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <HardHat className="w-6 h-6 text-[#00BFA5]" />
          Seguridad y Salud en el Trabajo (Ley N° 29783)
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Monitoreo preventivo de fatiga laboral, jornada máxima semanal (48h) y cumplimiento de pausas de refrigerio (últimos 7 días).
        </p>
      </div>

      {/* KPIs SST */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-5">
          <span className="text-[11px] font-bold uppercase text-slate-400">Personal Monitoreado</span>
          <p className="text-3xl font-extrabold text-white mt-2">{summary.totalWorkers}</p>
        </div>

        <div className="bg-slate-950 border border-rose-900/60 rounded-xl p-5">
          <span className="text-[11px] font-bold uppercase text-rose-400">Riesgo Alto (Sobrecarga &gt;48h)</span>
          <p className="text-3xl font-extrabold text-rose-500 mt-2">{summary.highRiskCount}</p>
        </div>

        <div className="bg-slate-950 border border-amber-900/60 rounded-xl p-5">
          <span className="text-[11px] font-bold uppercase text-amber-400">Observaciones Refrigerio</span>
          <p className="text-3xl font-extrabold text-amber-400 mt-2">{summary.mediumRiskCount}</p>
        </div>

        <div className="bg-slate-950 border border-emerald-900/60 rounded-xl p-5">
          <span className="text-[11px] font-bold uppercase text-emerald-400">Jornada Saludable</span>
          <p className="text-3xl font-extrabold text-emerald-400 mt-2">{summary.compliantCount}</p>
        </div>
      </div>

      {/* Tabla de Monitoreo Preventivo */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900 text-[11px] uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-5 py-3.5">Colaborador</th>
              <th className="px-5 py-3.5">Horas Efectivas (7d)</th>
              <th className="px-5 py-3.5">Jornada Máx. Diaria</th>
              <th className="px-5 py-3.5">Exceso Refrigerio</th>
              <th className="px-5 py-3.5">Nivel Riesgo SST</th>
              <th className="px-5 py-3.5">Alertas Preventivas Ley 29783</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  Analizando indicadores ergonómicos y de jornada...
                </td>
              </tr>
            ) : (
              workers.map((w) => (
                <tr key={w.userId} className="hover:bg-slate-900/50">
                  <td className="px-5 py-4">
                    <div className="font-bold text-white">{w.fullName}</div>
                    <div className="text-[11px] text-slate-500">
                      DNI: {w.dni} • {w.jobTitle}
                    </div>
                  </td>

                  <td className="px-5 py-4 font-mono">
                    <span
                      className={`font-bold ${
                        w.weeklyEffectiveHours > 48 ? 'text-rose-400' : 'text-white'
                      }`}
                    >
                      {w.weeklyEffectiveHours} hrs
                    </span>
                    <span className="text-slate-500"> / 48h</span>
                  </td>

                  <td className="px-5 py-4 font-mono">
                    <span className="inline-flex items-center gap-1 text-slate-300">
                      <Clock className="w-3.5 h-3.5 text-[#00BFA5]" />
                      {w.maxDailyHours} hrs
                    </span>
                  </td>

                  <td className="px-5 py-4 font-mono">
                    {w.totalLunchExcessMinutes7d > 0 ? (
                      <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                        <UtensilsCrossed className="w-3.5 h-3.5" />
                        +{w.totalLunchExcessMinutes7d} min
                      </span>
                    ) : (
                      <span className="text-slate-500">0 min</span>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${
                        w.riskLevel === 'ALTO'
                          ? 'bg-rose-950/60 text-rose-400 border-rose-800'
                          : w.riskLevel === 'MEDIO'
                          ? 'bg-amber-950/60 text-amber-400 border-amber-800'
                          : 'bg-emerald-950/60 text-emerald-400 border-emerald-800'
                      }`}
                    >
                      {w.riskLevel}
                    </span>
                  </td>

                  <td className="px-5 py-4">
                    {w.alerts.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sin observaciones SST
                      </span>
                    ) : (
                      <ul className="space-y-1">
                        {w.alerts.map((a, idx) => (
                          <li
                            key={idx}
                            className={`flex items-start gap-1.5 text-[11px] ${
                              a.level === 'HIGH' ? 'text-rose-300' : 'text-amber-300'
                            }`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{a.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}