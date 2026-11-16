'use client';

import { useState, useEffect } from 'react';
import { Briefcase, Download, AlertCircle, Lock, Unlock, Plus, Calendar } from 'lucide-react';

interface PayrollItem {
  userId: string;
  fullName: string;
  docType: string;
  dni: string;
  jobTitle: string;
  regimenName: string;
  baseSalary: number;
  hourlyRate: number;
  totalLateMinutes: number;
  unpaidLeaveMinutes: number;
  totalOvertime25Minutes: number;
  totalOvertime35Minutes: number;
  lateDiscount: number;
  unpaidLeaveDiscount: number;
  totalOvertimePay: number;
  netSalary: number;
}

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
}

export default function PayrollPage() {
  const [payroll, setPayroll] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados para Periodos de Planilla
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [showModalPeriod, setShowModalPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', startDate: '', endDate: '' });
  const [periodLoading, setPeriodLoading] = useState(false);

  const fetchPayroll = async (periodId?: string) => {
    setLoading(true);
    try {
      const query = periodId ? `?periodId=${periodId}` : '';
      const res = await fetch(`/api/v1/hr/payroll${query}`);
      const text = await res.text();
      if (!res.ok || !text) {
        setPayroll([]);
        return;
      }
      const data = JSON.parse(text);
      setPayroll(data.payroll || []);
    } catch (err) {
      console.error('Error al cargar nómina:', err);
      setPayroll([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPeriods = async () => {
    try {
      const res = await fetch('/api/v1/hr/payroll/periods');
      const text = await res.text();
      if (!res.ok || !text) {
        console.warn('Respuesta vacía o error en /api/v1/hr/payroll/periods:', res.status);
        fetchPayroll();
        return;
      }
      const data = JSON.parse(text);
      if (data.success && Array.isArray(data.periods) && data.periods.length > 0) {
        setPeriods(data.periods);
        const targetId = selectedPeriodId || data.periods[0].id;
        setSelectedPeriodId(targetId);
        fetchPayroll(targetId);
      } else {
        fetchPayroll();
      }
    } catch (err) {
      console.error('Error al cargar periodos:', err);
      fetchPayroll();
    }
  };

  useEffect(() => {
    fetchPeriods();
  }, []);

  const handlePeriodChange = (id: string) => {
    setSelectedPeriodId(id);
    fetchPayroll(id);
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    setPeriodLoading(true);
    try {
      const res = await fetch('/api/v1/hr/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPeriod),
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : {};
      if (res.ok) {
        setShowModalPeriod(false);
        setNewPeriod({ name: '', startDate: '', endDate: '' });
        fetchPeriods();
      } else {
        alert(data.error || 'Error al crear el periodo');
      }
    } catch {
      alert('Error de conexión al crear el periodo');
    } finally {
      setPeriodLoading(false);
    }
  };

  const handleToggleStatus = async (period: Period) => {
    const nextStatus = period.status === 'CLOSED' ? 'OPEN' : 'CLOSED';
    if (
      nextStatus === 'CLOSED' &&
      !confirm(`¿Cerrar definitivamente el periodo "${period.name}"? Se bloquearán las rectificaciones manuales de asistencia en este rango de fechas.`)
    ) {
      return;
    }

    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : null;

      const res = await fetch('/api/v1/hr/payroll/periods', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: period.id, status: nextStatus, closedById: adminId }),
      });
      if (res.ok) {
        fetchPeriods();
      } else {
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        alert(data.error || 'Error al actualizar el estado del periodo');
      }
    } catch {
      alert('Error al actualizar el estado del periodo');
    }
  };

  const activePeriod = periods.find((p) => p.id === selectedPeriodId);

  const handleExportExcel = () => {
    const query = selectedPeriodId ? `?periodId=${selectedPeriodId}` : '';
    window.open(`/api/v1/reports/payroll-excel${query}`, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* ENCABEZADO CORPORATIVO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-[#00BFA5]" />
            Cálculo de Planilla y Pre-Nómina Mensual
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Hyperion Digital Security S.A.C. | RUC: 20608810987 — Liquidación con sobretasas (Ley N° 28999)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowModalPeriod(true)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold px-3 py-2.5 rounded-lg border border-slate-700 transition"
          >
            <Plus className="w-4 h-4 text-[#00BFA5]" />
            Nuevo Periodo
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-md border border-emerald-500/30 transition"
          >
            <Download className="w-4 h-4" />
            Exportar Excel PLAME (.xlsx)
          </button>
        </div>
      </div>

      {/* BARRA DE SELECCIÓN Y ESTADO DEL PERIODO */}
      {periods.length > 0 && (
        <div className="bg-slate-900/60 border border-slate-800 p-3.5 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-400 font-semibold">
              <Calendar className="w-4 h-4 text-[#00BFA5]" />
              <span>Periodo Activo:</span>
            </div>
            <select
              value={selectedPeriodId}
              onChange={(e) => handlePeriodChange(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-white rounded-lg px-2.5 py-1.5 font-medium outline-none focus:border-[#00BFA5]"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({new Date(p.startDate).toLocaleDateString()} - {new Date(p.endDate).toLocaleDateString()})
                </option>
              ))}
            </select>
          </div>

          {activePeriod && (
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                  activePeriod.status === 'CLOSED'
                    ? 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
                    : 'bg-emerald-950/60 text-[#00BFA5] border border-emerald-800/40'
                }`}
              >
                {activePeriod.status === 'CLOSED' ? (
                  <>
                    <Lock className="w-3.5 h-3.5" /> PERIODO CERRADO (LOCKED)
                  </>
                ) : (
                  <>
                    <Unlock className="w-3.5 h-3.5" /> PERIODO ABIERTO
                  </>
                )}
              </span>

              <button
                onClick={() => handleToggleStatus(activePeriod)}
                className={`px-3 py-1 rounded-lg font-bold text-[11px] transition border ${
                  activePeriod.status === 'CLOSED'
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-rose-900/40 hover:bg-rose-800/60 text-rose-300 border-rose-700/50'
                }`}
              >
                {activePeriod.status === 'CLOSED' ? 'Reabrir Periodo' : 'Cerrar Periodo de Asistencia'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* NOTA NORMATIVA LEGAL */}
      <div className="bg-[#005F87]/20 border border-[#00BFA5]/30 p-4 rounded-xl flex items-center gap-3 text-xs text-slate-300">
        <AlertCircle className="w-5 h-5 text-[#00BFA5] shrink-0" />
        <span>
          El cálculo aplica el recargo legal del <strong>25% para las primeras 2 horas extras</strong> y el <strong>35% para las horas subsecuentes</strong>. Los periodos en estado <strong>CERRADO</strong> bloquean correcciones retroactivas de asistencia para preservar la consistencia con las declaraciones PLAME.
        </span>
      </div>

      {/* TABLA PRINCIPAL DE PLANILLA */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Trabajador</th>
              <th className="px-4 py-3">Régimen Aplicado</th>
              <th className="px-4 py-3">Sueldo Base</th>
              <th className="px-4 py-3">Tarifa / Hora</th>
              <th className="px-4 py-3">Tardanzas (S/)</th>
              <th className="px-4 py-3">Permisos Sin Goce</th>
              <th className="px-4 py-3">Horas Extras (S/)</th>
              <th className="px-4 py-3 text-right">Neto a Pagar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-500">
                  Calculando pre-nómina consolidada...
                </td>
              </tr>
            ) : payroll.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-slate-500">
                  No hay datos de planilla para mostrar en este periodo.
                </td>
              </tr>
            ) : (
              payroll.map((item) => (
                <tr key={item.userId} className="hover:bg-slate-900/50 transition text-xs">
                  <td className="px-4 py-3 font-semibold text-white">
                    {item.fullName}
                    <div className="text-[10px] text-slate-500">{item.jobTitle}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] bg-slate-900 border border-slate-800 text-[#00BFA5] font-bold px-2 py-0.5 rounded">
                      {item.regimenName || 'Estándar General 728'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-slate-200">
                    S/ {item.baseSalary?.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-400">
                    S/ {(item.hourlyRate || 0).toFixed(2)} /h
                  </td>
                  <td className="px-4 py-3 font-mono text-rose-400">
                    - S/ {item.lateDiscount?.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono text-amber-400">
                    {item.unpaidLeaveDiscount > 0 ? (
                      <div>
                        <div>S/ {item.unpaidLeaveDiscount.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-500">({item.unpaidLeaveMinutes} min)</div>
                      </div>
                    ) : (
                      <span className="text-slate-600">S/ 0.00</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-emerald-400">
                    + S/ {item.totalOvertimePay?.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 font-mono font-bold text-white text-right">
                    S/ {item.netSalary?.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL PARA CREAR NUEVO PERIODO */}
      {showModalPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreatePeriod}
            className="bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl border border-slate-800 text-slate-200"
          >
            <h3 className="font-bold text-white mb-3 text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#00BFA5]" /> Aperturar Periodo de Nómina
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-400">Nombre del Periodo</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Noviembre 2026 - Quincena 1"
                  value={newPeriod.name}
                  onChange={(e) => setNewPeriod({ ...newPeriod, name: e.target.value })}
                  className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-[#00BFA5] outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-400">Fecha Inicio</label>
                  <input
                    type="date"
                    required
                    value={newPeriod.startDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, startDate: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-[#00BFA5] outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400">Fecha Fin</label>
                  <input
                    type="date"
                    required
                    value={newPeriod.endDate}
                    onChange={(e) => setNewPeriod({ ...newPeriod, endDate: e.target.value })}
                    className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white focus:border-[#00BFA5] outline-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowModalPeriod(false)}
                className="px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={periodLoading}
                className="px-3.5 py-1.5 text-xs bg-[#00BFA5] hover:bg-[#00a892] text-slate-950 font-bold rounded-lg transition"
              >
                {periodLoading ? 'Creando...' : 'Crear Periodo'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}