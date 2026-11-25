'use client';

import { useEffect, useState } from 'react';

interface UserOption {
  id: string;
  name: string;
  lastName: string;
  dni: string;
}

export default function BiometricSimulatorPanel({
  users,
  onExecuted,
}: {
  users: UserOption[];
  onExecuted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [scenario, setScenario] = useState('JORNADA_COMPLETA_PUNTUAL');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    fetch('/api/v1/biometric/simulator')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setDemoMode(d.demoMode);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedUserId && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  const callSimulator = async (payload: Record<string, any>) => {
    setLoading(true);
    setFeedback('');
    try {
      const res = await fetch('/api/v1/biometric/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        if (typeof data.demoMode === 'boolean') setDemoMode(data.demoMode);
        setFeedback(data.message || 'Operación completada.');
        onExecuted();
      } else {
        setFeedback(`Error: ${data.error}`);
      }
    } catch {
      setFeedback('Error de conexión con el simulador.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-600" />
          <span className="text-sm font-semibold text-slate-800">
            Laboratorio de Pruebas Biométricas (Demo en Vivo)
          </span>
          {demoMode && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              MODO DEMO FÍSICO ACTIVO
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {open ? 'Ocultar laboratorio' : 'Abrir controles de prueba'}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
          {/* Switch Modo Demo Físico */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-xs">
            <div>
              <p className="text-sm font-medium text-slate-800">
                1. Prueba con Reloj Físico sin esperar horario
              </p>
              <p className="text-xs text-slate-500">
                Al activarlo, 4 toques seguidos en el reloj registran Ingreso, Inicio Refrigerio, Fin Refrigerio y Salida.
              </p>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => callSimulator({ action: 'TOGGLE_DEMO', demoMode: !demoMode })}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition ${
                demoMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {demoMode ? 'Desactivar Modo Demo Físico' : 'Activar Modo Demo Físico'}
            </button>
          </div>

          {/* Batería de Escenarios Virtuales */}
          <div className="grid grid-cols-1 gap-2 rounded-lg bg-white p-3 shadow-xs md:grid-cols-4">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.lastName} ({u.dni})
                </option>
              ))}
            </select>

            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            />

            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="JORNADA_COMPLETA_PUNTUAL">4 Marcaciones + Duplicado (Huella/RFID)</option>
              <option value="TARDANZA_Y_HORAS_EXTRAS">Tardanza + Horas Extras (25% y 35%)</option>
              <option value="SABADO_SIN_REFRIGERIO">Sábado (09:00 - 13:30 sin refrigerio)</option>
              <option value="CODIGO_NO_RECONOCIDO">Código No Reconocido (Bandeja Pendiente)</option>
            </select>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading || !selectedUserId}
                onClick={() =>
                  callSimulator({
                    action: 'RUN_SCENARIO',
                    userId: selectedUserId,
                    dateStr,
                    scenario,
                  })
                }
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Simular
              </button>
              <button
                type="button"
                disabled={loading || !selectedUserId}
                onClick={() =>
                  callSimulator({
                    action: 'RESET_DAY',
                    userId: selectedUserId,
                    dateStr,
                  })
                }
                className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                Limpiar día
              </button>
            </div>
          </div>

          {feedback && (
            <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800">
              {feedback}
            </p>
          )}
        </div>
      )}
    </div>
  );
}