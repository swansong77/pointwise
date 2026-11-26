-- CreateEnum
CREATE TYPE "OfferConnectorKind" AS ENUM ('MOCK', 'EXTENSION', 'EMAIL', 'MANUAL', 'ISSUER_LOGIN');

-- CreateEnum
CREATE TYPE "OfferMfaMethod" AS ENUM ('NONE', 'SMS', 'APP', 'AUTHENTICATOR', 'PASSKEY');

-- CreateEnum
CREATE TYPE "OfferSyncHealth" AS ENUM ('HEALTHY', 'DEGRADED', 'NEEDS_MFA', 'NEEDS_LOGIN', 'ERROR', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "OfferSyncCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL');

-- CreateEnum
CREATE TYPE "OfferItemStatus" AS ENUM ('AVAILABLE', 'ENROLLED', 'REDEEMED', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "OfferDecisionState" AS ENUM ('NEW', 'RECOMMENDED', 'PENDING_REVIEW', 'IGNORED', 'APPROVED', 'ENROLLED', 'AUTO_ENROLLED', 'FAILED');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('ALWAYS', 'NEVER');

-- CreateEnum
CREATE TYPE "RuleMatcher" AS ENUM ('MERCHANT', 'CATEGORY', 'MIN_VALUE', 'OFFER_TYPE', 'KEYWORD', 'SPEND_HISTORY');

-- CreateEnum
CREATE TYPE "EnrollmentMode" AS ENUM ('RECOMMEND', 'BULK_APPROVAL', 'AUTO');

-- CreateEnum
CREATE TYPE "EnrollResult" AS ENUM ('SUCCESS', 'FAILURE', 'ALREADY_ADDED', 'SESSION_TIMEOUT', 'MFA_FAILURE', 'PARTIAL');

-- CreateEnum
CREATE TYPE "OfferSyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'RETRY', 'EXTENSION');

-- CreateEnum
CREATE TYPE "OfferSyncStatus" AS ENUM ('QUEUED', 'RUNNING', 'NEEDS_MFA', 'SUCCESS', 'PARTIAL', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'OFFER_NEW_HIGH_VALUE';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_AUTO_ENROLLED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_ENROLL_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_SYNC_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'OFFER_SAVINGS_DIGEST';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfferSource" ADD VALUE 'EXTENSION';
ALTER TYPE "OfferSource" ADD VALUE 'CONNECTOR';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivationVerifier" ADD VALUE 'CONNECTOR';
ALTER TYPE "ActivationVerifier" ADD VALUE 'EXTENSION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfferEventType" ADD VALUE 'DISCOVERED';
ALTER TYPE "OfferEventType" ADD VALUE 'REMOVED';
ALTER TYPE "OfferEventType" ADD VALUE 'DECISION';
ALTER TYPE "OfferEventType" ADD VALUE 'ENROLL_ATTEMPT';
ALTER TYPE "OfferEventType" ADD VALUE 'AUTO_ENROLLED';
ALTER TYPE "OfferEventType" ADD VALUE 'SYNC';
ALTER TYPE "OfferEventType" ADD VALUE 'RULE_CHANGED';

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "offerAutomation" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "OfferAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT,
    "issuerId" TEXT NOT NULL,
    "holderLabel" TEXT NOT NULL,
    "connectorKind" "OfferConnectorKind" NOT NULL DEFAULT 'MANUAL',
    "credentialEnc" TEXT,
    "credentialRef" TEXT,
    "mfaMethod" "OfferMfaMethod" NOT NULL DEFAULT 'NONE',
    "deviceTrustEnc" TEXT,
    "sessionEnc" TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "syncHealth" "OfferSyncHealth" NOT NULL DEFAULT 'DISABLED',
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "automationOptIn" BOOLEAN NOT NULL DEFAULT false,
    "optInAckAt" TIMESTAMP(3),
    "cadence" "OfferSyncCadence" NOT NULL DEFAULT 'DAILY',
    "syncHour" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferAccountCard" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletCardId" TEXT NOT NULL,

    CONSTRAINT "OfferAccountCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "runId" TEXT,
    "source" "OfferSource" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,

    CONSTRAINT "OfferSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferSnapshotItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL DEFAULT '',
    "walletCardId" TEXT,
    "externalId" TEXT NOT NULL,
    "merchantText" TEXT NOT NULL,
    "merchantId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "offerType" "OfferType" NOT NULL DEFAULT 'STATEMENT_CREDIT',
    "valueCents" INTEGER NOT NULL DEFAULT 0,
    "percent" DECIMAL(5,2),
    "points" INTEGER,
    "minSpendCents" INTEGER,
    "endsAt" TIMESTAMP(3),
    "status" "OfferItemStatus" NOT NULL DEFAULT 'AVAILABLE',
    "decision" "OfferDecisionState" NOT NULL DEFAULT 'NEW',
    "score" INTEGER,
    "scoreDetail" JSONB,
    "decisionReason" TEXT,
    "ruleId" TEXT,
    "autoEnrolled" BOOLEAN NOT NULL DEFAULT false,
    "userOfferId" TEXT,
    "contentHash" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "enrolledAt" TIMESTAMP(3),
    "savedCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OfferSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "matcher" "RuleMatcher" NOT NULL,
    "matcherValue" TEXT NOT NULL,
    "accountId" TEXT,
    "walletCardId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrollmentPolicy" (
    "userId" TEXT NOT NULL,
    "mode" "EnrollmentMode" NOT NULL DEFAULT 'RECOMMEND',
    "autoFilter" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnrollmentPolicy_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EnrollmentAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" "EnrollmentMode" NOT NULL,
    "actor" VARCHAR(8) NOT NULL,
    "result" "EnrollResult" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "verifiedBy" "ActivationVerifier",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrollmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferSyncRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "batchId" TEXT,
    "trigger" "OfferSyncTrigger" NOT NULL,
    "status" "OfferSyncStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "found" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "expired" INTEGER NOT NULL DEFAULT 0,
    "enrolled" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "warnings" INTEGER NOT NULL DEFAULT 0,
    "progress" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfferAccount_userId_idx" ON "OfferAccount"("userId");

-- CreateIndex
CREATE INDEX "OfferAccount_issuerId_idx" ON "OfferAccount"("issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferAccountCard_accountId_walletCardId_key" ON "OfferAccountCard"("accountId", "walletCardId");

-- CreateIndex
CREATE INDEX "OfferSnapshot_accountId_takenAt_idx" ON "OfferSnapshot"("accountId", "takenAt");

-- CreateIndex
CREATE INDEX "OfferSnapshotItem_userId_decision_idx" ON "OfferSnapshotItem"("userId", "decision");

-- CreateIndex
CREATE INDEX "OfferSnapshotItem_userId_status_idx" ON "OfferSnapshotItem"("userId", "status");

-- CreateIndex
CREATE INDEX "OfferSnapshotItem_endsAt_idx" ON "OfferSnapshotItem"("endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferSnapshotItem_accountId_cardKey_externalId_key" ON "OfferSnapshotItem"("accountId", "cardKey", "externalId");

-- CreateIndex
CREATE INDEX "EnrollmentRule_userId_enabled_idx" ON "EnrollmentRule"("userId", "enabled");

-- CreateIndex
CREATE INDEX "EnrollmentAttempt_userId_createdAt_idx" ON "EnrollmentAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EnrollmentAttempt_itemId_idx" ON "EnrollmentAttempt"("itemId");

-- CreateIndex
CREATE INDEX "OfferSyncRun_userId_createdAt_idx" ON "OfferSyncRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferSyncRun_batchId_idx" ON "OfferSyncRun"("batchId");

-- CreateIndex
CREATE INDEX "OfferSyncRun_status_idx" ON "OfferSyncRun"("status");

-- AddForeignKey
ALTER TABLE "OfferAccount" ADD CONSTRAINT "OfferAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAccount" ADD CONSTRAINT "OfferAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAccount" ADD CONSTRAINT "OfferAccount_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAccountCard" ADD CONSTRAINT "OfferAccountCard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OfferAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferAccountCard" ADD CONSTRAINT "OfferAccountCard_walletCardId_fkey" FOREIGN KEY ("walletCardId") REFERENCES "WalletCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferSnapshot" ADD CONSTRAINT "OfferSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OfferAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferSnapshotItem" ADD CONSTRAINT "OfferSnapshotItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OfferAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentRule" ADD CONSTRAINT "EnrollmentRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentPolicy" ADD CONSTRAINT "EnrollmentPolicy_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentAttempt" ADD CONSTRAINT "EnrollmentAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrollmentAttempt" ADD CONSTRAINT "EnrollmentAttempt_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OfferSnapshotItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferSyncRun" ADD CONSTRAINT "OfferSyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferSyncRun" ADD CONSTRAINT "OfferSyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "OfferAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

