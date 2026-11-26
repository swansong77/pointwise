-- CreateEnum
CREATE TYPE "PlannedPurchaseStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "PlannedPurchase" ADD COLUMN     "item" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "priority" TEXT,
ADD COLUMN     "status" "PlannedPurchaseStatus" NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "chosenWalletCardId" TEXT,
ADD COLUMN     "expectedCents" INTEGER,
ADD COLUMN     "actualCents" INTEGER;

-- CreateIndex
CREATE INDEX "PlannedPurchase_userId_status_idx" ON "PlannedPurchase"("userId", "status");
