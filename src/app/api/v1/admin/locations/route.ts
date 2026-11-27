// src/app/api/v1/admin/locations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    let locations = await prisma.authorizedLocation.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'asc' },
    });

    // Migración automática: si no hay sedes aún, registra la sede principal de Company
    if (locations.length === 0) {
      const defaultLoc = await prisma.authorizedLocation.create({
        data: {
          companyId: company.id,
          name: 'Sede Principal',
          address: 'Instalaciones Centrales',
          latitude: company.officeLat,
          longitude: company.officeLng,
          radiusM: company.radiusM || 50,
          isActive: true,
        },
      });
      locations = [defaultLoc];
    }

    return NextResponse.json({ success: true, locations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, address, latitude, longitude, radiusM, isActive } = body;

    const company = await prisma.company.findFirst();
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    const lat = Number(latitude);
    const lng = Number(longitude);
    const radius = Number(radiusM) || 50;

    if (!name?.trim() || isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: 'Nombre, latitud y longitud son obligatorios.' },
        { status: 400 }
      );
    }

    const location = await prisma.authorizedLocation.create({
      data: {
        companyId: company.id,
        name: name.trim(),
        address: address?.trim() || null,
        latitude: lat,
        longitude: lng,
        radiusM: Math.max(10, Math.min(2000, radius)),
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({ success: true, location }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, name, address, latitude, longitude, radiusM, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID de sede requerido' }, { status: 400 });
    }

    const updated = await prisma.authorizedLocation.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(address !== undefined ? { address: address?.trim() || null } : {}),
        ...(latitude !== undefined ? { latitude: Number(latitude) } : {}),
        ...(longitude !== undefined ? { longitude: Number(longitude) } : {}),
        ...(radiusM !== undefined ? { radiusM: Math.max(10, Math.min(2000, Number(radiusM))) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    });

    return NextResponse.json({ success: true, location: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID de sede requerido' }, { status: 400 });
    }

    await prisma.authorizedLocation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}