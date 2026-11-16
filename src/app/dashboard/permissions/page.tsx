// src/app/dashboard/permissions/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  FileCheck2,
  PlusCircle,
  Clock,
  Check,
  X,
  Eye,
  Signature,
  FileText,
  CalendarCheck,
} from 'lucide-react';

interface Permission {
  id: string;
  type: string;
  reason: string;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: string | null;
  employeeSignature?: string | null;
  signedPdfBase64?: string | null;
  signatureCode?: string | null;
  user: {
    id: string;
    name: string;
    lastName: string;
    dni: string;
  };
}

interface UserOption {
  id: string;
  name: string;
  lastName: string;
  dni: string;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('ALL');
  const [showModal, setShowModal] = useState(false);
  const [selectedSignature, setSelectedSignature] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    userId: '',
    type: 'PERSONAL_PERMIT',
    reason: '',
    startDate: '',
    endDate: '',
  });

  const loadData = async () => {
    try {
      const [resPerms, resUsers] = await Promise.all([
        fetch('/api/v1/hr/permissions'),
        fetch('/api/v1/users'),
      ]);

      if (resPerms.ok) {
        const dataPerms = await resPerms.json();
        setPermissions(dataPerms.permissions || []);
      }

      if (resUsers.ok) {
        const dataUsers = await resUsers.json();
        setUsers(dataUsers.users || []);
      }
    } catch (e) {
      console.error('Error cargando datos de permisos:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Aprobar (con firma Camercloud + sincronización de asistencia) o Rechazar
  const handleUpdateStatus = async (
    perm: Permission,
    newStatus: 'APPROVED' | 'REJECTED',
    isPaidPermit = true
  ) => {
    const storedUser = localStorage.getItem('user');
    const admin = storedUser ? JSON.parse(storedUser) : null;

    if (!admin?.id) {
      alert('No se detectó la sesión del administrador.');
      return;
    }

    if (
      newStatus === 'REJECTED' &&
      !confirm(`¿Confirmas rechazar la solicitud de ${perm.user.name} ${perm.user.lastName}?`)
    ) {
      return;
    }

    setProcessingId(perm.id);
    try {
      const res = await fetch('/api/v1/hr/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: perm.id,
          status: newStatus,
          adminId: admin.id,
          approvedBy: admin.name || 'RRHH Administrator',
          isPaidPermit,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        if (newStatus === 'APPROVED') {
          alert(
            `Papeleta aprobada, firmada digitalmente con Camercloud y sincronizada en Control de Asistencia (${isPaidPermit ? 'Con Goce' : 'Sin Goce'}).`
          );
        } else {
          alert('Solicitud rechazada y auditada correctamente.');
        }
        loadData();
      } else {
        alert(data.error || 'Error al procesar la solicitud.');
      }
    } catch {
      alert('Error de comunicación con el servidor.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.userId) {
      alert('Seleccione un colaborador');
      return;
    }

    try {
      const res = await fetch('/api/v1/hr/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok) {
        alert('Solicitud de permiso/papeleta registrada correctamente.');
        setShowModal(false);
        setFormData({
          userId: '',
          type: 'PERSONAL_PERMIT',
          reason: '',
          startDate: '',
          endDate: '',
        });
        loadData();
      } else {
        alert(data.error || 'Error registrando el permiso');
      }
    } catch {
      alert('Error de conexión con el servidor');
    }
  };

  const mapTypeLabel = (type: string) => {
    switch (type) {
      case 'MEDICAL_LEAVE':
        return 'Descanso Médico (ESSALUD)';
      case 'PERSONAL_PERMIT':
        return 'Papeleta de Salida Particular';
      case 'MATERNITY_PATERNITY':
        return 'Licencia Maternidad / Paternidad';
      case 'VACATION_LEAVE':
        return 'Saldo de Vacaciones';
      case 'COMMISSION':
        return 'Comisión de Servicio Externo';
      default:
        return type;
    }
  };

  const filteredPermissions = permissions.filter(
    (p) => statusFilter === 'ALL' || p.status === statusFilter
  );

  const pendingCount = permissions.filter((p) => p.status === 'PENDING').length;

  const inputClass =
    'w-full rounded-lg border border-slate-700 bg-slate-900 p-2.5 text-xs text-white placeholder:text-slate-500 focus:border-[#00BFA5] focus:outline-none';

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileCheck2 className="w-6 h-6 text-[#00BFA5]" />
            Permisos, Licencias y Papeletas Digitales
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Gestión justificada de inasistencias con firma Camercloud PAdES-B e impacto automático en Asistencia.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-[#005F87] hover:bg-[#005F87]/80 text-white text-xs font-bold px-4 py-2.5 rounded-lg shadow-md border border-[#00BFA5]/30 transition cursor-pointer"
        >
          <PlusCircle className="w-4 h-4 text-[#00BFA5]" />
          Nueva Solicitud de Permiso
        </button>
      </div>

      {/* Pestañas de Filtro por Estado */}
      <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 w-fit">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            statusFilter === 'ALL'
              ? 'bg-[#005F87] text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Todas ({permissions.length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('PENDING')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            statusFilter === 'PENDING'
              ? 'bg-amber-600 text-white'
              : 'text-amber-400 hover:bg-slate-900'
          }`}
        >
          ⏳ Pendientes ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('APPROVED')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            statusFilter === 'APPROVED'
              ? 'bg-emerald-700 text-white'
              : 'text-emerald-400 hover:bg-slate-900'
          }`}
        >
          ✓ Aprobadas ({permissions.filter((p) => p.status === 'APPROVED').length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('REJECTED')}
          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
            statusFilter === 'REJECTED'
              ? 'bg-rose-700 text-white'
              : 'text-rose-400 hover:bg-slate-900'
          }`}
        >
          ✕ Rechazadas ({permissions.filter((p) => p.status === 'REJECTED').length})
        </button>
      </div>

      {/* Grid / Lista de Solicitudes */}
      {loading ? (
        <p className="text-xs text-slate-500 text-center py-8">
          Cargando registros de permisos y licencias...
        </p>
      ) : filteredPermissions.length === 0 ? (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-500">
          No existen solicitudes en esta categoría.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredPermissions.map((p) => {
            const isBusy = processingId === p.id;
            const isUnpaid = p.reason?.toUpperCase().includes('SIN GOCE');
            return (
              <div
                key={p.id}
                className="bg-slate-950 border border-slate-800 rounded-xl p-5 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 hover:border-slate-700 transition"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {p.user ? `${p.user.name} ${p.user.lastName}` : 'Colaborador'}
                    </span>
                    <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded">
                      DNI: {p.user?.dni}
                    </span>
                    {p.status === 'APPROVED' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-teal-950/70 text-[#00BFA5] border border-[#00BFA5]/30 px-2 py-0.5 rounded">
                        <CalendarCheck className="w-3 h-3" />
                        Sincronizado en Asistencia
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#00BFA5]">
                    {mapTypeLabel(p.type)}
                  </p>
                  <p className="text-xs text-slate-400">{p.reason}</p>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 pt-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Desde: {new Date(p.startDate).toLocaleString('es-PE')} — Hasta:{' '}
                    {new Date(p.endDate).toLocaleString('es-PE')}
                  </div>
                </div>

                {/* Acciones de RRHH */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* 1. Ver firma del trabajador */}
                  {p.employeeSignature ? (
                    <button
                      onClick={() => setSelectedSignature(p.employeeSignature!)}
                      className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium px-3 py-1.5 rounded-lg transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#00BFA5]" />
                      Ver Firma
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500 italic">Sin firma previa</span>
                  )}

                  {/* 2. Descargar PDF firmado por Camercloud */}
                  {p.status === 'APPROVED' && (
                    <button
                      onClick={() => {
                        const identifier = p.signatureCode || p.id;
                        window.open(`/api/v1/hr/permissions/${identifier}/download`, '_blank');
                      }}
                      className="flex items-center gap-1.5 bg-blue-950/60 hover:bg-blue-900 border border-blue-800 text-blue-400 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5 text-blue-400" />
                      PDF Firmado
                    </button>
                  )}

                  {/* 3. Botones de Decisión para Pendientes */}
                  {p.status === 'PENDING' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {p.type === 'PERSONAL_PERMIT' ? (
                        <>
                          <button
                            disabled={isBusy}
                            onClick={() => handleUpdateStatus(p, 'APPROVED', true)}
                            className="flex items-center gap-1 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                            title="Aprobar justificando asistencia sin descuento"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {isBusy ? 'Firmando...' : 'Aprobar (Con Goce)'}
                          </button>
                          <button
                            disabled={isBusy}
                            onClick={() => handleUpdateStatus(p, 'APPROVED', false)}
                            className="flex items-center gap-1 bg-amber-950/60 hover:bg-amber-900 border border-amber-800 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                            title="Aprobar justificando salida pero sujeto a descuento en planilla"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Aprobar (Sin Goce)
                          </button>
                        </>
                      ) : (
                        <button
                          disabled={isBusy}
                          onClick={() => handleUpdateStatus(p, 'APPROVED', true)}
                          className="flex items-center gap-1 bg-emerald-950/60 hover:bg-emerald-900 border border-emerald-800 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {isBusy ? 'Firmando...' : 'Aprobar y Firmar'}
                        </button>
                      )}

                      <button
                        disabled={isBusy}
                        onClick={() => handleUpdateStatus(p, 'REJECTED')}
                        className="flex items-center gap-1 bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-400 text-xs font-bold px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Rechazar
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {p.status === 'APPROVED' && (
                        <span
                          className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                            isUnpaid
                              ? 'bg-amber-950/60 text-amber-400 border-amber-700/50'
                              : 'bg-sky-950/60 text-sky-400 border-sky-700/50'
                          }`}
                        >
                          {isUnpaid ? 'SIN GOCE DE HABER' : 'CON GOCE DE HABER'}
                        </span>
                      )}
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-bold border ${
                          p.status === 'APPROVED'
                            ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50'
                            : 'bg-rose-950/50 text-rose-400 border-rose-800/50'
                        }`}
                      >
                        {p.status === 'APPROVED' ? 'Aprobado' : 'Rechazado'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Visor de Firma Táctil */}
      {selectedSignature && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 p-6 shadow-2xl border border-slate-800 text-slate-200 space-y-4 text-center">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Signature className="w-4 h-4 text-[#00BFA5]" />
                Evidencia de Firma Digital Táctil
              </h3>
              <button
                onClick={() => setSelectedSignature(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-700 flex items-center justify-center min-h-[160px]">
              {selectedSignature.startsWith('data:image') ? (
                <img
                  src={selectedSignature}
                  alt="Firma Digital Colaborador"
                  className="max-h-40 object-contain"
                />
              ) : (
                <p className="text-xs text-slate-600 font-mono">
                  Confirmación Biométrica: {selectedSignature}
                </p>
              )}
            </div>

            <p className="text-[11px] text-slate-400 italic">
              Conforme a la normativa SUNAFIL e ISO 27001 para la no-repudiación de papeletas digitales.
            </p>

            <button
              onClick={() => setSelectedSignature(null)}
              className="w-full rounded-lg bg-slate-800 hover:bg-slate-700 py-2 text-xs font-bold text-white transition"
            >
              Cerrar Visor
            </button>
          </div>
        </div>
      )}

      {/* Modal Nueva Solicitud */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 z-50">
          <div className="w-full max-w-lg rounded-2xl bg-slate-950 p-6 shadow-2xl border border-slate-800 text-slate-200 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-[#00BFA5]" />
                Registrar Solicitud de Permiso / Papeleta
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Al aprobarse, los días comprendidos se justificarán automáticamente en el Registro de Asistencia.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Colaborador
                </label>
                <select
                  required
                  className={inputClass}
                  value={formData.userId}
                  onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
                >
                  <option value="">-- Seleccione Colaborador --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} {u.lastName} (DNI: {u.dni})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Tipo de Permiso / Licencia
                </label>
                <select
                  className={inputClass}
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="PERSONAL_PERMIT">Papeleta de Salida Particular</option>
                  <option value="MEDICAL_LEAVE">Descanso Médico (ESSALUD)</option>
                  <option value="MATERNITY_PATERNITY">Licencia Maternidad / Paternidad</option>
                  <option value="VACATION_LEAVE">Saldo de Vacaciones</option>
                  <option value="COMMISSION">Comisión de Servicio Externo</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Fecha / Hora Inicio
                  </label>
                  <input
                    type="datetime-local"
                    required
                    className={inputClass}
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-300 block mb-1">
                    Fecha / Hora Fin
                  </label>
                  <input
                    type="datetime-local"
                    required
                    className={inputClass}
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-300 block mb-1">
                  Motivo Justificado
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Ej: Cita en Essalud o trámite personal urgente."
                  className={inputClass}
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[#005F87] hover:bg-[#005F87]/80 px-4 py-2 text-xs font-bold text-white shadow-md border border-[#00BFA5]/30"
                >
                  Guardar Permiso
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}