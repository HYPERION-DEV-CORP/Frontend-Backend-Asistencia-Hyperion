'use client';

import { useState, useEffect } from 'react';

interface AttendanceRecord {
  id: string;
  date: string;
  checkIn: string | null;
  lunchStart: string | null;
  lunchEnd: string | null;
  checkOut: string | null;
  status: string;
  type: string;
  lateMinutes: number;

  // Horas Extras Ley N° 28999
  overtimeMinutes: number;
  overtime25Minutes: number;
  overtime35Minutes: number;
  isOvertimeApproved: boolean;

  // Transparencia Laboral D.S. N° 004-2006-TR
  isModifiedByHR: boolean;
  hrModificationReason: string | null;
  documentUrl?: string | null;

  latitude: number;
  longitude: number;
  user: {
    id: string;
    name: string;
    lastName: string;
    dni: string;
    docType: string;
    jobTitle: string;
    companyName: string;
    companyRuc: string;
  };
}

interface UserOption {
  id: string;
  dni: string;
  name: string;
  lastName: string;
  homeOfficeQuota: number;
}

interface Period {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'IN_REVIEW' | 'CLOSED';
}

export default function HRDashboard() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [filterMode, setFilterMode] = useState<'ALL' | 'PENDING_OT'>('ALL');
  const [loading, setLoading] = useState(true);

  // Estados para el Modal de Edición Manual de RRHH
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editLunchStart, setEditLunchStart] = useState('');
  const [editLunchEnd, setEditLunchEnd] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [resRecords, resUsers, resPeriods] = await Promise.all([
        fetch('/api/v1/hr/records'),
        fetch('/api/v1/users'),
        fetch('/api/v1/hr/payroll/periods'),
      ]);

      if (resRecords.ok) {
        const dataRecords = await resRecords.json();
        setRecords(dataRecords.records || []);
      }

      if (resUsers.ok) {
        const dataUsers = await resUsers.json();
        setUsers(dataUsers.users || []);
      }

      if (resPeriods.ok) {
        const dataPeriods = await resPeriods.json();
        setPeriods(dataPeriods.periods || []);
      }
    } catch (err) {
      console.error('Error cargando datos del dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Función para determinar si una fecha cae en un periodo cerrado
  const checkIsPeriodClosed = (dateStr: string) => {
    if (!dateStr || periods.length === 0) return false;
    const target = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
    return periods.some((p) => {
      if (p.status !== 'CLOSED') return false;
      const start = new Date(p.startDate);
      const end = new Date(p.endDate);
      return target >= start && target <= end;
    });
  };

  // Filtrado combinado por Empleado y por Horas Extras Pendientes
  const filteredRecords = records.filter((r) => {
    const matchesUser = selectedUser === 'ALL' || r.user.dni === selectedUser;
    const matchesOt =
      filterMode === 'ALL' || (r.overtimeMinutes > 0 && !r.isOvertimeApproved);
    return matchesUser && matchesOt;
  });

  // Aprobar o Anular Horas Extras (Punto 3)
  const handleOvertimeDecision = async (
    record: AttendanceRecord,
    decision: 'APPROVE' | 'REJECT' | 'REVOKE'
  ) => {
    if (
      decision === 'REJECT' &&
      !confirm(
        `¿Confirmas que NO PROCEDEN los +${record.overtimeMinutes} min de horas extras de ${record.user.name}? Se descartarán del cálculo de planilla.`
      )
    ) {
      return;
    }

    const storedUser = localStorage.getItem('user');
    const adminId = storedUser ? JSON.parse(storedUser).id : null;

    if (!adminId) {
      alert('No se detectó la sesión del administrador.');
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/attendance/${record.id}/approve-overtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, adminId }),
      });
      const data = await res.json();

      if (res.ok) {
        loadData();
      } else {
        alert(data.error || 'Error al procesar decisión de horas extras.');
      }
    } catch {
      alert('Error de comunicación con el servidor.');
    }
  };

  const downloadExcel = () => {
    window.open('/api/v1/reports/excel', '_blank');
  };

  const downloadPdf = () => {
    const queryParams = new URLSearchParams();
    if (selectedUser !== 'ALL') {
      queryParams.append('dni', selectedUser);
    }
    window.open(`/api/v1/reports/pdf?${queryParams.toString()}`, '_blank');
  };

  const extractHoursAndMinutes = (timeVal: string | null | undefined, defaultTime: string) => {
    if (!timeVal) return defaultTime;
    if (typeof timeVal === 'string' && timeVal.includes(':') && !timeVal.includes('T')) {
      const parts = timeVal.split(':');
      return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    try {
      const date = new Date(timeVal);
      if (isNaN(date.getTime())) return defaultTime;
      return date.toLocaleTimeString('es-PE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      return defaultTime;
    }
  };

  const handleAbrirEdicion = (record: AttendanceRecord) => {
    if (checkIsPeriodClosed(record.date)) {
      alert('Esta marcación corresponde a un periodo de planilla CERRADO y no admite modificaciones.');
      return;
    }

    setSelectedRecord(record);
    setEditCheckIn(extractHoursAndMinutes(record.checkIn, '09:00'));
    setEditLunchStart(extractHoursAndMinutes(record.lunchStart, '13:00'));
    setEditLunchEnd(extractHoursAndMinutes(record.lunchEnd, '14:00'));
    setEditCheckOut(extractHoursAndMinutes(record.checkOut, '18:00'));
    setReason('');
    setDocumentUrl(record.documentUrl || '');
    setShowEditModal(true);
  };

  const handleGuardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord) return;

    if (!reason.trim() || reason.trim().length < 10) {
      alert('SUNAFIL exige un motivo justificado de al menos 10 caracteres para la modificación.');
      return;
    }

    const storedUser = localStorage.getItem('user');
    const adminId = storedUser ? JSON.parse(storedUser).id : null;

    if (!adminId) {
      alert('No se detectó la sesión del usuario administrador.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/admin/attendance/${selectedRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newCheckIn: editCheckIn,
          newLunchStart: editLunchStart,
          newLunchEnd: editLunchEnd,
          newCheckOut: editCheckOut,
          reason: reason.trim(),
          documentUrl: documentUrl.trim() || null,
          adminId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        alert('Marcación y horas extras rectificadas y auditadas exitosamente.');
        setShowEditModal(false);
        loadData();
      } else {
        alert(data.error || data.details || 'Error actualizando la marcación.');
      }
    } catch {
      alert('Error de comunicación con el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return '--:--';
      return date.toLocaleTimeString('es-PE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '--:--';
    }
  };

  const pendingOvertimeCount = records.filter(
    (r) => r.overtimeMinutes > 0 && !r.isOvertimeApproved
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      {/* Encabezado Corporativo Oficial SUNAFIL */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Registro Oficial de Control de Asistencia - SUNAFIL
          </h1>
          <p className="text-sm text-slate-600 font-medium mt-1">
            {records[0]?.user?.companyName || 'HYPERION DIGITAL SECURITY S.A.C.'} | RUC: {records[0]?.user?.companyRuc || '20608810987'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={downloadPdf}
            className="flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-rose-800 transition text-sm"
          >
            📄 Reporte Inalterable SUNAFIL (PDF)
          </button>

          <button
            onClick={downloadExcel}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-emerald-800 transition text-sm"
          >
            📊 Exportar Excel (.xlsx)
          </button>
        </div>
      </header>

      {/* Grilla de 4 Tarjetas KPI */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">Total Empleados</span>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">{loading ? '...' : users.length}</p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">Tardanzas Registradas</span>
          <p className="mt-2 text-3xl font-extrabold text-red-600">
            {records.reduce((acc, r) => acc + (r.lateMinutes > 0 ? 1 : 0), 0)}
          </p>
        </div>

        {/* Tarjeta KPI Interactiva de Horas Extras */}
        <button
          type="button"
          onClick={() => setFilterMode(filterMode === 'PENDING_OT' ? 'ALL' : 'PENDING_OT')}
          className={`text-left rounded-xl p-5 shadow-sm border transition cursor-pointer ${
            filterMode === 'PENDING_OT'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/40'
              : 'bg-white border-slate-200 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase text-slate-500">
              Horas Extras Pendientes
            </span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
              {filterMode === 'PENDING_OT' ? 'Filtro activo' : 'Revisar →'}
            </span>
          </div>
          <p className="mt-2 text-3xl font-extrabold text-amber-600">
            {pendingOvertimeCount}
          </p>
        </button>

        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">Ediciones Auditadas</span>
          <p className="mt-2 text-3xl font-extrabold text-indigo-600">
            {records.filter((r) => r.isModifiedByHR).length}
          </p>
        </div>
      </div>

      {/* Barra de Filtro por Trabajador y Pestañas de Revisión */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-700">Filtrar por Empleado:</label>
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="ALL">-- Todos los Trabajadores ({users.length}) --</option>
            {users.map((u) => (
              <option key={u.id} value={u.dni}>
                {u.name} {u.lastName} (DNI: {u.dni})
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            type="button"
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition cursor-pointer ${
              filterMode === 'ALL'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Todos los Registros ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('PENDING_OT')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
              filterMode === 'PENDING_OT'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-amber-700 hover:bg-amber-100/60'
            }`}
          >
            ⏳ Por Aprobar Horas Extras ({pendingOvertimeCount})
          </button>
        </div>
      </div>

      {/* Tabla Principal de Asistencia */}
      <div className="overflow-x-auto rounded-xl bg-white shadow-sm border border-slate-200">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-100 text-xs uppercase text-slate-700">
            <tr>
              <th className="px-6 py-4">Fecha</th>
              <th className="px-6 py-4">Trabajador</th>
              <th className="px-6 py-4">Método</th>
              <th className="px-6 py-4">Ingreso / Salida</th>
              <th className="px-6 py-4 text-center">Refrigerio (Ini / Fin)</th>
              <th className="px-6 py-4">Tardanza</th>
              <th className="px-6 py-4">Horas Extras (25% / 35%)</th>
              <th className="px-6 py-4">Ubicación GPS</th>
              <th className="px-6 py-4">Acciones / Auditoría</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
                  Cargando registros de asistencia...
                </td>
              </tr>
            ) : filteredRecords.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-slate-400">
                  {filterMode === 'PENDING_OT'
                    ? 'No hay horas extras pendientes de aprobación.'
                    : 'No hay registros encontrados.'}
                </td>
              </tr>
            ) : (
              filteredRecords.map((rec) => {
                const isLocked = checkIsPeriodClosed(rec.date);
                return (
                  <tr key={rec.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900 whitespace-nowrap">
                      {rec.date}
                      {isLocked && (
                        <span
                          className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-700"
                          title="Periodo cerrado para nómina"
                        >
                          🔒 Cerrado
                        </span>
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">
                        {rec.user.name} {rec.user.lastName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {rec.user.docType || 'DNI'}: {rec.user.dni}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span
                        className={`inline-block px-2.5 py-1 text-xs font-bold rounded-md ${
                          rec.type === 'HOME_OFFICE'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {rec.type || 'PRESENCIAL'}
                      </span>
                    </td>

                    {/* INGRESO Y SALIDA OFICIAL */}
                    <td className="px-6 py-4 font-mono text-xs">
                      <div className="font-semibold text-slate-900">IN: {formatTime(rec.checkIn)}</div>
                      <div className="text-slate-500">OUT: {formatTime(rec.checkOut)}</div>
                    </td>

                    {/* REFRIGERIO INICIO Y FIN */}
                    <td className="px-6 py-4 font-mono text-xs text-center">
                      <div className="text-amber-600 font-semibold">
                        INI: {formatTime(rec.lunchStart)}
                      </div>
                      <div className="text-emerald-600 font-semibold">
                        FIN: {formatTime(rec.lunchEnd)}
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      {rec.lateMinutes > 0 ? (
                        <span className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 ring-1 ring-inset ring-red-600/20">
                          +{rec.lateMinutes} min
                        </span>
                      ) : (
                        <span className="text-slate-400">0 min</span>
                      )}
                    </td>

                    {/* Desglose y Aprobación de Horas Extras Ley N° 28999 */}
                    <td className="px-6 py-4 font-mono text-xs">
                      {rec.overtimeMinutes > 0 ? (
                        <div className="space-y-1.5">
                          <div className="text-slate-900 font-bold">
                            Total: +{rec.overtimeMinutes} min
                          </div>
                          <div className="text-slate-500 text-[11px]">
                            25%: {rec.overtime25Minutes}m | 35%: {rec.overtime35Minutes}m
                          </div>

                          {rec.isOvertimeApproved ? (
                            <div className="flex items-center gap-2 pt-0.5 font-sans">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                ✓ PROCEDE (Pagable)
                              </span>
                              {!isLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleOvertimeDecision(rec, 'REVOKE')}
                                  className="text-[10px] text-rose-600 hover:underline font-semibold cursor-pointer"
                                >
                                  Anular
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="pt-0.5 space-y-1.5 font-sans">
                              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                ⏳ Pendiente de revisión
                              </span>
                              {!isLocked && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOvertimeDecision(rec, 'APPROVE')}
                                    className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-sm transition cursor-pointer"
                                  >
                                    ✓ Procede
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOvertimeDecision(rec, 'REJECT')}
                                    className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold shadow-sm transition cursor-pointer"
                                  >
                                    ✕ No procede
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">Sin Horas Extras</span>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      {rec.latitude && rec.longitude ? (
                        <a
                          href={`https://www.google.com/maps?q=${rec.latitude},${rec.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-indigo-600 hover:underline"
                        >
                          📍 {rec.latitude.toFixed(4)}, {rec.longitude.toFixed(4)}
                        </a>
                      ) : (
                        'Sin GPS'
                      )}
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 items-start">
                        {isLocked ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-400 cursor-not-allowed border border-slate-200"
                            title="Periodo cerrado. Modificaciones deshabilitadas."
                          >
                            🔒 Bloqueado
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAbrirEdicion(rec)}
                            className="rounded bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 hover:bg-amber-100 transition cursor-pointer"
                          >
                            ✏️ Corregir
                          </button>
                        )}

                        {rec.isModifiedByHR && (
                          <span
                            className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200 cursor-help"
                            title={`Motivo: ${rec.hrModificationReason || 'Modificado por RRHH'}${rec.documentUrl ? ` | Sustento: ${rec.documentUrl}` : ''}`}
                          >
                            ✓ Auditado por RRHH
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modal de Corrección Manual de RRHH */}
      {showEditModal && selectedRecord && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              Corregir Marcación de {selectedRecord.user.name}
            </h2>
            <p className="text-xs text-slate-500 mb-4 font-mono">
              Fecha: {selectedRecord.date} | {selectedRecord.user.docType || 'DNI'}: {selectedRecord.user.dni}
            </p>

            <form onSubmit={handleGuardarEdicion} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">Hora Ingreso</label>
                  <input
                    type="time"
                    required
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none"
                    value={editCheckIn}
                    onChange={(e) => setEditCheckIn(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">Hora Salida</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none"
                    value={editCheckOut}
                    onChange={(e) => setEditCheckOut(e.target.value)}
                  />
                </div>
              </div>

              {/* Tiempos de Refrigerio */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="text-xs font-bold text-amber-700 block mb-1">Inicio Refrigerio</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none"
                    value={editLunchStart}
                    onChange={(e) => setEditLunchStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-emerald-700 block mb-1">Fin Refrigerio</label>
                  <input
                    type="time"
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none"
                    value={editLunchEnd}
                    onChange={(e) => setEditLunchEnd(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Motivo Justificado (Exigencia SUNAFIL) *
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Ej: Omisión de marcación por comisión de servicios autorizada mediante memorando..."
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400 outline-none"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <span className="text-[10px] text-slate-400">Mínimo 10 caracteres obligatorios.</span>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Enlace de Documento / Sustento (Opcional)
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400 outline-none"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowEditModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-md transition"
                >
                  {submitting ? 'Guardando...' : 'Guardar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}