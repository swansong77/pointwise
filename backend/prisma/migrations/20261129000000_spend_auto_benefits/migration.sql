-- Spend tracking (statement / bank transactions) and automatic benefit tracking
CREATE TYPE "TransactionKind" AS ENUM ('PURCHASE', 'CREDIT', 'REFUND', 'PAYMENT', 'FEE');
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'CSV', 'BANK');
CREATE TYPE "UsageSource" AS ENUM ('MANUAL', 'AUTO_PURCHASE', 'AUTO_CREDIT');
CREATE TYPE "UsageStatus" AS ENUM ('CONFIRMED', 'EXPECTED', 'DISMISSED');

ALTER TABLE "Transaction"
  ADD COLUMN "kind" "TransactionKind" NOT NULL DEFAULT 'PURCHASE',
  ADD COLUMN "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "bankCategory" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "Transaction_walletCardId_externalId_key" ON "Transaction"("walletCardId", "externalId");

ALTER TABLE "Benefit" ADD COLUMN "autoRules" JSONB;
ALTER TABLE "UserBenefit" ADD COLUMN "autoTrack" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "autoRules" JSONB;

ALTER TABLE "BenefitUsage"
  ADD COLUMN "source" "UsageSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "status" "UsageStatus" NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN "transactionId" TEXT,
  ADD COLUMN "creditTransactionId" TEXT;
CREATE UNIQUE INDEX "BenefitUsage_userBenefitId_transactionId_key" ON "BenefitUsage"("userBenefitId", "transactionId");
CREATE INDEX "BenefitUsage_creditTransactionId_idx" ON "BenefitUsage"("creditTransactionId");
ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BenefitUsage" ADD CONSTRAINT "BenefitUsage_creditTransactionId_fkey" FOREIGN KEY ("creditTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BankConnection" ADD COLUMN "txCursor" TEXT;

-- category / merchant links on transactions (dangling ids from before are cleared)
UPDATE "Transaction" SET "categoryId" = NULL WHERE "categoryId" IS NOT NULL AND "categoryId" NOT IN (SELECT "id" FROM "Category");
UPDATE "Transaction" SET "merchantId" = NULL WHERE "merchantId" IS NOT NULL AND "merchantId" NOT IN (SELECT "id" FROM "Merchant");
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
