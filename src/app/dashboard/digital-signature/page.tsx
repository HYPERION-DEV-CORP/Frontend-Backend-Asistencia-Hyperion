// src/app/dashboard/digital-signature/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  FileSignature,
  CheckCircle2,
  FileText,
  Clock,
  ClipboardCheck,
  Printer,
  X,
} from 'lucide-react';

interface Paystub {
  id: string;
  period: string;
  fileUrl: string;
  isEmployerSigned: boolean;
  isEmployeeSigned: boolean;
  createdAt: string;
  user: {
    id: string;
    name: string;
    lastName: string;
    dni: string;
  };
}

interface TareoSignOff {
  id: string;
  userId: string;
  year: number;
  month: number;
  closingSignature: string;
  signedAt: string;
  ipAddress?: string | null;
  user: {
    id: string;
    name: string;
    lastName: string;
    dni: string;
    position?: string | null;
  };
}

export default function DigitalSignaturePage() {
  const [activeTab, setActiveTab] = useState<'tareo' | 'paystubs'>('tareo');
  const [paystubs, setPaystubs] = useState<Paystub[]>([]);
  const [tareoSignOffs, setTareoSignOffs] = useState<TareoSignOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTareo, setSelectedTareo] = useState<{
    signOff: TareoSignOff;
    sheetData: any;
  } | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);

  useEffect(() => {
    fetch('/api/v1/hr/digital-signature')
      .then((res) => res.json())
      .then((data) => {
        setPaystubs(data.paystubs || []);
        setTareoSignOffs(data.tareoSignOffs || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error cargando firmas digitales:', err);
        setLoading(false);
      });
  }, []);

  const handleOpenTareoDocument = async (signOff: TareoSignOff) => {
    setLoadingDoc(true);
    try {
      const res = await fetch(
        `/api/v1/reports/attendance-sheet?userId=${signOff.userId}&year=${signOff.year}&month=${signOff.month}`
      );
      const data = await res.json();
      setSelectedTareo({ signOff, sheetData: data });
    } catch (err) {
      console.error('Error cargando detalle del tareo:', err);
    } finally {
      setLoadingDoc(false);
    }
  };

  const formatPeriod = (year: number, month: number) =>
    `${String(month).padStart(2, '0')}/${year}`;

  return (
    <div className="space-y-6">
      {/* Encabezado y Pestañas */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileSignature className="w-6 h-6 text-[#00BFA5]" />
            Firma Digital y Conformidad Laboral (SUNAFIL)
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Control de cierre mensual de asistencia (D.S. N° 004-2006-TR) y boletas de pago (Ley N° 27269).
          </p>
        </div>

        <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 self-start">
          <button
            onClick={() => setActiveTab('tareo')}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'tareo'
                ? 'bg-[#00BFA5] text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ClipboardCheck className="w-4 h-4" />
            Tareos SUNAFIL ({tareoSignOffs.length})
          </button>
          <button
            onClick={() => setActiveTab('paystubs')}
            className={`px-3.5 py-2 rounded-md text-xs font-semibold flex items-center gap-2 transition ${
              activeTab === 'paystubs'
                ? 'bg-[#00BFA5] text-slate-950 shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <FileText className="w-4 h-4" />
            Boletas de Pago ({paystubs.length})
          </button>
        </div>
      </div>

      {/* Tabla 1: Conformidades de Tareo SUNAFIL */}
      {activeTab === 'tareo' && (
        <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-5 py-3.5">Trabajador</th>
                <th className="px-5 py-3.5">Periodo Tareo</th>
                <th className="px-5 py-3.5">Fecha de Cierre</th>
                <th className="px-5 py-3.5">Firma de Conformidad</th>
                <th className="px-5 py-3.5 text-right">Documento SUNAFIL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500">
                    Cargando registros de tareo firmados...
                  </td>
                </tr>
              ) : tareoSignOffs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500">
                    Aún no hay cierres de tareo firmados por los trabajadores en el periodo actual.
                  </td>
                </tr>
              ) : (
                tareoSignOffs.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-900/50 transition">
                    <td className="px-5 py-3.5 font-semibold text-white">
                      {t.user ? `${t.user.name} ${t.user.lastName}` : 'Trabajador'}
                      <div className="text-[10px] text-slate-500">
                        DNI: {t.user?.dni} {t.user?.position ? `• ${t.user.position}` : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-[#00BFA5] font-bold">
                      {formatPeriod(t.year, t.month)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-400">
                      {new Date(t.signedAt).toLocaleString('es-PE', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-bold bg-emerald-950/50 px-2.5 py-1 rounded border border-emerald-800/50 text-[10px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Firmado en App
                        </span>
                        {t.closingSignature && (
                          <img
                            src={
                              t.closingSignature.startsWith('data:')
                                ? t.closingSignature
                                : `data:image/png;base64,${t.closingSignature}`
                            }
                            alt="Firma trabajador"
                            className="h-8 bg-white rounded px-1.5 py-0.5 border border-slate-700 object-contain"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleOpenTareoDocument(t)}
                        disabled={loadingDoc}
                        className="text-[#00BFA5] hover:text-emerald-300 font-bold underline inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {loadingDoc ? 'Abriendo...' : 'Ver Registro SUNAFIL'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tabla 2: Boletas de Pago */}
      {activeTab === 'paystubs' && (
        <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-900/80 text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
              <tr>
                <th className="px-5 py-3.5">Trabajador</th>
                <th className="px-5 py-3.5">Periodo</th>
                <th className="px-5 py-3.5">Firma Empleador</th>
                <th className="px-5 py-3.5">Conformidad Trabajador</th>
                <th className="px-5 py-3.5 text-right">Documento</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500">
                    Cargando boletas de pago...
                  </td>
                </tr>
              ) : paystubs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500">
                    No hay boletas de pago registradas en el periodo actual.
                  </td>
                </tr>
              ) : (
                paystubs.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-900/50 transition">
                    <td className="px-5 py-3.5 font-semibold text-white">
                      {p.user ? `${p.user.name} ${p.user.lastName}` : 'Trabajador'}
                      <div className="text-[10px] text-slate-500">DNI: {p.user?.dni}</div>
                    </td>
                    <td className="px-5 py-3.5 font-mono">{p.period}</td>
                    <td className="px-5 py-3.5">
                      {p.isEmployerSigned ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-bold bg-emerald-950/50 px-2.5 py-1 rounded border border-emerald-800/50 text-[10px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Firmado Digitalmente
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400 font-bold bg-amber-950/50 px-2.5 py-1 rounded border border-amber-800/50 text-[10px]">
                          <Clock className="w-3.5 h-3.5" /> Pendiente Firma
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {p.isEmployeeSigned ? (
                        <span className="inline-flex items-center gap-1 text-[#00BFA5] font-bold bg-slate-900 px-2.5 py-1 rounded border border-[#00BFA5]/30 text-[10px]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Recepcionado en App
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-400 font-bold bg-slate-900 px-2.5 py-1 rounded border border-slate-800 text-[10px]">
                          <Clock className="w-3.5 h-3.5" /> Sin Recepcionar
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <a
                        href={p.fileUrl || '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="text-slate-300 hover:text-[#00BFA5] font-bold underline inline-flex items-center gap-1"
                      >
                        <FileText className="w-3.5 h-3.5" /> PDF Boleta
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Visualización e Impresión del Registro SUNAFIL Firmado */}
      {selectedTareo && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-xl max-w-4xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b pb-3 print:hidden">
              <h2 className="font-bold text-base text-slate-800">
                Registro de Control de Asistencia SUNAFIL (D.S. N° 004-2006-TR)
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-800"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir / Guardar PDF
                </button>
                <button
                  onClick={() => setSelectedTareo(null)}
                  className="p-1.5 text-slate-500 hover:text-slate-900"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="text-xs space-y-1 border p-3 rounded bg-slate-50">
              <div className="font-bold text-sm">
                TRABAJADOR: {selectedTareo.signOff.user.name} {selectedTareo.signOff.user.lastName}
              </div>
              <div>
                DNI: <strong>{selectedTareo.signOff.user.dni}</strong> | PERIODO:{' '}
                <strong>
                  {formatPeriod(selectedTareo.signOff.year, selectedTareo.signOff.month)}
                </strong>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto border rounded">
              <table className="w-full text-[11px] text-left border-collapse">
                <thead className="bg-slate-100 border-b">
                  <tr>
                    <th className="p-2 border-r">Fecha</th>
                    <th className="p-2 border-r">Ingreso</th>
                    <th className="p-2 border-r">Salida Ref.</th>
                    <th className="p-2 border-r">Retorno Ref.</th>
                    <th className="p-2 border-r">Salida</th>
                    <th className="p-2 border-r">Firma Diaria</th>
                    <th className="p-2">Observación / Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(selectedTareo.sheetData?.days || selectedTareo.sheetData?.records || []).map(
                    (row: any, idx: number) => (
                      <tr key={idx}>
                        <td className="p-2 border-r font-mono">{row.date || row.dayLabel}</td>
                        <td className="p-2 border-r">{row.checkIn || '-'}</td>
                        <td className="p-2 border-r">{row.lunchOut || '-'}</td>
                        <td className="p-2 border-r">{row.lunchIn || '-'}</td>
                        <td className="p-2 border-r">{row.checkOut || '-'}</td>
                        <td className="p-2 border-r">
                          {row.signatureBase64 ? (
                            <img
                              src={
                                row.signatureBase64.startsWith('data:')
                                  ? row.signatureBase64
                                  : `data:image/png;base64,${row.signatureBase64}`
                              }
                              alt="Firma"
                              className="h-6 object-contain"
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="p-2">{row.observation || row.status || ''}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-end pt-4 border-t">
              <div className="text-[11px] text-slate-600">
                <div>Documento conformado digitalmente por el trabajador.</div>
                <div>
                  Fecha y hora de firma:{' '}
                  <strong>
                    {new Date(selectedTareo.signOff.signedAt).toLocaleString('es-PE')}
                  </strong>
                </div>
              </div>
              <div className="text-center border-t border-slate-400 pt-2 px-6">
                <img
                  src={
                    selectedTareo.signOff.closingSignature.startsWith('data:')
                      ? selectedTareo.signOff.closingSignature
                      : `data:image/png;base64,${selectedTareo.signOff.closingSignature}`
                  }
                  alt="Firma de conformidad"
                  className="h-14 mx-auto mb-1 object-contain"
                />
                <div className="text-[11px] font-bold">FIRMA DE CONFORMIDAD DEL TRABAJADOR</div>
                <div className="text-[10px] text-slate-500">
                  DNI: {selectedTareo.signOff.user.dni}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}