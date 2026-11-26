ALTER TYPE "NotificationType" ADD VALUE 'LOYALTY_STALE';
ALTER TYPE "InboundKind" ADD VALUE 'LOYALTY';

CREATE TYPE "LoyaltyDataSource" AS ENUM ('OFFICIAL_API','AGGREGATOR','EMAIL','STATEMENT','EXTENSION','AI_DETECTED','MANUAL');
CREATE TYPE "LoyaltyVerification" AS ENUM ('UNVERIFIED','CROSS_CONFIRMED');
CREATE TYPE "ObservationOutcome" AS ENUM ('ACCEPTED','CONFIRMED','KEPT','CONFLICT','PENDING','REJECTED');
CREATE TYPE "RefreshPriority" AS ENUM ('CRITICAL','HIGH','NORMAL','LOW');
CREATE TYPE "SyncStatus" AS ENUM ('OK','PARTIAL','FAILED');

ALTER TABLE "NotificationPreference" ADD COLUMN "loyaltyStale" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LoyaltyAccount"
  ADD COLUMN "provenance" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "balanceSource" "LoyaltyDataSource",
  ADD COLUMN "balanceObservedAt" TIMESTAMP(3),
  ADD COLUMN "refreshConfidence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastSuccessfulRefreshAt" TIMESTAMP(3),
  ADD COLUMN "nextRefreshAt" TIMESTAMP(3),
  ADD COLUMN "refreshPriority" "RefreshPriority" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "LoyaltyCertificate"
  ADD COLUMN "source" "LoyaltyDataSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "reliability" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "observedAt" TIMESTAMP(3),
  ADD COLUMN "verification" "LoyaltyVerification" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "conditions" JSONB,
  ADD COLUMN "externalKey" TEXT;
ALTER TABLE "EliteStatus"
  ADD COLUMN "source" "LoyaltyDataSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "reliability" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "observedAt" TIMESTAMP(3),
  ADD COLUMN "verification" "LoyaltyVerification" NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Membership"
  ADD COLUMN "source" "LoyaltyDataSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "reliability" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN "observedAt" TIMESTAMP(3),
  ADD COLUMN "verification" "LoyaltyVerification" NOT NULL DEFAULT 'UNVERIFIED';

CREATE TABLE "LoyaltyObservation" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT, "entity" VARCHAR(12) NOT NULL, "entityId" TEXT,
  "field" VARCHAR(40) NOT NULL, "value" JSONB NOT NULL, "sourceType" "LoyaltyDataSource" NOT NULL, "reliability" INTEGER NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL, "method" VARCHAR(80) NOT NULL, "evidenceHash" VARCHAR(64) NOT NULL, "dedupeKey" VARCHAR(200) NOT NULL,
  "outcome" "ObservationOutcome" NOT NULL, "reason" TEXT NOT NULL, "storedValue" JSONB, "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyObservation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyObservation_userId_dedupeKey_key" ON "LoyaltyObservation"("userId","dedupeKey");
CREATE INDEX "LoyaltyObservation_userId_createdAt_idx" ON "LoyaltyObservation"("userId","createdAt");
CREATE INDEX "LoyaltyObservation_accountId_createdAt_idx" ON "LoyaltyObservation"("accountId","createdAt");
CREATE INDEX "LoyaltyObservation_userId_outcome_idx" ON "LoyaltyObservation"("userId","outcome");
ALTER TABLE "LoyaltyObservation" ADD CONSTRAINT "LoyaltyObservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyObservation" ADD CONSTRAINT "LoyaltyObservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LoyaltySyncRun" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT, "method" VARCHAR(16) NOT NULL, "trigger" VARCHAR(16) NOT NULL,
  "status" "SyncStatus" NOT NULL, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMP(3),
  "observations" INTEGER NOT NULL DEFAULT 0, "changes" INTEGER NOT NULL DEFAULT 0, "error" TEXT, "detail" JSONB,
  CONSTRAINT "LoyaltySyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltySyncRun_userId_startedAt_idx" ON "LoyaltySyncRun"("userId","startedAt");
CREATE INDEX "LoyaltySyncRun_accountId_startedAt_idx" ON "LoyaltySyncRun"("accountId","startedAt");
ALTER TABLE "LoyaltySyncRun" ADD CONSTRAINT "LoyaltySyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltySyncRun" ADD CONSTRAINT "LoyaltySyncRun_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
