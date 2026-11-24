/*
  Warnings:

  - A unique constraint covering the columns `[userId,date]` on the table `AttendanceRecord` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[biometricCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[resetToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Company` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('TRIAL', 'BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "tareoObservation" TEXT,
ALTER COLUMN "latitude" SET DEFAULT -14.078775,
ALTER COLUMN "longitude" SET DEFAULT -75.751176;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "enabledModules" TEXT[] DEFAULT ARRAY['ATTENDANCE_QR', 'AUTO_ABSENCE_CRON', 'PLAME_EXPORT', 'AUDIT_FORENSIC']::TEXT[],
ADD COLUMN     "lunchDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "lunchDurationMinutes" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "lunchWindowEnd" TEXT NOT NULL DEFAULT '13:30',
ADD COLUMN     "lunchWindowStart" TEXT NOT NULL DEFAULT '13:00',
ADD COLUMN     "planType" "SubscriptionPlan" NOT NULL DEFAULT 'TRIAL',
ADD COLUMN     "saturdayWorkHours" DOUBLE PRECISION NOT NULL DEFAULT 4.5,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "biometricCode" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isSubjectToSupervision" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pensionRate" DOUBLE PRECISION NOT NULL DEFAULT 13.0,
ADD COLUMN     "pensionSystem" TEXT NOT NULL DEFAULT 'AFP',
ADD COLUMN     "resetToken" TEXT,
ADD COLUMN     "resetTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "signatureBase64" TEXT;

-- CreateTable
CREATE TABLE "MonthlyAttendanceSignOff" (
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

-- CreateTable
CREATE TABLE "BiometricSyncJob" (
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

-- CreateTable
CREATE TABLE "UnmatchedBiometricLog" (
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
CREATE UNIQUE INDEX "MonthlyAttendanceSignOff_userId_year_month_key" ON "MonthlyAttendanceSignOff"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "UnmatchedBiometricLog_rawCode_resolved_idx" ON "UnmatchedBiometricLog"("rawCode", "resolved");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_date_key" ON "AttendanceRecord"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "User_biometricCode_key" ON "User"("biometricCode");

-- CreateIndex
CREATE UNIQUE INDEX "User_resetToken_key" ON "User"("resetToken");

-- AddForeignKey
ALTER TABLE "MonthlyAttendanceSignOff" ADD CONSTRAINT "MonthlyAttendanceSignOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
