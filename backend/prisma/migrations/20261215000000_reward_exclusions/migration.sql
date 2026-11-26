-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "excludedMerchantIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
