-- A mailbox can feed one household member's data instead of the whole household.
ALTER TABLE "Mailbox" ADD COLUMN "profileId" TEXT;
CREATE INDEX "Mailbox_profileId_idx" ON "Mailbox"("profileId");
ALTER TABLE "Mailbox" ADD CONSTRAINT "Mailbox_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
