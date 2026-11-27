-- Cash-back and points shopping sites, their status, and who has an account on which.
CREATE TYPE "CashbackKind" AS ENUM ('CASHBACK', 'POINTS');

ALTER TABLE "PortalRate"
  ADD COLUMN "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "upTo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "conditions" TEXT;

CREATE TABLE "CashbackSite" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "CashbackKind" NOT NULL DEFAULT 'CASHBACK',
  "homeUrl" TEXT NOT NULL,
  "storeUrlTemplate" TEXT,
  "pointCents" DECIMAL(6,3),
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "autoRead" BOOLEAN NOT NULL DEFAULT false,
  "lastCheckedAt" TIMESTAMP(3),
  "reachable" BOOLEAN,
  "httpStatus" INTEGER,
  "lastError" TEXT,
  "lastOkAt" TIMESTAMP(3),
  "failures" INTEGER NOT NULL DEFAULT 0,
  "lastReadAt" TIMESTAMP(3),
  "lastReadNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashbackSite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CashbackSite_code_key" ON "CashbackSite"("code");

CREATE TABLE "UserCashbackAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserCashbackAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserCashbackAccount_profileId_siteId_key" ON "UserCashbackAccount"("profileId", "siteId");
CREATE INDEX "UserCashbackAccount_userId_idx" ON "UserCashbackAccount"("userId");
ALTER TABLE "UserCashbackAccount" ADD CONSTRAINT "UserCashbackAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCashbackAccount" ADD CONSTRAINT "UserCashbackAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCashbackAccount" ADD CONSTRAINT "UserCashbackAccount_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "CashbackSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
