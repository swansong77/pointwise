-- Card-research agent (Claude web search on issuer domains) + curated real-card catalog markers
CREATE TYPE "CatalogSource" AS ENUM ('DEMO', 'SEED', 'ADMIN', 'RESEARCH');
CREATE TYPE "CardResearchKind" AS ENUM ('DISCOVER', 'VERIFY');
CREATE TYPE "CardResearchStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "CardCandidateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "CreditCard"
  ADD COLUMN "catalogSource" "CatalogSource" NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "dataAsOf" TIMESTAMP(3),
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);

CREATE TABLE "CardResearchRun" (
    "id" TEXT NOT NULL,
    "kind" "CardResearchKind" NOT NULL,
    "issuer" TEXT,
    "cardId" TEXT,
    "focus" TEXT,
    "maxCards" INTEGER NOT NULL DEFAULT 10,
    "status" "CardResearchStatus" NOT NULL DEFAULT 'QUEUED',
    "model" TEXT,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "fetches" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "sources" JSONB,
    "notes" TEXT,
    "error" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "CardResearchRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardResearchRun_status_createdAt_idx" ON "CardResearchRun"("status", "createdAt");
ALTER TABLE "CardResearchRun" ADD CONSTRAINT "CardResearchRun_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CardCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" "CardNetwork",
    "type" "CardType" NOT NULL DEFAULT 'PERSONAL',
    "annualFeeCents" INTEGER,
    "productUrl" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "verification" TEXT NOT NULL,
    "evidenceFrom" TEXT NOT NULL,
    "verifiedFacts" INTEGER NOT NULL DEFAULT 0,
    "totalFacts" INTEGER NOT NULL DEFAULT 0,
    "matchedCardId" TEXT,
    "status" "CardCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "createdCardId" TEXT,
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardCandidate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardCandidate_status_createdAt_idx" ON "CardCandidate"("status", "createdAt");
CREATE INDEX "CardCandidate_runId_idx" ON "CardCandidate"("runId");
ALTER TABLE "CardCandidate" ADD CONSTRAINT "CardCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CardResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
