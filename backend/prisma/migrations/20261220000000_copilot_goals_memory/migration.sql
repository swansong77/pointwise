-- CreateEnum
CREATE TYPE "GoalKind" AS ENUM ('STATUS', 'FIVE24', 'TRIP', 'CASHBACK', 'FEES', 'MILES', 'CUSTOM');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'DONE', 'DROPPED');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('PREFERENCE', 'DECISION', 'RECOMMENDATION');

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT,
    "kind" "GoalKind" NOT NULL,
    "title" TEXT NOT NULL,
    "target" JSONB NOT NULL DEFAULT '{}',
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "manualProgress" INTEGER,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopilotMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopilotMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId", "status");

-- CreateIndex
CREATE INDEX "CopilotMemory_userId_kind_idx" ON "CopilotMemory"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "CopilotMemory_userId_kind_key_key" ON "CopilotMemory"("userId", "kind", "key");

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopilotMemory" ADD CONSTRAINT "CopilotMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
