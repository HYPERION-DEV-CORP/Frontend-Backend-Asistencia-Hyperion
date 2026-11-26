'use client';

import { useEffect, useState } from 'react';

interface BiometricScheduleModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BiometricScheduleModal({
  open,
  onClose,
}: BiometricScheduleModalProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [form, setForm] = useState({
    biometricCheckInStart: '06:00',
    biometricCheckInEnd: '11:59',
    lunchWindowStart: '13:00',
    lunchWindowEnd: '13:30',
    lunchReturnEnd: '16:59',
    lunchDurationMinutes: 60,
    biometricCheckOutStart: '17:00',
    saturdayWorkHours: 4.5,
  });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/v1/admin/biometric-schedule', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.schedule) {
          setCompanyName(data.companyName || '');
          setForm({
            biometricCheckInStart: data.schedule.biometricCheckInStart || '06:00',
            biometricCheckInEnd: data.schedule.biometricCheckInEnd || '11:59',
            lunchWindowStart: data.schedule.lunchWindowStart || '13:00',
            lunchWindowEnd: data.schedule.lunchWindowEnd || '13:30',
            lunchReturnEnd: data.schedule.lunchReturnEnd || '16:59',
            lunchDurationMinutes: data.schedule.lunchDurationMinutes ?? 60,
            biometricCheckOutStart: data.schedule.biometricCheckOutStart || '17:00',
            saturdayWorkHours: data.schedule.saturdayWorkHours ?? 4.5,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  const handleRestoreDefaults = () => {
    setForm({
      biometricCheckInStart: '06:00',
      biometricCheckInEnd: '11:59',
      lunchWindowStart: '13:00',
      lunchWindowEnd: '13:30',
      lunchReturnEnd: '16:59',
      lunchDurationMinutes: 60,
      biometricCheckOutStart: '17:00',
      saturdayWorkHours: 4.5,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/v1/admin/biometric-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Configuración horaria guardada.');
        onClose();
      } else {
        alert(data.error || 'Error al guardar las franjas horarias.');
      }
    } catch {
      alert('Error de conexión con el servidor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 my-6">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              ⚙️ Franjas Horarias del Reloj Biométrico
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Define en qué rango de horas cada marcación física se registra como Entrada, Refrigerio o Salida
              {companyName ? ` (${companyName})` : ''}.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRestoreDefaults}
            className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md border border-indigo-200 cursor-pointer whitespace-nowrap"
          >
            Restaurar estándar
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-xs text-slate-500">Cargando configuración...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 1. Franja de Ingreso */}
            <div className="rounded-xl bg-blue-50/60 border border-blue-200 p-3 space-y-2">
              <p className="text-xs font-bold text-blue-900">1. Ventana de Ingreso (Entrada)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Desde (Hora mínima)
                  </label>
                  <input
                    type="time"
                    required
                    value={form.biometricCheckInStart}
                    onChange={(e) =>
                      setForm({ ...form, biometricCheckInStart: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Hasta (Hora máxima)
                  </label>
                  <input
                    type="time"
                    required
                    value={form.biometricCheckInEnd}
                    onChange={(e) =>
                      setForm({ ...form, biometricCheckInEnd: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* 2. Franja de Refrigerio */}
            <div className="rounded-xl bg-amber-50/60 border border-amber-200 p-3 space-y-2">
              <p className="text-xs font-bold text-amber-900">
                2. Ventana de Refrigerio (Inicio y Retorno)
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Inicio Ref. Desde
                  </label>
                  <input
                    type="time"
                    required
                    value={form.lunchWindowStart}
                    onChange={(e) => setForm({ ...form, lunchWindowStart: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Inicio Ref. Hasta
                  </label>
                  <input
                    type="time"
                    required
                    value={form.lunchWindowEnd}
                    onChange={(e) => setForm({ ...form, lunchWindowEnd: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Retorno Ref. Hasta
                  </label>
                  <input
                    type="time"
                    required
                    value={form.lunchReturnEnd}
                    onChange={(e) => setForm({ ...form, lunchReturnEnd: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
              </div>
            </div>

            {/* 3. Franja de Salida y Parámetros Generales */}
            <div className="rounded-xl bg-emerald-50/60 border border-emerald-200 p-3 space-y-2">
              <p className="text-xs font-bold text-emerald-900">
                3. Ventana de Salida y Jornada
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Salida Desde (L-V)
                  </label>
                  <input
                    type="time"
                    required
                    value={form.biometricCheckOutStart}
                    onChange={(e) =>
                      setForm({ ...form, biometricCheckOutStart: e.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Duración Ref. (min)
                  </label>
                  <input
                    type="number"
                    min={45}
                    max={180}
                    required
                    value={form.lunchDurationMinutes}
                    onChange={(e) =>
                      setForm({ ...form, lunchDurationMinutes: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Horas Sábado
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    min={0}
                    max={8}
                    required
                    value={form.saturdayWorkHours}
                    onChange={(e) =>
                      setForm({ ...form, saturdayWorkHours: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white font-semibold"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-md transition cursor-pointer"
              >
                {saving ? 'Guardando...' : 'Guardar Horarios'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}