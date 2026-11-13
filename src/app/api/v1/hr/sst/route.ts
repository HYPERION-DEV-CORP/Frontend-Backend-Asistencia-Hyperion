import { NextResponse } from 'next/server';
import { getSstWorkloadAlerts } from '@/lib/sst-monitor';

export async function GET() {
  try {
    const report = await getSstWorkloadAlerts();

    const summary = {
      totalWorkers: report.length,
      highRiskCount: report.filter((r) => r.riskLevel === 'ALTO').length,
      mediumRiskCount: report.filter((r) => r.riskLevel === 'MEDIO').length,
      compliantCount: report.filter((r) => r.riskLevel === 'NORMAL').length,
    };

    return NextResponse.json({
      success: true,
      summary,
      workers: report,
    });
  } catch (error: any) {
    console.error('❌ Error en monitoreo SST:', error);
    return NextResponse.json(
      { error: 'Error al calcular indicadores de Seguridad y Salud en el Trabajo.' },
      { status: 500 }
    );
  }
}