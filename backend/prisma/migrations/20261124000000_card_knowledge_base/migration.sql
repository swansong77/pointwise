-- CreateEnum
CREATE TYPE "CardProductStatus" AS ENUM ('OPEN', 'CLOSED_TO_NEW', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "BonusType" AS ENUM ('POINTS', 'MILES', 'CASH', 'NIGHTS', 'OTHER');

-- CreateEnum
CREATE TYPE "CardSourceKind" AS ENUM ('ISSUER_PAGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "OfferVersionKind" AS ENUM ('WELCOME', 'ELEVATED', 'LIMITED_TIME');

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "authorizedUserFeeCents" INTEGER,
ADD COLUMN     "bonusType" "BonusType",
ADD COLUMN     "bonusValuationCents" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "launchDate" TIMESTAMP(3),
ADD COLUMN     "offerExpiresAt" TIMESTAMP(3),
ADD COLUMN     "productFamily" TEXT,
ADD COLUMN     "productStatus" "CardProductStatus" NOT NULL DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "CardDataSource" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "CardSourceKind" NOT NULL DEFAULT 'ISSUER_PAGE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "etag" TEXT,
    "lastModified" TEXT,
    "contentHash" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardChangeProposal" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sourceId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method" TEXT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardChangeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardOffer" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "kind" "OfferVersionKind" NOT NULL DEFAULT 'WELCOME',
    "bonusType" "BonusType",
    "bonusAmount" INTEGER,
    "minSpendCents" INTEGER,
    "spendMonths" INTEGER,
    "annualFeeCents" INTEGER NOT NULL,
    "valuationCents" INTEGER,
    "description" TEXT,
    "elevated" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "changeNote" TEXT,

    CONSTRAINT "CardOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionOfferReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "reportedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offer" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,

    CONSTRAINT "RetentionOfferReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardDataSource_cardId_url_key" ON "CardDataSource"("cardId", "url");

-- CreateIndex
CREATE INDEX "CardChangeProposal_status_createdAt_idx" ON "CardChangeProposal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CardChangeProposal_cardId_idx" ON "CardChangeProposal"("cardId");

-- CreateIndex
CREATE INDEX "CardOffer_cardId_kind_validFrom_idx" ON "CardOffer"("cardId", "kind", "validFrom");

-- CreateIndex
CREATE INDEX "RetentionOfferReport_cardId_reportedOn_idx" ON "RetentionOfferReport"("cardId", "reportedOn");

-- AddForeignKey
ALTER TABLE "CardDataSource" ADD CONSTRAINT "CardDataSource_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardChangeProposal" ADD CONSTRAINT "CardChangeProposal_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardChangeProposal" ADD CONSTRAINT "CardChangeProposal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CardDataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOffer" ADD CONSTRAINT "CardOffer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionOfferReport" ADD CONSTRAINT "RetentionOfferReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionOfferReport" ADD CONSTRAINT "RetentionOfferReport_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open version per (card, kind): history is append-only (SCD type 2).
CREATE UNIQUE INDEX "CardOffer_one_open_version" ON "CardOffer"("cardId", "kind") WHERE "validTo" IS NULL;
