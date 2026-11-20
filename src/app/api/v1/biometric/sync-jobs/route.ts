import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const API_KEY = process.env.BIOMETRIC_API_KEY || 'HYPERION_BIOMETRIC_KEY_2026';

function formatJobForClient(job: any) {
  if (!job) return null;

  let startMonth: string | null = null;
  let endMonth: string | null = null;

  if (job.type === 'SINGLE_MONTH' && job.year && job.month) {
    startMonth = `${job.year}-${String(job.month).padStart(2, '0')}`;
  } else if (job.type === 'RANGE' && job.month && job.year) {
    const sStr = String(job.month);
    const eStr = String(job.year);
    if (sStr.length === 6) startMonth = `${sStr.slice(0, 4)}-${sStr.slice(4, 6)}`;
    if (eStr.length === 6) endMonth = `${eStr.slice(0, 4)}-${eStr.slice(4, 6)}`;
  }

  return {
    ...job,
    filterType: job.type,
    startMonth,
    endMonth,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode');

  if (mode === 'agent') {
    const key = req.headers.get('x-api-key') || searchParams.get('api_key');
    if (key !== API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pendingJob = await prisma.biometricSyncJob.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ pendingJob: formatJobForClient(pendingJob) });
  }

  const recentJobs = await prisma.biometricSyncJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return NextResponse.json({
    recentJobs: recentJobs.map(formatJobForClient),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'REPORT') {
    const key = req.headers.get('x-api-key');
    if (key !== API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (body.jobId) {
      await prisma.biometricSyncJob.update({
        where: { id: body.jobId },
        data: {
          status: body.status || 'COMPLETED',
          recordsSent: body.recordsSent ?? 0,
          processedNew: body.processedNew ?? 0,
          errorMessage: body.errorMessage || null,
          completedAt: new Date(),
        },
      });
    } else {
      await prisma.biometricSyncJob.create({
        data: {
          type: 'AUTO',
          status: body.status || 'COMPLETED',
          recordsSent: body.recordsSent ?? 0,
          processedNew: body.processedNew ?? 0,
          errorMessage: body.errorMessage || null,
          completedAt: new Date(),
        },
      });
    }

    return NextResponse.json({ ok: true });
  }

  // Crear orden desde el modal web usando las columnas (type, month, year)
  const filterType = body.filterType || 'SINGLE_MONTH';
  let monthVal: number | null = null;
  let yearVal: number | null = null;

  if (filterType === 'SINGLE_MONTH' && body.startMonth?.includes('-')) {
    const [y, m] = body.startMonth.split('-').map(Number);
    yearVal = y;
    monthVal = m;
  } else if (filterType === 'RANGE' && body.startMonth?.includes('-') && body.endMonth?.includes('-')) {
    monthVal = Number(body.startMonth.replace('-', '')); // ej. 202610
    yearVal = Number(body.endMonth.replace('-', ''));    // ej. 202611
  }

  const job = await prisma.biometricSyncJob.create({
    data: {
      type: filterType,
      month: monthVal,
      year: yearVal,
      status: 'PENDING',
      requestedBy: body.adminId || 'Administrador',
    },
  });

  return NextResponse.json({ job: formatJobForClient(job) });
}