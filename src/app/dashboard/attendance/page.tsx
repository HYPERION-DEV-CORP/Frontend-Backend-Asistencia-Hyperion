'use client';

import { useState, useEffect } from 'react';
import BiometricScheduleModal from '@/app/components/BiometricScheduleModal';

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
  observations?: string | null;
  tareoObservation?: string | null;

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

interface UnmappedBioUser {
  enNo: string;
  deviceName: string;
  count: number;
}

interface BiometricSyncJob {
  id: string;
  filterType: string;
  startMonth: string | null;
  endMonth: string | null;
  status: 'PENDING' | 'COMPLETED' | 'ERROR';
  recordsSent: number;
  processedNew: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

const getCurrentPeruMonth = () => {
  const nowPeru = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return nowPeru.toISOString().slice(0, 7); // "YYYY-MM"
};

export default function HRDashboard() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [enabledModules, setEnabledModules] = useState<string[]>([
    'ATTENDANCE_QR',
    'BIOMETRIC_SYNC',
    'AUTO_ABSENCE_CRON',
  ]);

  // Filtros visuales de la tabla
  const [selectedUser, setSelectedUser] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentPeruMonth);
  const [filterMode, setFilterMode] = useState<'ALL' | 'PENDING_OT'>('ALL');
  const [loading, setLoading] = useState(true);

  // Estados para el Modal de Edición Manual de RRHH
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editLunchStart, setEditLunchStart] = useState('');
  const [editLunchEnd, setEditLunchEnd] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editIsHoliday, setEditIsHoliday] = useState(false);
  const [editTareoObs, setEditTareoObs] = useState('');
  const [reason, setReason] = useState('');
  const [documentUrl, setDocumentUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Estados para Modal Rápido de Feriado / Observación (fechas sin marcación)
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState({
    userId: 'ALL',
    date: '',
    isHoliday: true,
    tareoObservation: 'FERIADO NO LABORABLE',
  });
  const [holidaySubmitting, setHolidaySubmitting] = useState(false);

  // Estados para Sincronización / Importación Biométrica
  const [showBioModal, setShowBioModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [bioMode, setBioMode] = useState<'DIRECT_SYNC' | 'FILE_UPLOAD'>('DIRECT_SYNC');
  const [bioFile, setBioFile] = useState<File | null>(null);
  const [bioFilterType, setBioFilterType] = useState<'ALL' | 'SINGLE_MONTH' | 'RANGE'>('SINGLE_MONTH');
  const [bioStartMonth, setBioStartMonth] = useState<string>(getCurrentPeruMonth);
  const [bioEndMonth, setBioEndMonth] = useState<string>(getCurrentPeruMonth);
  const [bioUploading, setBioUploading] = useState(false);
  const [unmappedBioUsers, setUnmappedBioUsers] = useState<UnmappedBioUser[]>([]);
  const [bioMapping, setBioMapping] = useState<Record<string, string>>({});
  const [bioSummary, setBioSummary] = useState<string | null>(null);
  const [syncJobs, setSyncJobs] = useState<BiometricSyncJob[]>([]);
  const [syncRequesting, setSyncRequesting] = useState(false);

  // Estado para Auditoría Manual de Faltas
  const [auditingAbsences, setAuditingAbsences] = useState(false);

  const loadData = async (runSilentAbsenceCheck = false, isBackgroundRefresh = false) => {
    try {
      if (runSilentAbsenceCheck) {
        const todayKey = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().split('T')[0];
        const lastAutoAudit = localStorage.getItem('hyperion_last_absence_audit');
        if (lastAutoAudit !== todayKey) {
          await fetch('/api/v1/cron/mark-absences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          }).catch(() => null);
          localStorage.setItem('hyperion_last_absence_audit', todayKey);
        }
      }

      const [resRecords, resUsers, resPeriods, resSub] = await Promise.all([
        fetch('/api/v1/hr/records', { cache: 'no-store' }),
        fetch('/api/v1/users', { cache: 'no-store' }),
        fetch('/api/v1/hr/payroll/periods', { cache: 'no-store' }),
        fetch('/api/v1/admin/subscription', { cache: 'no-store' }),
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

      if (resSub.ok) {
        const dataSub = await resSub.json();
        if (dataSub.subscription?.enabledModules) {
          setEnabledModules(dataSub.subscription.enabledModules);
        }
      }
    } catch (err) {
      if (!isBackgroundRefresh) {
        console.error('Error cargando datos del dashboard:', err);
      }
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData(false, false);

    // Actualizar automáticamente cada 10 segundos si la pestaña está activa y no hay modales abiertos
    const interval = setInterval(() => {
      if (
        document.visibilityState === 'visible' &&
        !showEditModal &&
        !showHolidayModal &&
        !showBioModal &&
        !showScheduleModal
      ) {
        loadData(false, true);
      }
    }, 10000);

    // Refrescar inmediatamente cuando el usuario vuelve a la pestaña del navegador
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData(false, true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [showEditModal, showHolidayModal, showBioModal, showScheduleModal]);

  const loadSyncJobs = async () => {
    try {
      const res = await fetch('/api/v1/biometric/sync-jobs');
      if (res.ok) {
        const data = await res.json();
        const jobsList: BiometricSyncJob[] = data.recentJobs || [];
        setSyncJobs((prev) => {
          const prevLatest = prev[0];
          const newLatest = jobsList[0];
          if (
            newLatest &&
            newLatest.status === 'COMPLETED' &&
            (!prevLatest ||
              prevLatest.id !== newLatest.id ||
              prevLatest.status !== 'COMPLETED')
          ) {
            loadData(false);
          }
          return jobsList;
        });
      }
    } catch {
      // Silencioso durante polling
    }
  };

  useEffect(() => {
    if (!showBioModal) return;
    loadSyncJobs();
    const interval = setInterval(loadSyncJobs, 1500);
    return () => clearInterval(interval);
  }, [showBioModal]);

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

  // Filtrado combinado: Empleado + Mes Seleccionado + Horas Extras Pendientes
  const filteredRecords = records.filter((r) => {
    const matchesUser = selectedUser === 'ALL' || r.user.dni === selectedUser;
    const matchesMonth = !selectedMonth || r.date.startsWith(selectedMonth);
    const matchesOt =
      filterMode === 'ALL' || (r.overtimeMinutes > 0 && !r.isOvertimeApproved);
    return matchesUser && matchesMonth && matchesOt;
  });

  // Solicitar extracción directa al agente biométrico sin abrir AttendanceTracker
  const handleDirectBiometricSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bioFilterType === 'RANGE' && bioStartMonth && bioEndMonth && bioStartMonth > bioEndMonth) {
      alert('El mes de inicio no puede ser posterior al mes de fin.');
      return;
    }

    setSyncRequesting(true);
    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : '';

      const res = await fetch('/api/v1/biometric/sync-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filterType: bioFilterType,
          startMonth: bioFilterType !== 'ALL' ? bioStartMonth : null,
          endMonth: bioFilterType === 'RANGE' ? bioEndMonth : null,
          adminId,
        }),
      });

      if (res.ok) {
        await loadSyncJobs();
      } else {
        alert('No se pudo encolar la sincronización biométrica.');
      }
    } catch {
      alert('Error de conexión con el servidor.');
    } finally {
      setSyncRequesting(false);
    }
  };

  // Procesar subida del archivo biométrico ALOG_001.txt
  const handleBiometricUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bioFile) return;

    if (bioFilterType === 'RANGE' && bioStartMonth && bioEndMonth && bioStartMonth > bioEndMonth) {
      alert('El mes de inicio no puede ser posterior al mes de fin.');
      return;
    }

    setBioUploading(true);
    setBioSummary(null);
    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : '';

      const formData = new FormData();
      formData.append('file', bioFile);
      formData.append('filterType', bioFilterType);
      if (bioFilterType === 'SINGLE_MONTH' && bioStartMonth) {
        formData.append('startMonth', bioStartMonth);
      } else if (bioFilterType === 'RANGE') {
        if (bioStartMonth) formData.append('startMonth', bioStartMonth);
        if (bioEndMonth) formData.append('endMonth', bioEndMonth);
      }
      if (adminId) formData.append('adminId', adminId);
      if (Object.keys(bioMapping).length > 0) {
        formData.append('mapping', JSON.stringify(bioMapping));
      }

      const res = await fetch('/api/v1/biometric/import', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Error al importar el archivo biométrico.');
        return;
      }

      setUnmappedBioUsers(data.unmappedUsers || []);
      setBioSummary(
        `Sincronización completada: ${data.importedDays} días nuevos, ${data.mergedDays} fusionados/actualizados, ${data.unchangedDays} sin cambios.`
      );
      await loadData(false);
    } catch {
      alert('Error de conexión al procesar el archivo biométrico.');
    } finally {
      setBioUploading(false);
    }
  };

  // Ejecutar detección manual de faltas injustificadas
  const handleAuditAbsences = async () => {
    if (
      !confirm(
        '¿Ejecutar la auditoría de inasistencias para los días pasados sin marcación ni papeleta aprobada?'
      )
    ) {
      return;
    }

    setAuditingAbsences(true);
    try {
      const storedUser = localStorage.getItem('user');
      const adminId = storedUser ? JSON.parse(storedUser).id : null;

      const res = await fetch('/api/v1/cron/mark-absences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId }),
      });

      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Auditoría de faltas ejecutada.');
        loadData(false);
      } else {
        alert(data.error || 'Error al auditar faltas.');
      }
    } catch {
      alert('Error de conexión al auditar faltas.');
    } finally {
      setAuditingAbsences(false);
    }
  };

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
        loadData(false);
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

  const extractHoursAndMinutes = (timeVal: string | null | undefined, defaultTime = '') => {
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
    setEditLunchStart(extractHoursAndMinutes(record.lunchStart, ''));
    setEditLunchEnd(extractHoursAndMinutes(record.lunchEnd, ''));
    setEditCheckOut(extractHoursAndMinutes(record.checkOut, ''));
    setEditIsHoliday(record.status === 'HOLIDAY');
    setEditTareoObs(record.tareoObservation || '');
    setReason('');
    setDocumentUrl(record.documentUrl || '');
    setShowEditModal(true);
  };

  const handleRellenarJornadaCompleta = () => {
    if (!selectedRecord) return;
    const recordDate = new Date(
      selectedRecord.date.includes('T') ? selectedRecord.date : `${selectedRecord.date}T00:00:00`
    );
    const isSaturday = recordDate.getDay() === 6;

    if (!editCheckIn) setEditCheckIn('09:00');
    if (isSaturday) {
      if (!editCheckOut) setEditCheckOut('13:30');
    } else {
      if (!editLunchStart) setEditLunchStart('13:00');
      if (!editLunchEnd) setEditLunchEnd('14:00');
      if (!editCheckOut) setEditCheckOut('18:00');
    }
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
          newCheckIn: editIsHoliday ? null : editCheckIn || null,
          newLunchStart: editIsHoliday ? null : editLunchStart || null,
          newLunchEnd: editIsHoliday ? null : editLunchEnd || null,
          newCheckOut: editIsHoliday ? null : editCheckOut || null,
          isHoliday: editIsHoliday,
          tareoObservation: editTareoObs,
          reason: reason.trim(),
          documentUrl: documentUrl.trim() || null,
          adminId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        alert('Marcación rectificada y auditada exitosamente.');
        setShowEditModal(false);
        loadData(false);
      } else {
        alert(data.error || data.details || 'Error actualizando la marcación.');
      }
    } catch {
      alert('Error de comunicación con el servidor.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGuardarFeriadoManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const storedUser = localStorage.getItem('user');
    const adminId = storedUser ? JSON.parse(storedUser).id : null;
    if (!adminId) {
      alert('No se detectó la sesión del usuario administrador.');
      return;
    }

    setHolidaySubmitting(true);
    try {
      const res = await fetch('/api/v1/admin/attendance/manual-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...holidayForm,
          adminId,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || 'Registro guardado exitosamente.');
        setShowHolidayModal(false);
        loadData(false);
      } else {
        alert(data.error || 'Error al registrar feriado u observación.');
      }
    } catch {
      alert('Error de conexión con el servidor.');
    } finally {
      setHolidaySubmitting(false);
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

  const monthRecords = records.filter((r) => !selectedMonth || r.date.startsWith(selectedMonth));
  const pendingOvertimeCount = monthRecords.filter(
    (r) => r.overtimeMinutes > 0 && !r.isOvertimeApproved
  ).length;

  const pendingBioJob = syncJobs.find((j) => j.status === 'PENDING');
  const lastCompletedBioJob = syncJobs.find((j) => j.status === 'COMPLETED');
  const lastErrorBioJob = syncJobs[0]?.status === 'ERROR' ? syncJobs[0] : null;

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      {/* Encabezado Corporativo Oficial SUNAFIL */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Registro Oficial de Control de Asistencia - SUNAFIL
          </h1>
          <p className="text-sm text-slate-600 font-medium mt-1">
            {records[0]?.user?.companyName || 'HYPERION DIGITAL SECURITY S.A.C.'} | RUC:{' '}
            {records[0]?.user?.companyRuc || '20608810987'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {enabledModules.includes('BIOMETRIC_SYNC') && (
            <>
              <button
                onClick={() => {
                  setBioMode('DIRECT_SYNC');
                  setBioFile(null);
                  setBioSummary(null);
                  setUnmappedBioUsers([]);
                  setShowBioModal(true);
                }}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-indigo-700 transition text-sm cursor-pointer"
              >
                🧬 Sincronizar Biométrico
              </button>

              <button
                onClick={() => setShowScheduleModal(true)}
                className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-slate-800 transition text-sm cursor-pointer"
              >
                ⚙️ Franjas Horarias
              </button>
            </>
          )}

          {enabledModules.includes('AUTO_ABSENCE_CRON') && (
            <button
              onClick={handleAuditAbsences}
              disabled={auditingAbsences}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-slate-900 transition text-sm cursor-pointer disabled:opacity-60"
            >
              🕵️ {auditingAbsences ? 'Auditando...' : 'Auditar Faltas'}
            </button>
          )}

          <button
            onClick={() => {
              setHolidayForm({
                userId: 'ALL',
                date: '',
                isHoliday: true,
                tareoObservation: 'FERIADO NO LABORABLE',
              });
              setShowHolidayModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-amber-700 transition text-sm cursor-pointer"
          >
            🎉 Feriado / Obs. Tareo
          </button>

          <button
            onClick={downloadPdf}
            className="flex items-center gap-2 rounded-lg bg-rose-700 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-rose-800 transition text-sm cursor-pointer"
          >
            📄 Reporte SUNAFIL (PDF)
          </button>

          <button
            onClick={downloadExcel}
            className="flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white shadow-md hover:bg-emerald-800 transition text-sm cursor-pointer"
          >
            📊 Exportar Excel (.xlsx)
          </button>
        </div>
      </header>

      {/* Grilla de 4 Tarjetas KPI */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">Total Empleados</span>
          <p className="mt-2 text-3xl font-extrabold text-slate-800">
            {loading ? '...' : users.length}
          </p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">
            Tardanzas ({selectedMonth || 'Histórico'})
          </span>
          <p className="mt-2 text-3xl font-extrabold text-red-600">
            {monthRecords.reduce((acc, r) => acc + (r.lateMinutes > 0 ? 1 : 0), 0)}
          </p>
        </div>

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
          <p className="mt-2 text-3xl font-extrabold text-amber-600">{pendingOvertimeCount}</p>
        </button>

        <div className="rounded-xl bg-white p-5 shadow-sm border border-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-400">
            Ediciones Auditadas
          </span>
          <p className="mt-2 text-3xl font-extrabold text-indigo-600">
            {monthRecords.filter((r) => r.isModifiedByHR).length}
          </p>
        </div>
      </div>

      {/* Barra de Filtro por Mes, Trabajador y Pestañas de Revisión */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          {/* Selector Visual de Mes */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">Mes:</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            {selectedMonth ? (
              <button
                type="button"
                onClick={() => setSelectedMonth('')}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                Ver todos
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSelectedMonth(getCurrentPeruMonth())}
                className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                Mes actual
              </button>
            )}
          </div>

          {/* Selector por Trabajador */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-semibold text-slate-700">Empleado:</label>
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="ALL">-- Todos ({users.length}) --</option>
              {users.map((u) => (
                <option key={u.id} value={u.dni}>
                  {u.name} {u.lastName} ({u.dni})
                </option>
              ))}
            </select>
          </div>
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
            Registros del Mes ({monthRecords.length})
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
            ⏳ Horas Extras Pendientes ({pendingOvertimeCount})
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
              <th className="px-6 py-4">Método / Estado</th>
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
                    ? 'No hay horas extras pendientes de aprobación en este mes.'
                    : 'No hay registros encontrados para el mes o filtro seleccionado.'}
                </td>
              </tr>
            ) : (
              filteredRecords.map((rec) => {
                const isLocked = checkIsPeriodClosed(rec.date);
                const isAbsent = rec.status === 'ABSENT';
                const isHoliday = rec.status === 'HOLIDAY';
                return (
                  <tr
                    key={rec.id}
                    className={
                      isHoliday
                        ? 'bg-amber-50/60 hover:bg-amber-50'
                        : isAbsent
                        ? 'bg-rose-50/50 hover:bg-rose-50'
                        : 'hover:bg-slate-50'
                    }
                  >
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
                      {isHoliday ? (
                        <span className="inline-block px-2.5 py-1 text-xs font-bold rounded-md bg-amber-100 text-amber-800 border border-amber-300">
                          🎉 FERIADO NO LABORABLE
                        </span>
                      ) : isAbsent ? (
                        <span className="inline-block px-2.5 py-1 text-xs font-bold rounded-md bg-rose-100 text-rose-800 border border-rose-200">
                          ✕ FALTA INJUSTIFICADA
                        </span>
                      ) : (
                        <span
                          className={`inline-block px-2.5 py-1 text-xs font-bold rounded-md ${
                            rec.type === 'HOME_OFFICE'
                              ? 'bg-purple-100 text-purple-700'
                              : rec.type === 'BIOMETRIC_FINGERPRINT'
                              ? 'bg-indigo-100 text-indigo-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {rec.type || 'PRESENCIAL'}
                        </span>
                      )}
                      {rec.tareoObservation && (
                        <div className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1">
                          📋 Tareo: {rec.tareoObservation}
                        </div>
                      )}
                    </td>

                    <td className="px-6 py-4 font-mono text-xs">
                      <div className="font-semibold text-slate-900">
                        IN: {formatTime(rec.checkIn)}
                      </div>
                      <div className="text-slate-500">OUT: {formatTime(rec.checkOut)}</div>
                    </td>

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
                            title={`Motivo: ${rec.hrModificationReason || 'Modificado por RRHH'}${
                              rec.documentUrl ? ` | Sustento: ${rec.documentUrl}` : ''
                            }`}
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

      {/* Modal de Sincronización / Importación Biométrica */}
      {showBioModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              🧬 Sincronización del Reloj Biométrico
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Extrae las marcaciones directamente desde el reloj biométrico en red o sube un archivo manual de respaldo.
            </p>

            {/* Selector de Modo */}
            <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setBioMode('DIRECT_SYNC')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
                  bioMode === 'DIRECT_SYNC'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ⚡ Directo desde Reloj
              </button>
              <button
                type="button"
                onClick={() => setBioMode('FILE_UPLOAD')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
                  bioMode === 'FILE_UPLOAD'
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                📄 Subir Archivo (.txt / .csv)
              </button>
            </div>

            {bioMode === 'DIRECT_SYNC' ? (
              <form onSubmit={handleDirectBiometricSync} className="space-y-4">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">Estado del Servicio Biométrico:</span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      En línea (Tiempo real)
                    </span>
                  </div>
                  {pendingBioJob ? (
                    <p className="text-amber-700 font-semibold">
                      ⏳ Extracción en proceso (
                      {pendingBioJob.filterType === 'ALL'
                        ? 'Todo el historial'
                        : pendingBioJob.filterType === 'RANGE'
                        ? `${pendingBioJob.startMonth} a ${pendingBioJob.endMonth}`
                        : pendingBioJob.startMonth}
                      )... Se actualizará en segundos.
                    </p>
                  ) : lastErrorBioJob ? (
                    <p className="text-rose-600 font-semibold">
                      ⚠️ Último intento con observación: {lastErrorBioJob.errorMessage}
                    </p>
                  ) : lastCompletedBioJob ? (
                    <p className="text-slate-600">
                      ✅ Última extracción:{' '}
                      {lastCompletedBioJob.completedAt
                        ? new Date(lastCompletedBioJob.completedAt).toLocaleString('es-PE')
                        : 'Reciente'}{' '}
                      ({lastCompletedBioJob.processedNew} nuevos registros procesados).
                    </p>
                  ) : (
                    <p className="text-slate-500">
                      Las marcaciones diarias se sincronizan automáticamente. Usa este panel si deseas extraer un mes pasado específico.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1.5">
                    Alcance de Fechas a Extraer del Reloj
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setBioFilterType('SINGLE_MONTH')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'SINGLE_MONTH'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Un mes específico
                    </button>
                    <button
                      type="button"
                      onClick={() => setBioFilterType('RANGE')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'RANGE'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Rango de meses
                    </button>
                    <button
                      type="button"
                      onClick={() => setBioFilterType('ALL')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'ALL'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Todo el historial
                    </button>
                  </div>
                </div>

                {bioFilterType === 'SINGLE_MONTH' && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Mes a Extraer
                    </label>
                    <input
                      type="month"
                      required
                      value={bioStartMonth}
                      onChange={(e) => setBioStartMonth(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                    />
                  </div>
                )}

                {bioFilterType === 'RANGE' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Desde el Mes (Inicio)
                      </label>
                      <input
                        type="month"
                        required
                        value={bioStartMonth}
                        onChange={(e) => setBioStartMonth(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Hasta el Mes (Fin)
                      </label>
                      <input
                        type="month"
                        required
                        value={bioEndMonth}
                        onChange={(e) => setBioEndMonth(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowBioModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    disabled={syncRequesting || Boolean(pendingBioJob)}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-md transition disabled:opacity-50 cursor-pointer"
                  >
                    {pendingBioJob ? 'Extrayendo del reloj...' : 'Extraer y Registrar Ahora'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleBiometricUpload} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1.5">
                    1. Seleccionar Archivo Biométrico (.txt)
                  </label>
                  <input
                    type="file"
                    accept=".txt,.csv"
                    required
                    onChange={(e) => setBioFile(e.target.files?.[0] || null)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-700 bg-slate-50"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1.5">
                    2. Alcance de Fechas a Procesar
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setBioFilterType('ALL')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'ALL'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Todo el archivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setBioFilterType('SINGLE_MONTH')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'SINGLE_MONTH'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Un mes específico
                    </button>
                    <button
                      type="button"
                      onClick={() => setBioFilterType('RANGE')}
                      className={`py-2 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer ${
                        bioFilterType === 'RANGE'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      Rango de meses
                    </button>
                  </div>
                </div>

                {bioFilterType === 'SINGLE_MONTH' && (
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Mes a Importar
                    </label>
                    <input
                      type="month"
                      required
                      value={bioStartMonth}
                      onChange={(e) => setBioStartMonth(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                    />
                  </div>
                )}

                {bioFilterType === 'RANGE' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Desde el Mes (Inicio)
                      </label>
                      <input
                        type="month"
                        required
                        value={bioStartMonth}
                        onChange={(e) => setBioStartMonth(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1">
                        Hasta el Mes (Fin)
                      </label>
                      <input
                        type="month"
                        required
                        value={bioEndMonth}
                        onChange={(e) => setBioEndMonth(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-800 bg-slate-50"
                      />
                    </div>
                  </div>
                )}

                {bioSummary && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-800 font-medium">
                    ✅ {bioSummary}
                  </div>
                )}

                {unmappedBioUsers.length > 0 && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2.5">
                    <p className="text-xs font-bold text-amber-900">
                      ⚠️ Códigos del reloj sin trabajador asignado ({unmappedBioUsers.length}):
                    </p>
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {unmappedBioUsers.map((u) => (
                        <div
                          key={u.enNo}
                          className="flex items-center justify-between gap-2 bg-white p-2 rounded border border-amber-200 text-xs"
                        >
                          <div>
                            <span className="font-mono font-bold text-slate-800">#{u.enNo}</span>{' '}
                            <span className="text-slate-600">({u.deviceName})</span>
                          </div>
                          <select
                            value={bioMapping[u.enNo] || ''}
                            onChange={(e) =>
                              setBioMapping({ ...bioMapping, [u.enNo]: e.target.value })
                            }
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
                          >
                            <option value="">-- Ignorar --</option>
                            {users.map((usr) => (
                              <option key={usr.id} value={usr.id}>
                                {usr.name} {usr.lastName} ({usr.dni})
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowBioModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    disabled={bioUploading || !bioFile}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700 shadow-md transition disabled:opacity-50"
                  >
                    {bioUploading ? 'Procesando...' : 'Procesar Archivo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal de Franjas Horarias del Reloj Biométrico por Empresa */}
      <BiometricScheduleModal
        open={showScheduleModal}
        onClose={() => setShowScheduleModal(false)}
      />

      {/* Modal de Corrección Manual de RRHH */}
      {showEditModal && selectedRecord && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50 overflow-y-auto">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 my-6">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Corregir Marcación de {selectedRecord.user.name}
                </h2>
                <p className="text-xs text-slate-500 mb-3 font-mono">
                  Fecha: {selectedRecord.date} | {selectedRecord.user.docType || 'DNI'}:{' '}
                  {selectedRecord.user.dni}
                </p>
              </div>
              {!editIsHoliday && (
                <button
                  type="button"
                  onClick={handleRellenarJornadaCompleta}
                  className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-md border border-indigo-200 transition cursor-pointer whitespace-nowrap"
                  title="Completa las horas vacías con el horario estándar del día"
                >
                  Rellenar día completo
                </button>
              )}
            </div>

            <div className="mb-3 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-600">
              Deja vacíos (<code>--:--</code>) los eventos que el trabajador aún no ha marcado hoy
              para que pueda registrarlos desde su app móvil.
            </div>

            <form onSubmit={handleGuardarEdicion} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-800 block mb-1">
                    Hora Ingreso {!editIsHoliday && '*'}
                  </label>
                  <input
                    type="time"
                    required={!editIsHoliday}
                    disabled={editIsHoliday}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none disabled:opacity-50"
                    value={editCheckIn}
                    onChange={(e) => setEditCheckIn(e.target.value)}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-800">Hora Salida</label>
                    {editCheckOut && !editIsHoliday && (
                      <button
                        type="button"
                        onClick={() => setEditCheckOut('')}
                        className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <input
                    type="time"
                    disabled={editIsHoliday}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none disabled:opacity-50"
                    value={editCheckOut}
                    onChange={(e) => setEditCheckOut(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-amber-700">Inicio Refrigerio</label>
                    {editLunchStart && !editIsHoliday && (
                      <button
                        type="button"
                        onClick={() => setEditLunchStart('')}
                        className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <input
                    type="time"
                    disabled={editIsHoliday}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none disabled:opacity-50"
                    value={editLunchStart}
                    onChange={(e) => setEditLunchStart(e.target.value)}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-emerald-700">Fin Refrigerio</label>
                    {editLunchEnd && !editIsHoliday && (
                      <button
                        type="button"
                        onClick={() => setEditLunchEnd('')}
                        className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <input
                    type="time"
                    disabled={editIsHoliday}
                    className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 font-semibold outline-none disabled:opacity-50"
                    value={editLunchEnd}
                    onChange={(e) => setEditLunchEnd(e.target.value)}
                  />
                </div>
              </div>

              {/* Bloque Feriado / Observación Manual SUNAFIL */}
              <div className="rounded-lg bg-amber-50/80 border border-amber-200 p-3 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editIsHoliday}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setEditIsHoliday(checked);
                      if (checked && !editTareoObs) {
                        setEditTareoObs('FERIADO NO LABORABLE');
                      }
                    }}
                    className="rounded border-slate-300 text-indigo-600"
                  />
                  🎉 Marcar este día como Feriado No Laborable
                </label>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Observación Oficial para Tareo SUNAFIL (Lunes a Sábado)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej: Feriado Nacional / Comisión de servicios..."
                    value={editTareoObs}
                    onChange={(e) => setEditTareoObs(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
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
                <span className="text-[10px] text-slate-400">
                  Mínimo 10 caracteres obligatorios.
                </span>
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

      {/* Modal Rápido de Feriado / Observación Manual SUNAFIL */}
      {showHolidayModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900">
              🎉 Registrar Feriado u Observación SUNAFIL
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Aplica feriados calendario u observaciones manuales de Lunes a Sábado. Los días domingo se marcan automáticamente como Descanso Semanal.
            </p>

            <form onSubmit={handleGuardarFeriadoManual} className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Trabajador(es)
                </label>
                <select
                  value={holidayForm.userId}
                  onChange={(e) => setHolidayForm({ ...holidayForm, userId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-slate-50"
                >
                  <option value="ALL">-- Todos los trabajadores activos ({users.length}) --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.lastName} ({u.dni})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Fecha (Lunes a Sábado) *
                </label>
                <input
                  type="date"
                  required
                  value={holidayForm.date}
                  onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-slate-50"
                />
              </div>

              <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={holidayForm.isHoliday}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHolidayForm({
                      ...holidayForm,
                      isHoliday: checked,
                      tareoObservation: checked ? 'FERIADO NO LABORABLE' : '',
                    });
                  }}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Es Feriado No Laborable (resaltar igual que Descanso Semanal)
              </label>

              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">
                  Texto en Columna Observaciones (SUNAFIL) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej: FERIADO NO LABORABLE - DÍA DE TODOS LOS SANTOS"
                  value={holidayForm.tareoObservation}
                  onChange={(e) =>
                    setHolidayForm({ ...holidayForm, tareoObservation: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 bg-slate-50"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={holidaySubmitting}
                  onClick={() => setShowHolidayModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={holidaySubmitting}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold text-white hover:bg-amber-700 shadow-md transition"
                >
                  {holidaySubmitting ? 'Guardando...' : 'Guardar en Tareo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}