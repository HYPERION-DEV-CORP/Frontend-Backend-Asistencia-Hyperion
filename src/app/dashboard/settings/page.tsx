// src/app/dashboard/settings/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  Utensils,
  Clock,
  CalendarDays,
  MapPin,
  Save,
  ShieldCheck,
  Info,
  Plus,
  Trash2,
  Crosshair,
  Building2,
  Pencil,
  Check,
  X
} from 'lucide-react';

interface CompanySettings {
  name: string;
  ruc: string;
  lunchWindowStart: string;
  lunchWindowEnd: string;
  lunchDurationMinutes: number;
  lunchDays: number[];
  saturdayWorkHours: number;
}

interface AuthorizedLocationItem {
  id: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  isActive: boolean;
}

const WEEK_DAYS = [
  { id: 1, label: 'Lunes' },
  { id: 2, label: 'Martes' },
  { id: 3, label: 'Miércoles' },
  { id: 4, label: 'Jueves' },
  { id: 5, label: 'Viernes' },
  { id: 6, label: 'Sábado' },
  { id: 0, label: 'Domingo' },
];

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState<CompanySettings>({
    name: 'Hyperion Digital Security S.A.C.',
    ruc: '20608810987',
    lunchWindowStart: '13:00',
    lunchWindowEnd: '13:30',
    lunchDurationMinutes: 60,
    lunchDays: [1, 2, 3, 4, 5],
    saturdayWorkHours: 4.5,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/v1/admin/company/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.settings) {
          setSettings({
            name: data.settings.name,
            ruc: data.settings.ruc,
            lunchWindowStart: data.settings.lunchWindowStart,
            lunchWindowEnd: data.settings.lunchWindowEnd,
            lunchDurationMinutes: data.settings.lunchDurationMinutes,
            lunchDays: data.settings.lunchDays,
            saturdayWorkHours: data.settings.saturdayWorkHours,
          });
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const toggleLunchDay = (dayId: number) => {
    setSettings((prev) => {
      const exists = prev.lunchDays.includes(dayId);
      return {
        ...prev,
        lunchDays: exists
          ? prev.lunchDays.filter((d) => d !== dayId)
          : [...prev.lunchDays, dayId],
      };
    });
  };

  const computeExampleReturn = () => {
    if (!settings.lunchWindowStart) return '--:--';
    const [h, m] = settings.lunchWindowStart.split(':').map(Number);
    const total = h * 60 + m + (Number(settings.lunchDurationMinutes) || 60);
    const endH = String(Math.floor(total / 60) % 24).padStart(2, '0');
    const endM = String(total % 60).padStart(2, '0');
    return `${endH}:${endM}`;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : null;

      const res = await fetch('/api/v1/admin/company/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, adminId }),
      });

      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'ok', text: data.message || 'Parámetros guardados correctamente.' });
      } else {
        setFeedback({ type: 'err', text: data.error || 'No se pudo guardar la configuración.' });
      }
    } catch {
      setFeedback({ type: 'err', text: 'Error de conexión con el servidor.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-sm text-slate-400">Cargando parámetros corporativos...</div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <form onSubmit={handleSave} className="space-y-6">
        {/* CABECERA */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-[#00BFA5]" />
              Configuración Operativa de Refrigerio, Jornadas y Sedes
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              {settings.name} | RUC: {settings.ruc} — Los cambios aplican inmediatamente en la App Móvil y en el cálculo de Planilla.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-[#00BFA5] hover:bg-[#00a892] text-slate-950 text-xs font-extrabold px-5 py-2.5 rounded-lg shadow-lg transition cursor-pointer disabled:opacity-60"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando cambios...' : 'Guardar Horarios y Jornadas'}
          </button>
        </div>

        {feedback && (
          <div
            className={`p-3.5 rounded-xl border text-xs font-semibold ${
              feedback.type === 'ok'
                ? 'bg-emerald-950/60 border-emerald-700/50 text-emerald-300'
                : 'bg-rose-950/60 border-rose-700/50 text-rose-300'
            }`}
          >
            {feedback.type === 'ok' ? '✅ ' : '⚠️ '}
            {feedback.text}
          </div>
        )}

        {/* GRILLA DE TARJETAS CONFIGURABLES */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* TARJETA 1: VENTANA DE INICIO DE REFRIGERIO */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-5">
            <div>
              <div className="flex items-center gap-2.5 text-white font-bold text-sm">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Utensils className="w-5 h-5" />
                </div>
                1. Ventana Permitida para Iniciar Refrigerio
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Define el rango horario en el que los trabajadores pueden pulsar{' '}
                <strong className="text-slate-200">Inicio Refrigerio</strong> en la aplicación móvil.
                Fuera de este rango el sistema bloqueará la marcación y enviará un recordatorio 5 minutos antes del cierre.
              </p>

              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1.5">
                    Hora de Apertura (Inicio)
                  </label>
                  <input
                    type="time"
                    required
                    value={settings.lunchWindowStart}
                    onChange={(e) =>
                      setSettings({ ...settings, lunchWindowStart: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-mono font-bold text-white focus:border-[#00BFA5] outline-none"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Dispara la 1ra notificación push.
                  </span>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-300 block mb-1.5">
                    Hora Límite de Salida (Cierre)
                  </label>
                  <input
                    type="time"
                    required
                    value={settings.lunchWindowEnd}
                    onChange={(e) =>
                      setSettings({ ...settings, lunchWindowEnd: e.target.value })
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-mono font-bold text-white focus:border-[#00BFA5] outline-none"
                  />
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Avisa 5 min antes si aún no marca.
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 flex items-center gap-2">
              <Info className="w-4 h-4 text-[#00BFA5] shrink-0" />
              <span>
                Los empleados podrán iniciar su refrigerio únicamente entre las{' '}
                <strong className="text-white">{settings.lunchWindowStart}</strong> y las{' '}
                <strong className="text-white">{settings.lunchWindowEnd}</strong>.
              </span>
            </div>
          </div>

          {/* TARJETA 2: DURACIÓN Y CONTEO DE MINUTOS */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-5">
            <div>
              <div className="flex items-center gap-2.5 text-white font-bold text-sm">
                <div className="p-2 rounded-lg bg-[#00BFA5]/10 text-[#00BFA5] border border-[#00BFA5]/20">
                  <Clock className="w-5 h-5" />
                </div>
                2. Duración Obligatoria del Refrigerio (Conteo)
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Establece cuántos minutos exactos se cuentan desde que el trabajador marca su{' '}
                <strong className="text-slate-200">Inicio de Refrigerio</strong>. La app notificará 10
                minutos antes de culminar y al cumplirse el tiempo total. Si excede este tiempo, los
                minutos extra se suman automáticamente como tardanza.
              </p>

              <div className="mt-5">
                <label className="text-xs font-bold text-slate-300 block mb-1.5">
                  Minutos Permitidos de Refrigerio (Mínimo legal: 45 min)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={45}
                    max={180}
                    required
                    value={settings.lunchDurationMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        lunchDurationMinutes: Number(e.target.value),
                      })
                    }
                    className="w-36 bg-slate-900 border border-slate-700 rounded-xl p-2.5 text-sm font-mono font-bold text-white focus:border-[#00BFA5] outline-none"
                  />
                  <div className="flex gap-1.5">
                    {[45, 60, 90].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setSettings({ ...settings, lunchDurationMinutes: preset })
                        }
                        className={`px-3 py-2 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          settings.lunchDurationMinutes === preset
                            ? 'bg-[#00BFA5] text-slate-950 border-[#00BFA5]'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        {preset} min
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-400 flex items-center gap-2">
              <Info className="w-4 h-4 text-[#00BFA5] shrink-0" />
              <span>
                Ejemplo: Si inicia a las <strong className="text-white">{settings.lunchWindowStart}</strong>,
                su retorno obligatorio será a las{' '}
                <strong className="text-[#00BFA5]">{computeExampleReturn()}</strong> (
                {settings.lunchDurationMinutes} min después).
              </span>
            </div>
          </div>

          {/* TARJETA 3: DÍAS CON REFRIGERIO Y JORNADA DE SÁBADOS */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-5">
            <div>
              <div className="flex items-center gap-2.5 text-white font-bold text-sm">
                <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <CalendarDays className="w-5 h-5" />
                </div>
                3. Días con Refrigerio y Jornada de Sábados
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Selecciona qué días de la semana incluyen turno de refrigerio. Los días no marcados
                (como sábados de jornada corta) permiten marcar salida directa sin exigir refrigerio y
                calculan el descuento de faltas según las horas configuradas.
              </p>

              <div className="mt-4">
                <label className="text-xs font-bold text-slate-300 block mb-2">
                  Días habilitados para marcar Refrigerio
                </label>
                <div className="flex flex-wrap gap-2">
                  {WEEK_DAYS.map((day) => {
                    const active = settings.lunchDays.includes(day.id);
                    return (
                      <button
                        key={day.id}
                        type="button"
                        onClick={() => toggleLunchDay(day.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                          active
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-slate-900 text-slate-400 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <label className="text-xs font-bold text-slate-300 block mb-1.5">
                  Horas Laborales del Sábado (Para cálculo de Planilla y Horas Extras)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  max={8}
                  value={settings.saturdayWorkHours}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      saturdayWorkHours: Number(e.target.value),
                    })
                  }
                  className="w-36 bg-slate-900 border border-slate-700 rounded-xl p-2 text-sm font-mono font-bold text-white focus:border-[#00BFA5] outline-none"
                />
                <span className="text-[11px] text-slate-500 ml-2">
                  horas (ej. 4.5h para turno 09:00 a 13:30)
                </span>
              </div>
            </div>
          </div>

          {/* TARJETA 4: PUNTOS DE MARCACIÓN AUTORIZADOS (MULTI-SEDE) */}
          <AuthorizedLocationsCard />
        </div>
      </form>
    </div>
  );
}

function AuthorizedLocationsCard() {
  const [locations, setLocations] = useState<AuthorizedLocationItem[]>([]);
  const [loadingLocs, setLoadingLocs] = useState(true);

  // Estado para crear nueva sede
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radiusM, setRadiusM] = useState(50);
  const [adding, setAdding] = useState(false);

  // Estado para editar sede existente
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    radiusM: 50,
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const [locMsg, setLocMsg] = useState<string | null>(null);

  const loadLocations = async () => {
    try {
      const res = await fetch('/api/v1/admin/locations');
      const data = await res.json();
      if (data.success) setLocations(data.locations);
    } finally {
      setLoadingLocs(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  const handleUseCurrentGps = (target: 'new' | 'edit') => {
    if (!navigator.geolocation) {
      setLocMsg('Tu navegador no soporta geolocalización.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lng = pos.coords.longitude.toFixed(6);
        if (target === 'new') {
          setLatitude(lat);
          setLongitude(lng);
        } else {
          setEditForm((prev) => ({ ...prev, latitude: lat, longitude: lng }));
        }
        setLocMsg('Coordenadas GPS actuales capturadas.');
      },
      () =>
        setLocMsg(
          'No se pudo obtener la ubicación GPS. Verifica los permisos de ubicación del navegador.'
        ),
      { enableHighAccuracy: true }
    );
  };

  const handleAddLocation = async () => {
    if (!name.trim() || !latitude || !longitude) {
      setLocMsg('Completa el nombre, latitud y longitud de la sede.');
      return;
    }
    setAdding(true);
    setLocMsg(null);
    try {
      const res = await fetch('/api/v1/admin/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          address,
          latitude: Number(latitude),
          longitude: Number(longitude),
          radiusM: Number(radiusM) || 50,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setName('');
        setAddress('');
        setLatitude('');
        setLongitude('');
        setRadiusM(50);
        await loadLocations();
      } else {
        setLocMsg(data.error || 'Error al agregar sede.');
      }
    } finally {
      setAdding(false);
    }
  };

  const startEditing = (loc: AuthorizedLocationItem) => {
    setEditingId(loc.id);
    setEditForm({
      name: loc.name,
      address: loc.address || '',
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
      radiusM: loc.radiusM,
    });
    setLocMsg(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editForm.name.trim() || !editForm.latitude || !editForm.longitude) {
      setLocMsg('Nombre, latitud y longitud son obligatorios.');
      return;
    }
    setSavingEdit(true);
    setLocMsg(null);
    try {
      const res = await fetch('/api/v1/admin/locations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: editForm.name,
          address: editForm.address,
          latitude: Number(editForm.latitude),
          longitude: Number(editForm.longitude),
          radiusM: Number(editForm.radiusM) || 50,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingId(null);
        await loadLocations();
      } else {
        setLocMsg(data.error || 'Error al actualizar sede.');
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleToggleActive = async (loc: AuthorizedLocationItem) => {
    await fetch('/api/v1/admin/locations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: loc.id, isActive: !loc.isActive }),
    });
    await loadLocations();
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/admin/locations?id=${id}`, { method: 'DELETE' });
    if (editingId === id) setEditingId(null);
    await loadLocations();
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-5">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 text-white font-bold text-sm">
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <MapPin className="w-5 h-5" />
            </div>
            4. Puntos Autorizados de Marcación (Sedes)
          </div>
          <button
            type="button"
            onClick={() => handleUseCurrentGps('new')}
            className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-[#00BFA5] border border-slate-700 transition cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5" />
            Capturar GPS actual
          </button>
        </div>

        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          Define las coordenadas y radio permitido de las instalaciones de la empresa. Si no hay
          sedes activas, ninguna marcación presencial será aceptada y solo podrán marcar quienes
          tengan <strong className="text-slate-200">Trabajo Remoto</strong> autorizado.
        </p>

        {/* FORMULARIO NUEVA SEDE */}
        <div className="mt-4 p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              placeholder="Nombre (Ej: Sede Principal)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-[#00BFA5] outline-none"
            />
            <input
              type="text"
              placeholder="Dirección referencial (opcional)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-[#00BFA5] outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            <input
              type="number"
              step="any"
              placeholder="Latitud"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#00BFA5] outline-none"
            />
            <input
              type="number"
              step="any"
              placeholder="Longitud"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-[#00BFA5] outline-none"
            />
            <div className="flex gap-1.5">
              <input
                type="number"
                min={10}
                max={2000}
                placeholder="Radio (m)"
                value={radiusM}
                onChange={(e) => setRadiusM(Number(e.target.value))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs font-mono text-white focus:border-[#00BFA5] outline-none"
              />
              <button
                type="button"
                onClick={handleAddLocation}
                disabled={adding}
                className="px-3 py-2 rounded-lg bg-[#00BFA5] hover:bg-[#00a892] text-slate-950 font-extrabold text-xs flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar
              </button>
            </div>
          </div>

          {locMsg && <p className="text-[11px] text-amber-300">{locMsg}</p>}
        </div>

        {/* LISTADO Y EDICIÓN DE SEDES */}
        <div className="mt-4 space-y-2 max-h-64 overflow-y-auto pr-1">
          {loadingLocs ? (
            <p className="text-xs text-slate-500">Cargando sedes...</p>
          ) : locations.length === 0 ? (
            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-800/40 text-xs text-amber-200">
              No hay sedes configuradas. Agrega al menos un punto autorizado para habilitar la marcación presencial.
            </div>
          ) : (
            locations.map((loc) =>
              editingId === loc.id ? (
                <div
                  key={loc.id}
                  className="p-3 rounded-xl bg-slate-900 border border-[#00BFA5]/50 space-y-2.5"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                      placeholder="Nombre de sede"
                    />
                    <input
                      type="text"
                      value={editForm.address}
                      onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                      placeholder="Dirección"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number"
                      step="any"
                      value={editForm.latitude}
                      onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                    />
                    <input
                      type="number"
                      step="any"
                      value={editForm.longitude}
                      onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                    />
                    <input
                      type="number"
                      min={10}
                      max={2000}
                      value={editForm.radiusM}
                      onChange={(e) =>
                        setEditForm({ ...editForm, radiusM: Number(e.target.value) })
                      }
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => handleUseCurrentGps('edit')}
                      className="text-[11px] text-[#00BFA5] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <Crosshair className="w-3 h-3" /> Usar mi GPS actual
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3 h-3" /> Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={() => handleSaveEdit(loc.id)}
                        className="px-2.5 py-1 rounded-md bg-[#00BFA5] text-slate-950 text-[11px] font-extrabold flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3 h-3" /> Guardar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  key={loc.id}
                  className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-900 border border-slate-800"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-[#00BFA5] shrink-0" />
                      <span className="text-xs font-bold text-white truncate">{loc.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {loc.radiusM}m
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                      {loc.address ? ` • ${loc.address}` : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(loc)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold border cursor-pointer ${
                        loc.isActive
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/50'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {loc.isActive ? 'Activa' : 'Inactiva'}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEditing(loc)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-[#00BFA5] hover:bg-slate-800 transition cursor-pointer"
                      title="Editar coordenadas o radio"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(loc.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                      title="Eliminar sede"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}