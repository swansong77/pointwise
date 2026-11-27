-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN "aiModeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "copilotMode" TEXT NOT NULL DEFAULT 'QUICK',
ADD COLUMN "temperature" DOUBLE PRECISION,
ADD COLUMN "reasoningDepth" TEXT,
ADD COLUMN "responseStyle" TEXT NOT NULL DEFAULT 'BALANCED',
ADD COLUMN "cloudShareConsentAt" TIMESTAMP(3),
ADD COLUMN "cloudProviders" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "AiDisclosure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "local" BOOLEAN NOT NULL DEFAULT false,
    "purpose" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDisclosure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiDisclosure_userId_createdAt_idx" ON "AiDisclosure"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiDisclosure" ADD CONSTRAINT "AiDisclosure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
