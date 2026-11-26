-- Automatic transaction capture: alert-email inbox, bank re-link state
ALTER TYPE "TransactionSource" ADD VALUE 'EMAIL';
CREATE TYPE "InboundKind" AS ENUM ('ALERT', 'STATEMENT', 'FORWARD_CONFIRMATION', 'IGNORED');
CREATE TYPE "InboundStatus" AS ENUM ('PROCESSED', 'NEEDS_CARD', 'DUPLICATE', 'REJECTED');

CREATE TABLE "EmailInbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "received" INTEGER NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailInbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailInbox_userId_key" ON "EmailInbox"("userId");
CREATE UNIQUE INDEX "EmailInbox_token_key" ON "EmailInbox"("token");
ALTER TABLE "EmailInbox" ADD CONSTRAINT "EmailInbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromDomain" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "kind" "InboundKind" NOT NULL,
    "status" "InboundStatus" NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "lastDigits" VARCHAR(5),
    "amountCents" INTEGER,
    "merchant" TEXT,
    "occurredAt" TIMESTAMP(3),
    "credit" BOOLEAN NOT NULL DEFAULT false,
    "walletCardId" TEXT,
    "transactionId" TEXT,
    "note" TEXT,
    "confirmationCode" TEXT,
    "confirmationUrl" TEXT,
    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InboundEmail_userId_receivedAt_idx" ON "InboundEmail"("userId", "receivedAt");
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankConnection"
  ADD COLUMN "needsReauth" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "lastTxSyncAt" TIMESTAMP(3);
