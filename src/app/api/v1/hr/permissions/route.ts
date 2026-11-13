// src/app/api/v1/hr/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generatePermissionPdfBase64 } from '../../../../../lib/pdf-generator';
import { CamercloudService } from '@/lib/camercloud';
import { assertPeriodIsOpen } from '@/lib/payroll-period';
import { AttendanceStatus, AttendanceType } from '@prisma/client';
// Helper para generar el rango de fechas (YYYY-MM-DD UTC) entre startDate y endDate
function getDatesInRange(start: Date, end: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (current <= last) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// 1. OBTENER TODAS LAS SOLICITUDES
export async function GET() {
  try {
    const permissions = await prisma.permissionRequest.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            lastName: true,
            dni: true,
            jobTitle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, permissions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 2. CREAR SOLICITUD Y REGISTRAR FIRMA DIGITAL (APP MÓVIL / WEB)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, type, reason, startDate, endDate, signatureBase64 } = body;

    if (!userId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'Faltan campos obligatorios (userId, startDate, endDate).' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
    }

    const parsedStart = new Date(startDate);
    const parsedEnd = new Date(endDate);

    // Verificar que las fechas no caigan en un periodo de planilla ya cerrado
    await assertPeriodIsOpen(parsedStart, user.companyId);
    await assertPeriodIsOpen(parsedEnd, user.companyId);

    const newPermission = await prisma.permissionRequest.create({
      data: {
        userId,
        type,
        reason,
        startDate: parsedStart,
        endDate: parsedEnd,
        status: 'PENDING',
        employeeSignature: signatureBase64 || null,
      },
      include: {
        user: { select: { id: true, name: true, lastName: true, dni: true } },
      },
    });

    // Auditoría ISO 27001 / SUNAFIL
    if (signatureBase64) {
      const isBiometric = signatureBase64 === 'BIOMETRIC_FINGERPRINT_VERIFIED';

      await prisma.auditLog.create({
        data: {
          performedById: userId,
          entity: 'PERMISSION_REQUEST',
          entityId: newPermission.id,
          action: isBiometric ? 'BIOMETRIC_FINGERPRINT_SIGNATURE' : 'EMPLOYEE_DIGITAL_SIGNATURE',
          newValue: signatureBase64,
          reason: isBiometric
            ? 'Solicitud autorizada y firmada mediante Huella Dactilar (Sensor Móvil)'
            : 'Solicitud adjunta con firma digital táctil',
        },
      });
    }

    return NextResponse.json({ success: true, permission: newPermission });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: error.message?.includes('cerrado') ? 409 : 500 }
    );
  }
}

// 3. APROBAR O RECHAZAR SOLICITUD + FIRMA CAMERCLOUD + IMPACTO EN ASISTENCIA
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { requestId, status, adminId, approvedBy, isPaidPermit = true } = body;

    if (!requestId || !status) {
      return NextResponse.json(
        { error: 'requestId y status son requeridos.' },
        { status: 400 }
      );
    }

    const permission = await prisma.permissionRequest.findUnique({
      where: { id: requestId },
      include: { user: { include: { company: true } } },
    });

    if (!permission) {
      return NextResponse.json({ error: 'Solicitud de permiso no encontrada.' }, { status: 404 });
    }

    // 1. Verificar que el período de planilla esté abierto antes de resolver
    await assertPeriodIsOpen(permission.startDate, permission.user.companyId);
    await assertPeriodIsOpen(permission.endDate, permission.user.companyId);

    let signedPdfBase64Result: string | null = null;
    let signatureCodeResult: string | null = null;

    // 2. Si la acción es APROBAR, generar PDF y firmar con Camercloud (PAdES-B)
    if (status === 'APPROVED') {
      const pdfBase64 = await generatePermissionPdfBase64({
        id: permission.id,
        userName: `${permission.user.name} ${permission.user.lastName}`,
        userDni: permission.user.dni,
        type: permission.type,
        reason: `${permission.reason} (${isPaidPermit ? 'CON GOCE DE HABER' : 'SIN GOCE DE HABER'})`,
        startDate: permission.startDate.toISOString(),
        endDate: permission.endDate.toISOString(),
        employeeSignatureBase64: permission.employeeSignature,
      });

      const { signedPdfBase64, signatureCode } = await CamercloudService.signPdfDocument(
        pdfBase64,
        `Papeleta_${permission.user.dni}_${permission.id}.pdf`
      );

      signedPdfBase64Result = `data:application/pdf;base64,${signedPdfBase64}`;
      signatureCodeResult = signatureCode;
    }

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] || '127.0.0.1';
    const performerId = adminId || permission.userId;

    // 3. Ejecutar actualización, impacto en AttendanceRecord y AuditLog en transacción
    const updatedPermission = await prisma.$transaction(async (tx) => {
      const updated = await tx.permissionRequest.update({
        where: { id: requestId },
        data: {
          status,
          approvedBy: approvedBy || adminId || 'RRHH Administrator',
          ...(signedPdfBase64Result && { signedPdfBase64: signedPdfBase64Result }),
          ...(signatureCodeResult && { signatureCode: signatureCodeResult }),
        },
        include: {
          user: { select: { id: true, name: true, lastName: true, dni: true } },
        },
      });

      // Si fue APROBADO, impactar automáticamente los días en AttendanceRecord
      if (status === 'APPROVED') {
        const affectedDates = getDatesInRange(permission.startDate, permission.endDate);
        const goceTag = isPaidPermit ? 'CON GOCE' : 'SIN GOCE';
        const obsNote = `Papeleta Aprobada [${permission.type} - ${goceTag}]: ${permission.reason}`;

        for (const dayDate of affectedDates) {
          const existingRecord = await tx.attendanceRecord.findFirst({
            where: {
              userId: permission.userId,
              date: dayDate,
            },
          });

          if (existingRecord) {
            // Actualizar registro existente eliminando tardanza y justificando el día
            await tx.attendanceRecord.update({
              where: { id: existingRecord.id },
              data: {
                status: AttendanceStatus.PRESENT, // 👈 Usa el valor válido de tu enum (ej. PRESENT o EXCUSED/ON_LEAVE)
                lateMinutes: 0,
                isModifiedByHR: true,
                hrModificationReason: obsNote,
                observations: existingRecord.observations
                  ? `${existingRecord.observations} | ${obsNote}`
                  : obsNote,
              },
            });
          } else {
            // Crear registro de asistencia justificada para evitar falsa falta en planilla
            await tx.attendanceRecord.create({
              data: {
                userId: permission.userId,
                date: dayDate,
                type: AttendanceType.PRESENTIAL_QR, // 👈 Valor válido confirmado en tu enum
                status: AttendanceStatus.PRESENT,   // 👈 Evita que marque falta en planilla
                lateMinutes: 0,
                isModifiedByHR: true,
                hrModificationReason: obsNote,
                latitude: permission.user.company?.officeLat || 0,
                longitude: permission.user.company?.officeLng || 0,
                observations: obsNote,
              },
            });
          }
        }
      }

      // Registro inmutable en AuditLog con el ID real del administrador
      await tx.auditLog.create({
        data: {
          performedById: performerId,
          entity: 'PERMISSION_REQUEST',
          entityId: requestId,
          action: `PERMISSION_${status}`,
          newValue: signatureCodeResult || status,
          reason:
            status === 'APPROVED'
              ? `Permiso APROBADO (${isPaidPermit ? 'Con Goce' : 'Sin Goce'}), firmado con Camercloud PAdES-B y sincronizado en Control de Asistencia.`
              : `Solicitud de permiso RECHAZADA por Gerencia/RRHH.`,
          ipAddress,
        },
      });

      return updated;
    });

    return NextResponse.json({
      success: true,
      permission: updatedPermission,
      signatureCode: signatureCodeResult,
    });
  } catch (error: any) {
    console.error('Error al actualizar y firmar permiso:', error);
    return NextResponse.json(
      { error: error.message },
      { status: error.message?.includes('cerrado') ? 409 : 500 }
    );
  }
}