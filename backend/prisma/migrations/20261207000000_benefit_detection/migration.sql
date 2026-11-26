-- Account-level benefit detection: evidence on usage, detection audit, statement validation.
ALTER TYPE "BenefitPeriod" ADD VALUE IF NOT EXISTS 'ONE_TIME';
ALTER TYPE "BenefitPeriod" ADD VALUE IF NOT EXISTS 'CUSTOM';

CREATE TYPE "UsageVerification" AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');
CREATE TYPE "DetectionStatus" AS ENUM ('DETECTED', 'ACCEPTED', 'REJECTED');
CREATE TYPE "ValidationStatus" AS ENUM ('PASS', 'WARNING', 'FAILED');

ALTER TABLE "UserBenefit"
  ADD COLUMN "expiresOn" TIMESTAMP(3),
  ADD COLUMN "windowStart" TIMESTAMP(3),
  ADD COLUMN "windowEnd" TIMESTAMP(3);

ALTER TABLE "BenefitUsage"
  ADD COLUMN "detectionMethod" VARCHAR(8),
  ADD COLUMN "confidence" INTEGER,
  ADD COLUMN "verification" "UsageVerification" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "statementImportId" TEXT,
  ADD COLUMN "evidence" JSONB;
CREATE INDEX "BenefitUsage_statementImportId_idx" ON "BenefitUsage"("statementImportId");
ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_statementImportId_fkey"
  FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StatementValidation" (
  "id" TEXT NOT NULL,
  "statementImportId" TEXT NOT NULL,
  "statementCount" INTEGER NOT NULL,
  "importedCount" INTEGER NOT NULL,
  "differenceCount" INTEGER NOT NULL,
  "statementCents" INTEGER NOT NULL,
  "importedCents" INTEGER NOT NULL,
  "missingCents" INTEGER NOT NULL,
  "confidence" INTEGER NOT NULL,
  "status" "ValidationStatus" NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StatementValidation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StatementValidation_statementImportId_key" ON "StatementValidation"("statementImportId");
ALTER TABLE "StatementValidation" ADD CONSTRAINT "StatementValidation_statementImportId_fkey"
  FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BenefitDetection" (
  "id" TEXT NOT NULL,
  "userBenefitId" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "usageId" TEXT,
  "statementImportId" TEXT,
  "method" VARCHAR(8) NOT NULL,
  "confidence" INTEGER NOT NULL,
  "rule" VARCHAR(120) NOT NULL,
  "merchant" VARCHAR(120) NOT NULL,
  "tier" VARCHAR(8) NOT NULL,
  "status" "DetectionStatus" NOT NULL DEFAULT 'DETECTED',
  "aiReasoning" TEXT,
  "duplicateRisk" BOOLEAN NOT NULL DEFAULT false,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BenefitDetection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BenefitDetection_userBenefitId_transactionId_key" ON "BenefitDetection"("userBenefitId", "transactionId");
CREATE INDEX "BenefitDetection_transactionId_idx" ON "BenefitDetection"("transactionId");
ALTER TABLE "BenefitDetection" ADD CONSTRAINT "BenefitDetection_userBenefitId_fkey"
  FOREIGN KEY ("userBenefitId") REFERENCES "UserBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitDetection" ADD CONSTRAINT "BenefitDetection_statementImportId_fkey"
  FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AiSettings" ADD COLUMN "classifyMerchants" BOOLEAN NOT NULL DEFAULT false;
