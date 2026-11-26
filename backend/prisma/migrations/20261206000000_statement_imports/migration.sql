-- Imported statement files (hash + period only; the file itself is never stored)
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletCardId" TEXT NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "format" VARCHAR(8) NOT NULL,
    "channel" VARCHAR(8) NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "rows" INTEGER NOT NULL DEFAULT 0,
    "imported" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StatementImport_walletCardId_fileSha256_key" ON "StatementImport"("walletCardId", "fileSha256");
CREATE INDEX "StatementImport_userId_createdAt_idx" ON "StatementImport"("userId", "createdAt");
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_walletCardId_fkey" FOREIGN KEY ("walletCardId") REFERENCES "WalletCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
