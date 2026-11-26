-- CreateEnum
CREATE TYPE "CreditBand" AS ENUM ('EXCELLENT', 'VERY_GOOD', 'GOOD', 'FAIR', 'POOR');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TRANSFER_BONUS';

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "recommendedCredit" "CreditBand";

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "transferBonuses" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "creditBand" "CreditBand";

