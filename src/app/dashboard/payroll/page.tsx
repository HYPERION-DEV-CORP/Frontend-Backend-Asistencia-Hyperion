'use client';

import { useState, useEffect } from 'react';
import {
  Briefcase,
  Download,
  AlertCircle,
  Lock,
  Unlock,
  Plus,
  Calendar,
  FileText,
  Printer,
  X,
} from 'lucide-react';

interface PayrollItem {
  userId: string;
  fullName: string;
  docType: string;
  dni: string;
  jobTitle: string;
  regimenName: string;
  pensionSystem?: string;
  pensionRate?: number;
  baseSalary: number;
  dailyRate?: number;
  hourlyRate: number;
  workedDays?: number;
  sundaysCount?: number;
  computableDays?: number;
  absenceDays: number;
  earnedBaseSalary?: number;
  totalLateMinutes: number;
  unpaidLeaveMinutes: number;
  totalOvertime25Minutes: number;
  totalOvertime35Minutes: number;
  lateDiscount: number;
  unpaidLeaveDiscount: number;
  totalOvertimePay: number;
  grossSalary?: number;
  pensionDiscount?: number;
  netSalary: number;
}

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
}

interface AttendanceSheetData {
  header: {
    title: string;
    companyName: string;
    ruc: string;
    employeeName: string;
    dni: string;
    jobTitle: string;
    year?: number;
    month?: number;
  };
  closingSignOff?: {
    closingSignature: string | null;
    signedAt: string | null;
    hrSignature: string | null;
  };
  rows: {
    dayName: string;
    dateFormatted: string;
    isoDate: string;
    isSunday: boolean;
    isHoliday?: boolean;
    checkIn: string;
    lunchStart: string;
    lunchEnd: string;
    checkOut: string;
    dailySignature?: string | null;
    observations: string;
  }[];
}

export default function PayrollPage() {
  const [payroll, setPayroll] = useState<PayrollItem[]>([]);
  const [cutoffRange, setCutoffRange] = useState<{ start: string; end: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Estados para Periodos de Planilla
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [showModalPeriod, setShowModalPeriod] = useState(false);
  const [newPeriod, setNewPeriod] = useState({ name: '', startDate: '', endDate: '' });
  const [periodLoading, setPeriodLoading] = useState(false);

  // Estados para Modal de Registro Individual SUNAFIL
  const [sheetModalOpen, setSheetModalOpen] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetData, setSheetData] = useState<AttendanceSheetData | null>(null);

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
      setCutoffRange(data.cutoffRange || null);
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
      !confirm(
        `¿Cerrar definitivamente el periodo "${period.name}"? Se bloquearán las rectificaciones manuales de asistencia en este rango de fechas.`
      )
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

  const handleOpenAttendanceSheet = async (userId: string) => {
    setSheetModalOpen(true);
    setSheetLoading(true);
    setSheetData(null);
    try {
      const query = selectedPeriodId
        ? `?userId=${userId}&periodId=${selectedPeriodId}`
        : `?userId=${userId}`;
      const res = await fetch(`/api/v1/reports/attendance-sheet${query}`);
      const data = await res.json();
      if (data.success) {
        setSheetData(data);
      } else {
        alert(data.error || 'No se pudo cargar la hoja de asistencia');
        setSheetModalOpen(false);
      }
    } catch {
      alert('Error al consultar el registro individual');
      setSheetModalOpen(false);
    } finally {
      setSheetLoading(false);
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
            Hyperion Digital Security S.A.C. | RUC: 20608810987 — Días efectivos, corte 28-27 y retención AFP/ONP (13%)
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
                  {p.name} ({new Date(p.startDate).toLocaleDateString()} -{' '}
                  {new Date(p.endDate).toLocaleDateString()})
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
      <div className="bg-[#005F87]/20 border border-[#00BFA5]/30 p-4 rounded-xl flex items-start gap-3 text-xs text-slate-300">
        <AlertCircle className="w-5 h-5 text-[#00BFA5] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p>
            <strong>Cálculo por Días Efectivos + Descanso Semanal:</strong> El haber básico se liquida según los días asistidos más los domingos de descanso semanal remunerado (base 30 días), aplicando la retención previsional <strong>AFP/ONP del 13%</strong> sobre la remuneración bruta.
          </p>
          {cutoffRange && (
            <p className="text-[11px] text-[#00BFA5]">
              <strong>Corte de Tardanzas y Horas Extras:</strong> Del <strong>{cutoffRange.start}</strong> al{' '}
              <strong>{cutoffRange.end}</strong> (las faltas se computan sobre el mes calendario).
            </p>
          )}
        </div>
      </div>

      {/* TABLA PRINCIPAL DE PLANILLA */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-x-auto shadow-xl">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
            <tr>
              <th className="px-4 py-3">Trabajador</th>
              <th className="px-4 py-3">Sueldo Base</th>
              <th className="px-4 py-3">Días Computados</th>
              <th className="px-4 py-3">Haber Ganado</th>
              <th className="px-4 py-3">Tardanzas / Perm.</th>
              <th className="px-4 py-3">Horas Extras</th>
              <th className="px-4 py-3">Bruto Comp.</th>
              <th className="px-4 py-3">AFP/ONP (13%)</th>
              <th className="px-4 py-3 text-right">Neto a Pagar</th>
              <th className="px-4 py-3 text-center">Tareo SUNAFIL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={10} className="text-center py-8 text-slate-500">
                  Calculando pre-nómina consolidada...
                </td>
              </tr>
            ) : payroll.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-8 text-slate-500">
                  No hay datos de planilla para mostrar en este periodo.
                </td>
              </tr>
            ) : (
              payroll.map((item) => {
                const totalTimeDiscounts =
                  (item.lateDiscount || 0) + (item.unpaidLeaveDiscount || 0);
                return (
                  <tr key={item.userId} className="hover:bg-slate-900/50 transition text-xs">
                    <td className="px-4 py-3 font-semibold text-white">
                      {item.fullName}
                      <div className="text-[10px] text-slate-500">
                        {item.jobTitle} • DNI {item.dni}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">
                      S/ {item.baseSalary?.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-[#00BFA5]">
                        {item.computableDays ?? 0} d
                      </span>
                      <div className="text-[10px] text-slate-500">
                        {item.workedDays ?? 0} trab. + {item.sundaysCount ?? 0} dom.
                        {item.absenceDays > 0 && (
                          <span className="text-rose-400"> ({item.absenceDays} falta/s)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                      S/ {(item.earnedBaseSalary ?? item.baseSalary).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono text-rose-400">
                      {totalTimeDiscounts > 0 ? (
                        <div>
                          <div>- S/ {totalTimeDiscounts.toFixed(2)}</div>
                          <div className="text-[10px] text-slate-500">
                            ({item.totalLateMinutes}m tard.
                            {item.unpaidLeaveMinutes > 0
                              ? ` • ${item.unpaidLeaveMinutes}m perm.`
                              : ''}
                            )
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">S/ 0.00</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-emerald-400">
                      + S/ {(item.totalOvertimePay || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-200">
                      S/ {(item.grossSalary ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono text-amber-400">
                      - S/ {(item.pensionDiscount ?? 0).toFixed(2)}
                      <div className="text-[10px] text-slate-500">
                        {item.pensionSystem || 'AFP'} ({item.pensionRate ?? 13}%)
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-white text-right text-sm">
                      S/ {(item.netSalary ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleOpenAttendanceSheet(item.userId)}
                        title="Ver Registro de Asistencia SUNAFIL"
                        className="inline-flex items-center gap-1 bg-slate-800 hover:bg-[#005F87] text-slate-200 hover:text-white px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-700 transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-[#00BFA5]" />
                        Ver Hoja
                      </button>
                    </td>
                  </tr>
                );
              })
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
                  placeholder="Ej: Noviembre 2026"
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

      {/* MODAL REGISTRO DE CONTROL DE ASISTENCIA SUNAFIL */}
      {sheetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-xl max-w-4xl w-full p-6 shadow-2xl my-8 print:shadow-none print:my-0">
            {/* Barra de acciones (no se imprime) */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4 print:hidden">
              <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                Vista Previa — Registro Individual D.S. N° 004-2006-TR
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  disabled={!sheetData}
                  className="flex items-center gap-1.5 bg-[#005F87] hover:bg-[#004b6b] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition"
                >
                  <Printer className="w-4 h-4" />
                  Imprimir / Guardar PDF
                </button>
                <button
                  onClick={() => setSheetModalOpen(false)}
                  className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {sheetLoading || !sheetData ? (
              <div className="py-16 text-center text-sm text-slate-500">
                Generando registro de asistencia del trabajador...
              </div>
            ) : (
              <div className="space-y-4 text-[11px]">
                <h2 className="text-center font-bold text-sm uppercase tracking-wide">
                  {sheetData.header.title}
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-slate-300 p-3 rounded bg-slate-50">
                  <div>
                    <p className="font-bold text-slate-700 mb-1">DATOS DEL EMPLEADOR</p>
                    <p>
                      <strong>RAZÓN SOCIAL:</strong> {sheetData.header.companyName}
                    </p>
                    <p>
                      <strong>RUC:</strong> {sheetData.header.ruc}
                    </p>
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 mb-1">DATOS DEL TRABAJADOR</p>
                    <p>
                      <strong>NOMBRE Y APELLIDOS:</strong> {sheetData.header.employeeName}
                    </p>
                    <p>
                      <strong>DNI:</strong> {sheetData.header.dni} • <strong>CARGO:</strong>{' '}
                      {sheetData.header.jobTitle}
                    </p>
                  </div>
                </div>

                {/* Tabla diaria */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-slate-400 text-center text-[10px]">
                    <thead>
                      <tr className="bg-slate-200 font-bold text-slate-800">
                        <th className="border border-slate-400 px-2 py-1.5">DÍA</th>
                        <th className="border border-slate-400 px-2 py-1.5">FECHA</th>
                        <th className="border border-slate-400 px-2 py-1.5">HORA INGRESO</th>
                        <th className="border border-slate-400 px-2 py-1.5">INICIO REFRIGERIO</th>
                        <th className="border border-slate-400 px-2 py-1.5">FIN REFRIGERIO</th>
                        <th className="border border-slate-400 px-2 py-1.5">HORA SALIDA</th>
                        <th className="border border-slate-400 px-2 py-1.5">
                          FIRMA DIARIA DEL TRABAJADOR
                        </th>
                        <th className="border border-slate-400 px-2 py-1.5">OBSERVACIONES</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sheetData.rows.map((r) => (
                        <tr
                          key={r.isoDate}
                          className={
                            r.isSunday || r.isHoliday
                              ? 'bg-slate-200/80 font-semibold text-slate-700'
                              : ''
                          }
                        >
                          <td className="border border-slate-400 px-2 py-1 capitalize">
                            {r.dayName}
                          </td>
                          <td className="border border-slate-400 px-2 py-1">{r.dateFormatted}</td>
                          <td className="border border-slate-400 px-2 py-1 font-mono">
                            {r.checkIn}
                          </td>
                          <td className="border border-slate-400 px-2 py-1 font-mono">
                            {r.lunchStart}
                          </td>
                          <td className="border border-slate-400 px-2 py-1 font-mono">
                            {r.lunchEnd}
                          </td>
                          <td className="border border-slate-400 px-2 py-1 font-mono">
                            {r.checkOut}
                          </td>
                          <td className="border border-slate-400 px-2 py-0.5 text-center">
                            {r.dailySignature ? (
                              <img
                                src={
                                  r.dailySignature.startsWith('data:')
                                    ? r.dailySignature
                                    : `data:image/png;base64,${r.dailySignature}`
                                }
                                alt="Firma diaria"
                                className="h-6 mx-auto object-contain"
                              />
                            ) : (
                              ''
                            )}
                          </td>
                          <td className="border border-slate-400 px-2 py-1 text-left">
                            {r.observations}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Notas Legales al pie */}
                <div className="space-y-1 text-[9.5px] text-slate-600 pt-2">
                  <p>
                    * El tiempo asignado para el refrigerio es de sesenta (60) minutos diarios, el cual no forma parte de la jornada laboral ordinaria.
                  </p>
                  <p>
                    * Como se establece en nuestro RIT, el refrigerio debe tomarse obligatoriamente entre la 1:00 p.m. y la 1:30 p.m. como hora máxima de inicio.
                  </p>
                  <p className="font-bold text-slate-800 pt-1">
                    * NOTA INFORMATIVA: CORTE DE ASISTENCIA
                  </p>
                  <p>
                    De conformidad con las políticas de cierre de la empresa, el registro y cómputo de la asistencia mensual comprende día 28 del mes pasado hasta el día 27 del mes actual. Por lo tanto, el cálculo de las horas extras y tardanzas en minutos se emitirán considerando este periodo de corte. Las incidencias o sobretiempos realizados entre los días 28 y 30/31 del presente mes no se condonan; serán contabilizados, pagados o descontados de manera obligatoria en la planilla del mes inmediato siguiente.
                  </p>
                </div>

                {/* Firmas finales */}
                <div className="grid grid-cols-2 gap-12 pt-8 text-center text-[10px] font-bold text-slate-700">
                  <div>
                    <div className="h-14 flex items-end justify-center pb-1">
                      {sheetData.closingSignOff?.closingSignature ? (
                        <img
                          src={
                            sheetData.closingSignOff.closingSignature.startsWith('data:')
                              ? sheetData.closingSignOff.closingSignature
                              : `data:image/png;base64,${sheetData.closingSignOff.closingSignature}`
                          }
                          alt="Firma cierre mensual trabajador"
                          className="max-h-12 object-contain"
                        />
                      ) : (
                        <span className="text-[9px] font-normal text-slate-400 italic">
                          Pendiente de firma mensual del trabajador
                        </span>
                      )}
                    </div>
                    <div className="border-t border-slate-500 w-48 mx-auto pt-1">
                      FIRMA DEL TRABAJADOR
                    </div>
                  </div>
                  <div>
                    <div className="h-14 flex items-end justify-center pb-1" />
                    <div className="border-t border-slate-500 w-48 mx-auto pt-1">
                      FIRMA DE RRHH
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}