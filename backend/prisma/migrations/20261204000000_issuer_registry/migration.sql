-- Issuer registry for catalog coverage: institution kind and last research run
CREATE TYPE "IssuerKind" AS ENUM ('BANK', 'CREDIT_UNION', 'CARD_COMPANY', 'FINTECH');
ALTER TABLE "Issuer" ADD COLUMN "kind" "IssuerKind" NOT NULL DEFAULT 'BANK', ADD COLUMN "lastResearchedAt" TIMESTAMP(3);
