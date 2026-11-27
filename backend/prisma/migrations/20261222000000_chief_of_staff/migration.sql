-- AlterEnum
ALTER TYPE "BriefingKind" ADD VALUE 'BOARD';

-- CreateEnum
CREATE TYPE "LifeEventKind" AS ENUM ('FAMILY_VACATION', 'COLLEGE_VISIT', 'MISSION_TRIP', 'INTERNATIONAL', 'BUSINESS_TRAVEL', 'MAJOR_PURCHASE', 'MOVING', 'HOME_PROJECT', 'OTHER');

-- CreateEnum
CREATE TYPE "LifeEventStatus" AS ENUM ('PLANNING', 'BOOKED', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN "chiefOfStaff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN "quietMode" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "deferredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_userId_deferredAt_idx" ON "Notification"("userId", "deferredAt");

-- CreateTable
CREATE TABLE "LifeEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "LifeEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "destination" TEXT,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "travelers" INTEGER NOT NULL DEFAULT 1,
    "budgetCents" INTEGER,
    "status" "LifeEventStatus" NOT NULL DEFAULT 'PLANNING',
    "estimate" JSONB,
    "estimatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LifeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LifeEvent_userId_status_idx" ON "LifeEvent"("userId", "status");

-- AddForeignKey
ALTER TABLE "LifeEvent" ADD CONSTRAINT "LifeEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
