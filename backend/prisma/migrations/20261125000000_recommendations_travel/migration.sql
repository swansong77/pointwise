-- CreateEnum
CREATE TYPE "LoyaltyKind" AS ENUM ('AIRLINE', 'HOTEL', 'OTHER');

-- AlterTable
ALTER TABLE "Issuer" ADD COLUMN     "enforcesFive24" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RewardCurrency" ADD COLUMN     "householdPooling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferIncrement" INTEGER NOT NULL DEFAULT 1000;

-- CreateTable
CREATE TABLE "SpendProfileEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "monthlyCents" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpendProfileEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyProgram" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "LoyaltyKind" NOT NULL DEFAULT 'AIRLINE',
    "centsPerPoint" DECIMAL(6,3) NOT NULL,
    "householdPooling" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferPartner" (
    "id" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "ratioFrom" INTEGER NOT NULL DEFAULT 1,
    "ratioTo" INTEGER NOT NULL DEFAULT 1,
    "transferDays" INTEGER NOT NULL DEFAULT 0,
    "bonusPercent" INTEGER NOT NULL DEFAULT 0,
    "bonusEndsAt" TIMESTAMP(3),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyBalance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "currencyId" TEXT,
    "programId" TEXT,
    "points" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpendProfileEntry_userId_categoryId_key" ON "SpendProfileEntry"("userId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyProgram_code_key" ON "LoyaltyProgram"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TransferPartner_currencyId_programId_key" ON "TransferPartner"("currencyId", "programId");

-- CreateIndex
CREATE INDEX "LoyaltyBalance_userId_idx" ON "LoyaltyBalance"("userId");

-- CreateIndex
CREATE INDEX "LoyaltyBalance_profileId_idx" ON "LoyaltyBalance"("profileId");

-- AddForeignKey
ALTER TABLE "SpendProfileEntry" ADD CONSTRAINT "SpendProfileEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpendProfileEntry" ADD CONSTRAINT "SpendProfileEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferPartner" ADD CONSTRAINT "TransferPartner_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "RewardCurrency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferPartner" ADD CONSTRAINT "TransferPartner_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyBalance" ADD CONSTRAINT "LoyaltyBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyBalance" ADD CONSTRAINT "LoyaltyBalance_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyBalance" ADD CONSTRAINT "LoyaltyBalance_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "RewardCurrency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyBalance" ADD CONSTRAINT "LoyaltyBalance_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One balance row per member and currency/program (exactly one of the two is set).
ALTER TABLE "LoyaltyBalance" ADD CONSTRAINT "LoyaltyBalance_one_target" CHECK (("currencyId" IS NULL) <> ("programId" IS NULL));
CREATE UNIQUE INDEX "LoyaltyBalance_member_currency" ON "LoyaltyBalance"("profileId", "currencyId") WHERE "currencyId" IS NOT NULL;
CREATE UNIQUE INDEX "LoyaltyBalance_member_program" ON "LoyaltyBalance"("profileId", "programId") WHERE "programId" IS NOT NULL;
