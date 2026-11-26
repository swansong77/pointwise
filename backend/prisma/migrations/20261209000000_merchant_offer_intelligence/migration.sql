CREATE TYPE "OfferSource" AS ENUM ('ISSUER_OFFICIAL','ACCOUNT_DATA','EMAIL','PUBLIC_PAGE','AI_INFERRED','USER_ENTERED','ADMIN','PORTAL');
CREATE TYPE "OfferType" AS ENUM ('STATEMENT_CREDIT','CASHBACK_PERCENT','POINTS_BONUS','SPEND_GET','PORTAL_RATE','COUPON');
CREATE TYPE "OfferVerification" AS ENUM ('UNVERIFIED','VERIFIED','DISPUTED');
CREATE TYPE "ActivationStatus" AS ENUM ('NOT_REQUIRED','PENDING','ACTIVATED','FAILED');
CREATE TYPE "ActivationVerifier" AS ENUM ('MANUAL','STATEMENT','EMAIL');
CREATE TYPE "OfferEventType" AS ENUM ('IMPORTED','UPDATED','ACTIVATED','ACTIVATION_FAILED','ACTIVATION_VERIFIED','EXPIRED','REDEEMED','RECOMMENDED','MISSED_DETECTED','PLANNED');

ALTER TABLE "Merchant" ADD COLUMN "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "mcc" TEXT[] DEFAULT ARRAY[]::TEXT[], ADD COLUMN "parentCompany" TEXT, ADD COLUMN "industry" TEXT;
ALTER TABLE "Issuer" ADD COLUMN "offersUrl" TEXT;
ALTER TABLE "Offer"
  ADD COLUMN "source" "OfferSource" NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "sourceRef" TEXT,
  ADD COLUMN "reliability" INTEGER NOT NULL DEFAULT 75,
  ADD COLUMN "offerType" "OfferType" NOT NULL DEFAULT 'STATEMENT_CREDIT',
  ADD COLUMN "enrollmentRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "verification" "OfferVerification" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "lastValidatedAt" TIMESTAMP(3);
-- offers users typed in themselves are the least reliable source
UPDATE "Offer" SET "source" = 'USER_ENTERED', "reliability" = 25 WHERE "isCustom" = true;
ALTER TABLE "UserOffer"
  ADD COLUMN "activationStatus" "ActivationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "activatedAt" TIMESTAMP(3),
  ADD COLUMN "activationVerifiedBy" "ActivationVerifier";

CREATE TABLE "OfferEvent" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "offerId" TEXT, "userOfferId" TEXT,
  "type" "OfferEventType" NOT NULL, "actor" VARCHAR(8) NOT NULL, "detail" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfferEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfferEvent_userId_createdAt_idx" ON "OfferEvent"("userId","createdAt");
CREATE INDEX "OfferEvent_offerId_idx" ON "OfferEvent"("offerId");
ALTER TABLE "OfferEvent" ADD CONSTRAINT "OfferEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OfferEvent" ADD CONSTRAINT "OfferEvent_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OfferEvent" ADD CONSTRAINT "OfferEvent_userOfferId_fkey" FOREIGN KEY ("userOfferId") REFERENCES "UserOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "PortalRate" (
  "id" TEXT NOT NULL, "portal" TEXT NOT NULL, "merchantId" TEXT NOT NULL,
  "ratePercent" DECIMAL(5,2), "pointsPerDollar" DECIMAL(6,2), "source" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3), "updatedBy" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalRate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortalRate_portal_merchantId_key" ON "PortalRate"("portal","merchantId");
CREATE INDEX "PortalRate_merchantId_idx" ON "PortalRate"("merchantId");
ALTER TABLE "PortalRate" ADD CONSTRAINT "PortalRate_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlannedPurchase" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "merchantId" TEXT, "merchantText" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL, "plannedFor" TIMESTAMP(3), "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlannedPurchase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlannedPurchase_userId_plannedFor_idx" ON "PlannedPurchase"("userId","plannedFor");
ALTER TABLE "PlannedPurchase" ADD CONSTRAINT "PlannedPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
