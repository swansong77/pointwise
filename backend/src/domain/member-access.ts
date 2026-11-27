import { createHash, randomBytes } from 'crypto';

/**
 * Household members with their own sign-in. Pure rules, no database: invite tokens, their states, and who may have a login.
 * Design (docs/household-management.md): a member's own User row holds only their own channels (mailboxes, alert address,
 * notifications, briefings). Cards, loyalty and spending stay in the owner's account under the member's profile.
 */

export const INVITE_TTL_DAYS = 7;
export type MemberVisibility = 'OWN' | 'HOUSEHOLD';
export const VISIBILITIES: MemberVisibility[] = ['OWN', 'HOUSEHOLD'];

/** A new one-time token (shown once, to the owner) and the hash that is stored. */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type InviteState = 'ACTIVE' | 'USED' | 'REVOKED' | 'EXPIRED';

export function inviteState(i: { expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }, now: Date = new Date()): InviteState {
  if (i.usedAt) return 'USED';
  if (i.revokedAt) return 'REVOKED';
  if (i.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export type LoginStatus = 'NONE' | 'INVITED' | 'ACTIVE';

/** What the owner sees for a member: no sign-in, an open invite, or a working sign-in. */
export function loginStatus(
  profile: { loginUserId: string | null },
  invites: Array<{ expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }>,
  now: Date = new Date(),
): LoginStatus {
  if (profile.loginUserId) return 'ACTIVE';
  return invites.some((i) => inviteState(i, now) === 'ACTIVE') ? 'INVITED' : 'NONE';
}

/** The owner is the account itself; every other member may be given a sign-in. */
export function canHaveLogin(profile: { isPrimary: boolean }): boolean {
  return !profile.isPrimary;
}

export const inviteExpiry = (now: Date = new Date()): Date => new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000);

/** What a signed-in member is: carried on the request by the guard, resolved live from the database on every request. */
export interface MemberContext {
  ownerId: string;
  profileId: string;
  visibility: MemberVisibility;
  nickname: string;
}
