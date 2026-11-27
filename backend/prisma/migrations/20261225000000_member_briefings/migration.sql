-- A household member chooses their own daily and weekly briefing.
ALTER TABLE "NotificationPreference" ADD COLUMN "briefingDaily" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "briefingWeekly" BOOLEAN NOT NULL DEFAULT true;
