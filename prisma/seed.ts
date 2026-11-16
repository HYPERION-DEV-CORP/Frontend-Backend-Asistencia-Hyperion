// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando población inicial de Hyperion Digital Security...');

  // 1. Crear Empresa con prueba gratuita de 7 días y todos los módulos activos
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const company = await prisma.company.upsert({
    where: { ruc: '20608810987' },
    update: {},
    create: {
      name: 'Hyperion Digital Security S.A.C.',
      ruc: '20608810987',
      officeLat: -14.078775,
      officeLng: -75.751176,
      radiusM: 50.0,
      planType: 'TRIAL',
      subscriptionStatus: 'ACTIVE',
      trialStartsAt: now,
      trialEndsAt: sevenDaysLater,
      enabledModules: [
        'ATTENDANCE_QR',
        'BIOMETRIC_SYNC',
        'AUTO_ABSENCE_CRON',
        'DIGITAL_SIGNATURE',
        'PLAME_EXPORT',
        'AUDIT_FORENSIC',
      ],
    },
  });

  // 2. Crear Régimen Laboral General 728 por defecto
  const policy728 = await prisma.payrollPolicy.create({
    data: {
      name: 'Régimen General 728',
      daysInMonth: 30,
      hoursPerDay: 8.0,
      overtimeFirst2HoursRate: 1.25,
      overtimeNextHoursRate: 1.35,
      companyId: company.id,
    },
  });

  // 3. Crear Usuario Administrador Principal (vinculado al biométrico EnNo 00000004)
  const passwordHash = await bcrypt.hash('Admin2026*', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@hyperion.pe' },
    update: {},
    create: {
      dni: '70000001',
      docType: 'DNI',
      biometricCode: '00000004',
      name: 'Miguel Martin',
      lastName: 'Conde Garcia',
      email: 'admin@hyperion.pe',
      passwordHash,
      role: 'ADMIN',
      jobTitle: 'Gerencia / Admin',
      isActive: true,
      workStartTime: '09:00',
      toleranceMinutes: 10,
      baseSalary: 2500.0,
      companyId: company.id,
      payrollPolicyId: policy728.id,
    },
  });

  console.log('✅ Base de datos lista.');
  console.log('-------------------------------------------');
  console.log('📧 Correo:     admin@hyperion.pe');
  console.log('🔑 Contraseña: Admin2026*');
  console.log('-------------------------------------------');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });