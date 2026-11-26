-- CreateEnum
CREATE TYPE "CardholderRelationship" AS ENUM ('SELF', 'SPOUSE', 'PARTNER', 'CHILD', 'PARENT', 'OTHER');

-- CreateEnum
CREATE TYPE "OpenDatePrecision" AS ENUM ('DAY', 'MONTH');

-- CreateEnum
CREATE TYPE "CardSource" AS ENUM ('MANUAL', 'SPREADSHEET', 'BANK', 'CREDIT_REPORT');

-- CreateEnum
CREATE TYPE "BenefitPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'MULTI_YEAR');

-- CreateEnum
CREATE TYPE "PeriodBasis" AS ENUM ('CALENDAR', 'CARDMEMBER_YEAR');

-- CreateEnum
CREATE TYPE "BenefitKind" AS ENUM ('CREDIT', 'CERTIFICATE', 'MEMBERSHIP', 'ACCESS');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('SPREADSHEET', 'CSV', 'BANK', 'CREDIT_REPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'FAILED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "ImportRowResult" AS ENUM ('NEW', 'UPDATE', 'DUPLICATE', 'SKIPPED', 'ERROR');

-- CreateEnum
CREATE TYPE "BankProvider" AS ENUM ('PLAID');

-- CreateEnum
CREATE TYPE "Bureau" AS ENUM ('EXPERIAN', 'EQUIFAX', 'TRANSUNION', 'OTHER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BENEFIT_EXPIRING';

-- AlterTable
ALTER TABLE "Issuer" ADD COLUMN     "aliases" TEXT[],
ADD COLUMN     "businessReportsToPersonal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "benefitEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "benefitExpiring" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "benefitPush" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "birthYear" INTEGER,
ADD COLUMN     "householdId" TEXT,
ADD COLUMN     "relationship" "CardholderRelationship" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "WalletCard" ADD COLUMN     "creditLimitCents" INTEGER,
ADD COLUMN     "excludeFrom524" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "excludeReason" TEXT,
ADD COLUMN     "openDatePrecision" "OpenDatePrecision" NOT NULL DEFAULT 'DAY',
ADD COLUMN     "source" "CardSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "sourceMeta" JSONB,
ADD COLUMN     "sourceRef" TEXT,
ALTER COLUMN "lastFour" SET DATA TYPE VARCHAR(5);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'My household',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BenefitCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benefit" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL DEFAULT 'CREDIT',
    "period" "BenefitPeriod" NOT NULL DEFAULT 'ANNUAL',
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "basis" "PeriodBasis" NOT NULL DEFAULT 'CALENDAR',
    "amountPerPeriodCents" INTEGER NOT NULL DEFAULT 0,
    "howIssued" TEXT,
    "actionNeeded" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Benefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBenefit" (
    "id" TEXT NOT NULL,
    "walletCardId" TEXT NOT NULL,
    "benefitId" TEXT,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL DEFAULT 'CREDIT',
    "period" "BenefitPeriod" NOT NULL DEFAULT 'ANNUAL',
    "periodMonths" INTEGER NOT NULL DEFAULT 12,
    "basis" "PeriodBasis" NOT NULL DEFAULT 'CALENDAR',
    "amountPerPeriodCents" INTEGER NOT NULL,
    "howIssued" TEXT,
    "actionNeeded" TEXT,
    "notes" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitUsage" (
    "id" TEXT NOT NULL,
    "userBenefitId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "usedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitNotification" (
    "id" TEXT NOT NULL,
    "userBenefitId" TEXT NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenefitNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "fileName" TEXT,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "CardImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "result" "ImportRowResult" NOT NULL,
    "message" TEXT,
    "matchedId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "BankProvider" NOT NULL,
    "institutionName" TEXT,
    "itemId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditReportAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT,
    "bureau" "Bureau" NOT NULL DEFAULT 'OTHER',
    "creditorName" TEXT NOT NULL,
    "lastDigits" VARCHAR(5),
    "openedOn" TIMESTAMP(3) NOT NULL,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "isAuthorizedUser" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "creditLimitCents" INTEGER,
    "walletCardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditReportAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiveTwentyFourSnapshot" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "FiveTwentyFourSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Household_ownerId_key" ON "Household"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitCategory_slug_key" ON "BenefitCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Benefit_cardId_name_key" ON "Benefit"("cardId", "name");

-- CreateIndex
CREATE INDEX "UserBenefit_walletCardId_idx" ON "UserBenefit"("walletCardId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBenefit_walletCardId_name_key" ON "UserBenefit"("walletCardId", "name");

-- CreateIndex
CREATE INDEX "BenefitUsage_userBenefitId_periodStart_idx" ON "BenefitUsage"("userBenefitId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitNotification_userBenefitId_periodEnd_thresholdDays_c_key" ON "BenefitNotification"("userBenefitId", "periodEnd", "thresholdDays", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "CardImportJob_userId_createdAt_idx" ON "CardImportJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_idx" ON "ImportRow"("jobId");

-- CreateIndex
CREATE INDEX "BankConnection_userId_idx" ON "BankConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BankConnection_provider_itemId_key" ON "BankConnection"("provider", "itemId");

-- CreateIndex
CREATE INDEX "CreditReportAccount_userId_idx" ON "CreditReportAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FiveTwentyFourSnapshot_profileId_takenOn_key" ON "FiveTwentyFourSnapshot"("profileId", "takenOn");

-- CreateIndex
CREATE INDEX "Profile_householdId_idx" ON "Profile"("householdId");

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "CreditCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Benefit" ADD CONSTRAINT "Benefit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_walletCardId_fkey" FOREIGN KEY ("walletCardId") REFERENCES "WalletCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "Benefit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBenefit" ADD CONSTRAINT "UserBenefit_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_userBenefitId_fkey" FOREIGN KEY ("userBenefitId") REFERENCES "UserBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitNotification" ADD CONSTRAINT "BenefitNotification_userBenefitId_fkey" FOREIGN KEY ("userBenefitId") REFERENCES "UserBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardImportJob" ADD CONSTRAINT "CardImportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CardImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankConnection" ADD CONSTRAINT "BankConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReportAccount" ADD CONSTRAINT "CreditReportAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReportAccount" ADD CONSTRAINT "CreditReportAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReportAccount" ADD CONSTRAINT "CreditReportAccount_walletCardId_fkey" FOREIGN KEY ("walletCardId") REFERENCES "WalletCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiveTwentyFourSnapshot" ADD CONSTRAINT "FiveTwentyFourSnapshot_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: one household per user that already has cardholder profiles; primary profile = SELF.
INSERT INTO "Household" ("id", "ownerId", "name")
SELECT gen_random_uuid(), p."userId", 'My household' FROM "Profile" p GROUP BY p."userId"
ON CONFLICT ("ownerId") DO NOTHING;
UPDATE "Profile" p SET "householdId" = h."id" FROM "Household" h WHERE h."ownerId" = p."userId" AND p."householdId" IS NULL;
UPDATE "Profile" SET "relationship" = 'SELF' WHERE "isPrimary" = true;

-- Private (user-imported) cards
ALTER TABLE "CreditCard" ADD COLUMN "ownerId" TEXT;
CREATE INDEX "CreditCard_ownerId_idx" ON "CreditCard"("ownerId");
