-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "conditional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

