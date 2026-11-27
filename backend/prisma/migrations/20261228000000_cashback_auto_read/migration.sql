-- Automatic reading of public store pages (off until the administrator allows it per site) and a benchmark from a comparison site.
ALTER TABLE "CashbackSite" ADD COLUMN "readFailures" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "MerchantBenchmark" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "bestPercent" DECIMAL(5,2) NOT NULL,
  "url" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MerchantBenchmark_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MerchantBenchmark_merchantId_key" ON "MerchantBenchmark"("merchantId");
ALTER TABLE "MerchantBenchmark" ADD CONSTRAINT "MerchantBenchmark_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
