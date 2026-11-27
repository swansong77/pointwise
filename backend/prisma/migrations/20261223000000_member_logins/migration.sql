-- Household members can have their own sign-in. The member's User row holds only their own channels; cards, loyalty and spending stay with the household owner.
CREATE TYPE "MemberVisibility" AS ENUM ('OWN', 'HOUSEHOLD');

ALTER TABLE "Profile"
  ADD COLUMN "loginUserId" TEXT,
  ADD COLUMN "visibility" "MemberVisibility" NOT NULL DEFAULT 'OWN',
  ADD COLUMN "loginSince" TIMESTAMP(3);

CREATE UNIQUE INDEX "Profile_loginUserId_key" ON "Profile"("loginUserId");
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_loginUserId_fkey" FOREIGN KEY ("loginUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MemberInvite" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberInvite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MemberInvite_tokenHash_key" ON "MemberInvite"("tokenHash");
CREATE INDEX "MemberInvite_profileId_idx" ON "MemberInvite"("profileId");
ALTER TABLE "MemberInvite" ADD CONSTRAINT "MemberInvite_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
