import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, startDate, endDate, companyId } = body;

    if (!name || !startDate || !endDate) {
      return NextResponse.json(
        { error: "Nombre, fecha de inicio y fecha de fin son obligatorios." },
        { status: 400 }
      );
    }

    // 1. Obtener companyId (del body o la primera empresa registrada)
    let targetCompanyId = companyId;
    if (!targetCompanyId) {
      const defaultCompany = await prisma.company.findFirst();
      if (!defaultCompany) {
        return NextResponse.json(
          { error: "No se encontró ninguna empresa registrada." },
          { status: 404 }
        );
      }
      targetCompanyId = defaultCompany.id;
    }

    // 2. Crear el periodo vinculado a la empresa
    const period = await prisma.payrollPeriod.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: "OPEN",
        companyId: targetCompanyId, // 👈 Se asigna la relación obligatoria
      },
    });

    return NextResponse.json({ success: true, period });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, status, closedById } = await req.json();

    if (!id || !status) {
      return NextResponse.json(
        { error: "El ID del periodo y el nuevo estado son requeridos." },
        { status: 400 }
      );
    }

    const period = await prisma.payrollPeriod.update({
      where: { id },
      data: {
        status,
        ...(status === "CLOSED" ? { closedAt: new Date(), closedById: closedById || null } : {}),
      },
    });

    return NextResponse.json({ success: true, period });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

// En src/app/api/v1/hr/payroll/periods/route.ts
export async function GET() {
  try {
    const periods = await prisma.payrollPeriod.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        closedBy: {
          select: { name: true, lastName: true },
        },
      },
    });

    return NextResponse.json({ success: true, periods });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}