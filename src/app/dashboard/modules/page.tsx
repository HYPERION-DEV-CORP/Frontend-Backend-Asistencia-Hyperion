// src/app/dashboard/modules/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Sliders,
  Clock,
  Fingerprint,
  UserX,
  FileSignature,
  FileSpreadsheet,
  ShieldCheck,
  QrCode,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface SubscriptionData {
  companyId: string;
  companyName: string;
  ruc: string;
  planType: 'TRIAL' | 'BASIC' | 'PRO' | 'ENTERPRISE';
  subscriptionStatus: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  trialStartsAt: string;
  trialEndsAt: string | null;
  daysRemaining: number | null;
  enabledModules: string[];
}

const AVAILABLE_MODULES = [
  {
    key: 'ATTENDANCE_QR',
    title: 'Marcación Web / Móvil QR & GPS',
    description: 'Control de ingreso, refrigerio y salida mediante código QR rotativo y geocerca.',
    icon: QrCode,
  },
  {
    key: 'BIOMETRIC_SYNC',
    title: 'Sincronización Reloj Biométrico (ALOG)',
    description: 'Importación idempotente de marcaciones físicas y fusión inteligente con app móvil.',
    icon: Fingerprint,
  },
  {
    key: 'AUTO_ABSENCE_CRON',
    title: 'Detección Automática de Faltas',
    description: 'Auditoría nocturna de días sin marcación ni papeleta y descuento automático en nómina.',
    icon: UserX,
  },
  {
    key: 'DIGITAL_SIGNATURE',
    title: 'Firma Electrónica PAdES-B (Camercloud)',
    description: 'Firma legal de papeletas de permiso y boletas de pago mensuales (D.S. N° 009-2011-TR).',
    icon: FileSignature,
  },
  {
    key: 'PLAME_EXPORT',
    title: 'Exportación Pre-Nómina y Excel PLAME',
    description: 'Cálculo de sobretasas 25%/35% (Ley N° 28999) y exportación estructurada para SUNAT.',
    icon: FileSpreadsheet,
  },
  {
    key: 'AUDIT_FORENSIC',
    title: 'Auditoría Forense SUNAFIL / ISO 27001',
    description: 'Bitácora inmutable de rectificaciones manuales con IP, motivo y sustento documental.',
    icon: ShieldCheck,
  },
];

export default function ModulesAdminPage() {
  const [sub, setSub] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSubscription = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/subscription');
      const data = await res.json();
      if (data.success) {
        setSub(data.subscription);
      }
    } catch (err) {
      console.error('Error cargando módulos:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSubscription();
  }, []);

  const updateSubscription = async (payload: Record<string, any>) => {
    if (!sub) return;
    setSaving(true);
    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : null;

      const res = await fetch('/api/v1/admin/subscription', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId: sub.companyId,
          adminId,
          ...payload,
        }),
      });
      if (res.ok) {
        await loadSubscription();
      } else {
        const err = await res.json();
        alert(err.error || 'Error al actualizar configuración');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = (moduleKey: string) => {
    if (!sub) return;
    const isEnabled = sub.enabledModules.includes(moduleKey);
    const nextModules = isEnabled
      ? sub.enabledModules.filter((m) => m !== moduleKey)
      : [...sub.enabledModules, moduleKey];

    updateSubscription({ enabledModules: nextModules });
  };

  if (loading) {
    return <div className="p-8 text-xs text-slate-400">Cargando configuración modular...</div>;
  }

  if (!sub) {
    return <div className="p-8 text-xs text-rose-400">No se encontró información de la empresa.</div>;
  }

  return (
    <div className="space-y-6">
      {/* ENCABEZADO */}
      <div className="border-b border-slate-800 pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Sliders className="w-6 h-6 text-[#00BFA5]" />
            Gestión de Módulos y Suscripción SaaS
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {sub.companyName} | RUC: {sub.ruc} — Activa o desactiva funcionalidades según el plan contratado
          </p>
        </div>
      </div>

      {/* TARJETA DE PRUEBA GRATUITA DE 7 DÍAS / PLAN */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-0.5 rounded bg-[#00BFA5]/15 text-[#00BFA5] border border-[#00BFA5]/30">
              PLAN {sub.planType}
            </span>
            {sub.subscriptionStatus === 'ACTIVE' ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" /> Activo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-rose-400 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" /> {sub.subscriptionStatus}
              </span>
            )}
          </div>

          {sub.planType === 'TRIAL' && (
            <p className="text-xs text-slate-300 flex items-center gap-1.5 pt-1">
              <Clock className="w-4 h-4 text-amber-400" />
              Prueba gratuita de 7 días:{' '}
              <strong className="text-white">
                {sub.daysRemaining} día(s) restante(s)
              </strong>
              {sub.trialEndsAt && (
                <span className="text-slate-500">
                  (Vence el {new Date(sub.trialEndsAt).toLocaleDateString('es-PE')})
                </span>
              )}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={saving}
            onClick={() => updateSubscription({ startTrialWeek: true })}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            Reiniciar Prueba (7 Días)
          </button>
          <button
            disabled={saving}
            onClick={() => updateSubscription({ extendTrialDays: 7 })}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-amber-900/40 hover:bg-amber-800/60 text-amber-300 border border-amber-700/50 transition"
          >
            +7 Días Extra
          </button>
          <button
            disabled={saving}
            onClick={() =>
              updateSubscription({ planType: 'ENTERPRISE', subscriptionStatus: 'ACTIVE' })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#00BFA5] hover:bg-[#00a892] text-slate-950 transition"
          >
            <Sparkles className="w-3.5 h-3.5" /> Activar Plan Enterprise
          </button>
        </div>
      </div>

      {/* GRILLA DE INTERRUPTORES DE MÓDULOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AVAILABLE_MODULES.map((mod) => {
          const Icon = mod.icon;
          const active = sub.enabledModules.includes(mod.key);

          return (
            <div
              key={mod.key}
              className={`p-4 rounded-xl border transition flex items-start justify-between gap-4 ${
                active
                  ? 'bg-slate-900/90 border-[#00BFA5]/40'
                  : 'bg-slate-950/60 border-slate-800 opacity-75'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2.5 rounded-lg ${
                    active ? 'bg-[#00BFA5]/15 text-[#00BFA5]' : 'bg-slate-900 text-slate-500'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{mod.title}</h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">{mod.description}</p>
                  <span className="inline-block mt-2 text-[10px] font-mono text-slate-500">
                    FLAG: {mod.key}
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={() => toggleModule(mod.key)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  active ? 'bg-[#00BFA5]' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
                    active ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}