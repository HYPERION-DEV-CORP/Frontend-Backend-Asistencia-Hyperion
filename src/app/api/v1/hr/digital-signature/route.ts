// src/app/api/v1/hr/digital-signature/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const db = prisma as any;

    const paystubDelegate =
      db.paystub || db.digitalPaystub || db.payrollRecord || db.payStub;

    const [paystubs, tareoSignOffs] = await Promise.all([
      paystubDelegate
        ? paystubDelegate.findMany({
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  lastName: true,
                  dni: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      prisma.monthlyAttendanceSignOff.findMany({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              lastName: true,
              dni: true,
              role: true,
            },
          },
        },
        orderBy: { signedAt: 'desc' },
      }),
    ]);

    return NextResponse.json({
      success: true,
      paystubs,
      tareoSignOffs,
    });
  } catch (error: any) {
    console.error('Error cargando firmas digitales:', error);
    return NextResponse.json(
      { error: error.message || 'Error al obtener documentos firmados' },
      { status: 500 }
    );
  }
}