-- enum additions
ALTER TYPE "LoyaltyKind" ADD VALUE 'SHOPPING';
ALTER TYPE "LoyaltyKind" ADD VALUE 'DINING';
ALTER TYPE "LoyaltyKind" ADD VALUE 'CRUISE';
ALTER TYPE "LoyaltyKind" ADD VALUE 'RENTAL_CAR';
ALTER TYPE "LoyaltyKind" ADD VALUE 'CASINO';
ALTER TYPE "LoyaltyKind" ADD VALUE 'RETAIL';
ALTER TYPE "NotificationType" ADD VALUE 'LOYALTY_EXPIRING';

CREATE TYPE "ExpirationPolicyType" AS ENUM ('NEVER','ACTIVITY','FIXED','WHILE_CARD_OPEN','UNKNOWN');
CREATE TYPE "LoyaltySource" AS ENUM ('MANUAL','IMPORT','EMAIL');
CREATE TYPE "LoyaltyEventKind" AS ENUM ('SNAPSHOT','EARN','BONUS','PURCHASE','REDEEM','EXPIRE','TRANSFER_OUT','TRANSFER_IN','ADJUST');
CREATE TYPE "CertificateCategory" AS ENUM ('FREE_NIGHT','COMPANION','UPGRADE');
CREATE TYPE "CertificateStatus" AS ENUM ('AVAILABLE','USED','EXPIRED','CANCELLED');
CREATE TYPE "StatusKind" AS ENUM ('AIRLINE','HOTEL','RENTAL_CAR','CRUISE','CARD');
CREATE TYPE "MembershipKind" AS ENUM ('CLEAR','TSA_PRECHECK','GLOBAL_ENTRY','PRIORITY_PASS','DRAGONPASS','AIRLINE_CLUB','HOTEL','OTHER');

-- expiration policy on programs and bank currencies
ALTER TABLE "LoyaltyProgram"
  ADD COLUMN "policyType" "ExpirationPolicyType" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "policyMonths" INTEGER,
  ADD COLUMN "resetConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "policyNote" TEXT,
  ADD COLUMN "policySource" TEXT,
  ADD COLUMN "policyVerified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "transferable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RewardCurrency"
  ADD COLUMN "policyType" "ExpirationPolicyType" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "policyMonths" INTEGER,
  ADD COLUMN "resetConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "policyNote" TEXT,
  ADD COLUMN "policySource" TEXT,
  ADD COLUMN "policyVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NotificationPreference" ADD COLUMN "loyaltyExpiring" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "LoyaltyAccount" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "programId" TEXT, "currencyId" TEXT,
  "customName" TEXT, "customKind" "LoyaltyKind", "customCentsPerPoint" DECIMAL(6,3),
  "nickname" TEXT, "accountNumberEnc" TEXT, "accountLast4" VARCHAR(8), "memberSince" TIMESTAMP(3),
  "balance" INTEGER NOT NULL DEFAULT 0, "pendingBalance" INTEGER NOT NULL DEFAULT 0, "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
  "statusLevel" TEXT, "statusDeadline" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "lastActivityAt" TIMESTAMP(3),
  "source" "LoyaltySource" NOT NULL DEFAULT 'MANUAL', "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transferable" BOOLEAN, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltyAccount_userId_idx" ON "LoyaltyAccount"("userId");
CREATE INDEX "LoyaltyAccount_profileId_idx" ON "LoyaltyAccount"("profileId");
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "RewardCurrency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LoyaltyEvent" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "accountId" TEXT NOT NULL, "kind" "LoyaltyEventKind" NOT NULL,
  "points" INTEGER NOT NULL DEFAULT 0, "balanceAfter" INTEGER NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "note" TEXT,
  CONSTRAINT "LoyaltyEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltyEvent_accountId_occurredAt_idx" ON "LoyaltyEvent"("accountId","occurredAt");
CREATE INDEX "LoyaltyEvent_userId_idx" ON "LoyaltyEvent"("userId");
ALTER TABLE "LoyaltyEvent" ADD CONSTRAINT "LoyaltyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyEvent" ADD CONSTRAINT "LoyaltyEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LoyaltyCertificate" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "programId" TEXT, "accountId" TEXT,
  "category" "CertificateCategory" NOT NULL, "subtype" TEXT, "name" TEXT NOT NULL, "number" TEXT,
  "issuedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "quantity" INTEGER NOT NULL DEFAULT 1, "pointCap" INTEGER,
  "restrictions" TEXT, "eligible" TEXT[] DEFAULT ARRAY[]::TEXT[], "blackout" TEXT, "fareClasses" TEXT,
  "transferable" BOOLEAN NOT NULL DEFAULT false, "status" "CertificateStatus" NOT NULL DEFAULT 'AVAILABLE',
  "potentialValueCents" INTEGER NOT NULL DEFAULT 0, "usedAt" TIMESTAMP(3), "usageNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyCertificate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltyCertificate_userId_status_idx" ON "LoyaltyCertificate"("userId","status");
CREATE INDEX "LoyaltyCertificate_expiresAt_idx" ON "LoyaltyCertificate"("expiresAt");
ALTER TABLE "LoyaltyCertificate" ADD CONSTRAINT "LoyaltyCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCertificate" ADD CONSTRAINT "LoyaltyCertificate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCertificate" ADD CONSTRAINT "LoyaltyCertificate_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoyaltyCertificate" ADD CONSTRAINT "LoyaltyCertificate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EliteStatus" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "programId" TEXT, "accountId" TEXT,
  "programName" TEXT NOT NULL, "kind" "StatusKind" NOT NULL DEFAULT 'AIRLINE', "level" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "metric" TEXT, "progress" INTEGER NOT NULL DEFAULT 0, "required" INTEGER NOT NULL DEFAULT 0,
  "maintained" BOOLEAN NOT NULL DEFAULT false, "renewalRequirement" TEXT, "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "valueCents" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EliteStatus_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EliteStatus_userId_idx" ON "EliteStatus"("userId");
CREATE INDEX "EliteStatus_profileId_programName_idx" ON "EliteStatus"("profileId","programName");
ALTER TABLE "EliteStatus" ADD CONSTRAINT "EliteStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EliteStatus" ADD CONSTRAINT "EliteStatus_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EliteStatus" ADD CONSTRAINT "EliteStatus_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EliteStatus" ADD CONSTRAINT "EliteStatus_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Membership" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "profileId" TEXT NOT NULL, "kind" "MembershipKind" NOT NULL, "name" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3), "renewalAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "memberNumberEnc" TEXT, "memberLast4" VARCHAR(8),
  "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[], "renewalCostCents" INTEGER NOT NULL DEFAULT 0, "renewalMethod" TEXT,
  "autoRenew" BOOLEAN NOT NULL DEFAULT false, "linkedWalletCardId" TEXT, "annualValueCents" INTEGER NOT NULL DEFAULT 0, "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TransferBonusRecord" (
  "id" TEXT NOT NULL, "currencyId" TEXT NOT NULL, "programId" TEXT NOT NULL, "bonusPercent" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3), "source" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransferBonusRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TransferBonusRecord_currencyId_programId_startsAt_key" ON "TransferBonusRecord"("currencyId","programId","startsAt");
CREATE INDEX "TransferBonusRecord_currencyId_programId_idx" ON "TransferBonusRecord"("currencyId","programId");
ALTER TABLE "TransferBonusRecord" ADD CONSTRAINT "TransferBonusRecord_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "RewardCurrency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferBonusRecord" ADD CONSTRAINT "TransferBonusRecord_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AwardTrip" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "destination" TEXT NOT NULL, "dateFrom" TIMESTAMP(3) NOT NULL, "dateTo" TIMESTAMP(3) NOT NULL,
  "cabin" TEXT NOT NULL, "hotelPrefs" TEXT[] DEFAULT ARRAY[]::TEXT[], "airlinePrefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "pointsNeeded" INTEGER, "result" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AwardTrip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AwardTrip_userId_idx" ON "AwardTrip"("userId");
ALTER TABLE "AwardTrip" ADD CONSTRAINT "AwardTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
