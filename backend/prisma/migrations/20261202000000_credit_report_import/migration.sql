-- Credit report (Credit Karma) import: full-date precision, closed date, account type, source
ALTER TABLE "CreditReportAccount"
  ADD COLUMN "openedPrecision" "OpenDatePrecision" NOT NULL DEFAULT 'MONTH',
  ADD COLUMN "closedOn" TIMESTAMP(3),
  ADD COLUMN "accountType" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
