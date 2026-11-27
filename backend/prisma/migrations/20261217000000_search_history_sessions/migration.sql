-- CreateEnum
CREATE TYPE "SearchEntryKind" AS ENUM ('HISTORY', 'SAVED');

-- CreateTable
CREATE TABLE "SearchEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "intent" TEXT,
    "kind" "SearchEntryKind" NOT NULL DEFAULT 'HISTORY',
    "name" TEXT,
    "uses" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "entityRefs" JSONB,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slots" JSONB NOT NULL DEFAULT '{}',
    "turns" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchEntry_userId_kind_lastUsedAt_idx" ON "SearchEntry"("userId", "kind", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchEntry_userId_normalized_kind_key" ON "SearchEntry"("userId", "normalized", "kind");

-- CreateIndex
CREATE INDEX "SearchSession_userId_updatedAt_idx" ON "SearchSession"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "SearchEntry" ADD CONSTRAINT "SearchEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSession" ADD CONSTRAINT "SearchSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
