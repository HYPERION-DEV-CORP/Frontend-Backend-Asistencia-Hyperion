-- CreateEnum (seguro si ya existe)
DO $$ BEGIN
    CREATE TYPE "SubscriptionPlan" AS ENUM ('TRIAL', 'BASIC', 'PRO', 'ENTERPRISE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable AttendanceRecord
ALTER TABLE "AttendanceRecord"
    ADD COLUMN IF NOT EXISTS "tareoObservation" TEXT,
    ALTER COLUMN "latitude" SET DEFAULT -14.078775,
    ALTER COLUMN "longitude" SET DEFAULT -75.751176;

-- AlterTable Company (con DEFAULT CURRENT_TIMESTAMP en updatedAt para evitar error si hay filas)
ALTER TABLE "Company"
    ADD COLUMN IF NOT EXISTS "enabledModules" TEXT[] DEFAULT ARRAY['ATTENDANCE_QR', 'AUTO_ABSENCE_CRON', 'PLAME_EXPORT', 'AUDIT_FORENSIC']::TEXT[],
    ADD COLUMN IF NOT EXISTS "lunchDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    ADD COLUMN IF NOT EXISTS "lunchDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS "lunchWindowEnd" TEXT NOT NULL DEFAULT '13:30',
    ADD COLUMN IF NOT EXISTS "lunchWindowStart" TEXT NOT NULL DEFAULT '13:00',
    ADD COLUMN IF NOT EXISTS "planType" "SubscriptionPlan" NOT NULL DEFAULT 'TRIAL',
    ADD COLUMN IF NOT EXISTS "saturdayWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    ADD COLUMN IF NOT EXISTS "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "trialStartsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable User
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "biometricCode" TEXT,
    ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "isSubjectToSupervision" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "pensionRate" DOUBLE PRECISION NOT NULL DEFAULT 13.0,
    ADD COLUMN IF NOT EXISTS "pensionSystem" TEXT NOT NULL DEFAULT 'AFP',
    ADD COLUMN IF NOT EXISTS "resetToken" TEXT,
    ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "signatureBase64" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MonthlyAttendanceSignOff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "closingSignature" TEXT,
    "signedAt" TIMESTAMP(3),
    "hrSignature" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MonthlyAttendanceSignOff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BiometricSyncJob" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'AUTO',
    "month" INTEGER,
    "year" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "recordsSent" INTEGER NOT NULL DEFAULT 0,
    "processedNew" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BiometricSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UnmatchedBiometricLog" (
    "id" TEXT NOT NULL,
    "rawCode" TEXT NOT NULL,
    "punchTime" TIMESTAMP(3) NOT NULL,
    "type" "AttendanceType" NOT NULL DEFAULT 'BIOMETRIC_FINGERPRINT',
    "serialNo" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnmatchedBiometricLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MonthlyAttendanceSignOff_userId_year_month_key" ON "MonthlyAttendanceSignOff"("userId", "year", "month");
CREATE INDEX IF NOT EXISTS "UnmatchedBiometricLog_rawCode_resolved_idx" ON "UnmatchedBiometricLog"("rawCode", "resolved");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceRecord_userId_date_key" ON "AttendanceRecord"("userId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "User_biometricCode_key" ON "User"("biometricCode");
CREATE UNIQUE INDEX IF NOT EXISTS "User_resetToken_key" ON "User"("resetToken");

-- AddForeignKey (seguro si ya existe)
DO $$ BEGIN
    ALTER TABLE "MonthlyAttendanceSignOff"
        ADD CONSTRAINT "MonthlyAttendanceSignOff_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;