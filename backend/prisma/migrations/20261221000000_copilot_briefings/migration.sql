-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'COPILOT';

-- CreateEnum
CREATE TYPE "BriefingKind" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN "briefingDaily" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "briefingWeekly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "briefingMonthly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "copilotAlerts" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CopilotBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "BriefingKind" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "narration" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopilotBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopilotBriefing_userId_createdAt_idx" ON "CopilotBriefing"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotBriefing_userId_kind_periodKey_key" ON "CopilotBriefing"("userId", "kind", "periodKey");

-- AddForeignKey
ALTER TABLE "CopilotBriefing" ADD CONSTRAINT "CopilotBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
