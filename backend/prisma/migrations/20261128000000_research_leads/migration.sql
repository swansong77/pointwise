-- Card research: lead sites (card news / community) and the NEWS scan task
ALTER TYPE "CardResearchKind" ADD VALUE 'NEWS';
ALTER TABLE "CardResearchRun" ADD COLUMN "useLeads" BOOLEAN NOT NULL DEFAULT true;
