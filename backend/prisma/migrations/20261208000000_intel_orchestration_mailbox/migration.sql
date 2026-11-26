ALTER TABLE "Profile" ADD COLUMN "goals" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "hasBusiness" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "PromptStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "MailboxKind" AS ENUM ('IMAP', 'GMAIL', 'GRAPH');

CREATE TABLE "Recommendation" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "profileId" TEXT, "cardId" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL, "inputs" JSONB NOT NULL, "weights" JSONB NOT NULL,
  "scoreCents" INTEGER NOT NULL, "firstYearValueCents" INTEGER NOT NULL, "longTermValueCents" INTEGER NOT NULL,
  "probability" DOUBLE PRECISION NOT NULL, "confidence" DOUBLE PRECISION NOT NULL, "eligible" BOOLEAN NOT NULL,
  "risks" JSONB NOT NULL, "advice" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Recommendation_userId_createdAt_idx" ON "Recommendation"("userId", "createdAt");
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecommendationFactor" (
  "id" TEXT NOT NULL, "recommendationId" TEXT NOT NULL, "key" TEXT NOT NULL, "label" TEXT NOT NULL,
  "deltaCents" INTEGER NOT NULL, "note" TEXT,
  CONSTRAINT "RecommendationFactor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecommendationFactor_recommendationId_idx" ON "RecommendationFactor"("recommendationId");
ALTER TABLE "RecommendationFactor" ADD CONSTRAINT "RecommendationFactor_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentRun" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "workflow" TEXT NOT NULL, "question" TEXT,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING', "engineVersion" TEXT NOT NULL, "promptVersions" JSONB,
  "result" JSONB, "error" TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), "durationMs" INTEGER,
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt");
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgentStep" (
  "id" TEXT NOT NULL, "runId" TEXT NOT NULL, "ordinal" INTEGER NOT NULL, "agentKey" TEXT NOT NULL,
  "engine" TEXT NOT NULL, "privacy" VARCHAR(8) NOT NULL, "status" VARCHAR(8) NOT NULL,
  "inputHash" VARCHAR(64) NOT NULL, "output" JSONB, "narratedBy" TEXT, "promptKey" TEXT, "promptVersion" INTEGER,
  "durationMs" INTEGER NOT NULL DEFAULT 0, "error" TEXT,
  CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentStep_runId_ordinal_idx" ON "AgentStep"("runId", "ordinal");
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PromptTemplate" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "version" INTEGER NOT NULL, "body" TEXT NOT NULL,
  "status" "PromptStatus" NOT NULL DEFAULT 'DRAFT', "note" TEXT, "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");
CREATE INDEX "PromptTemplate_key_status_idx" ON "PromptTemplate"("key", "status");

CREATE TABLE "Mailbox" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" "MailboxKind" NOT NULL DEFAULT 'IMAP', "label" TEXT NOT NULL,
  "host" TEXT, "port" INTEGER, "username" TEXT NOT NULL, "secretEnc" TEXT NOT NULL,
  "folder" TEXT NOT NULL DEFAULT 'INBOX', "cursor" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "lastSyncAt" TIMESTAMP(3), "lastStatus" TEXT, "lastError" TEXT, "processed" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Mailbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Mailbox_userId_kind_username_key" ON "Mailbox"("userId", "kind", "username");
CREATE INDEX "Mailbox_active_lastSyncAt_idx" ON "Mailbox"("active", "lastSyncAt");
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
