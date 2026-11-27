-- The owner decides whether a member can edit their own cards and points, and whether the owner still hears about the member's items.
ALTER TABLE "Profile" ADD COLUMN "canEdit" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "notifyOwner" BOOLEAN NOT NULL DEFAULT true;
