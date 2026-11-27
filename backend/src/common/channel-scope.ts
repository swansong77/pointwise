import { PrismaService } from './prisma.service';

/**
 * Where the data from an inbound channel (a connected mailbox, a forwarding address) goes. The channel belongs to one user
 * (`channelUserId`): the household owner, or a household member with their own sign-in. The data it carries (transactions,
 * loyalty updates) always lands in the owner's account, pinned to a member's profile when the channel is a member's.
 */
export interface ChannelScope {
  /** whose mailbox or address it is, and whose review queue the messages appear in */
  channelUserId: string;
  /** whose account holds the data */
  ownerId: string;
  /** null = every member of the household; set = only this member's cards and accounts */
  profileId: string | null;
}

/**
 * A member's own channel is always pinned to their profile. An owner's channel is household-wide unless the owner assigned
 * it to one member (`assignedProfileId`, which must belong to that owner).
 */
export async function channelScope(prisma: PrismaService, channelUserId: string, assignedProfileId?: string | null): Promise<ChannelScope> {
  const link = await prisma.profile.findUnique({ where: { loginUserId: channelUserId }, select: { id: true, userId: true } });
  if (link) return { channelUserId, ownerId: link.userId, profileId: link.id };
  if (assignedProfileId) {
    const p = await prisma.profile.findFirst({ where: { id: assignedProfileId, userId: channelUserId }, select: { id: true } });
    if (p) return { channelUserId, ownerId: channelUserId, profileId: p.id };
  }
  return { channelUserId, ownerId: channelUserId, profileId: null };
}

/** The wallet-card filter for a scope: all of the owner's cards, or only one member's. */
export const scopedCards = (s: Pick<ChannelScope, 'ownerId' | 'profileId'>) => ({ wallet: { userId: s.ownerId }, ...(s.profileId && { profileId: s.profileId }) });
