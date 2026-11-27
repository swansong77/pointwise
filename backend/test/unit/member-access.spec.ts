import { canHaveLogin, hashInviteToken, INVITE_TTL_DAYS, inviteExpiry, inviteState, loginStatus, newInviteToken } from '../../src/domain/member-access';

const NOW = new Date('2026-12-01T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const open = { expiresAt: day(3), usedAt: null, revokedAt: null };

describe('TC-MEMBER-DOM: member sign-in rules', () => {
  it('makes unguessable one-time tokens and stores only the hash', () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an invite is valid for 7 days from creation', () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(inviteExpiry(NOW).getTime() - NOW.getTime()).toBe(7 * 86_400_000);
  });

  it.each([
    ['open', open, 'ACTIVE'],
    ['used', { ...open, usedAt: NOW }, 'USED'],
    ['revoked', { ...open, revokedAt: NOW }, 'REVOKED'],
    ['expired', { ...open, expiresAt: day(-1) }, 'EXPIRED'],
    ['expires exactly now', { ...open, expiresAt: NOW }, 'EXPIRED'],
    ['used wins over revoked', { ...open, usedAt: NOW, revokedAt: NOW }, 'USED'],
  ])('invite state: %s', (_n, invite, expected) => {
    expect(inviteState(invite, NOW)).toBe(expected);
  });

  it('shows none, invited or active to the owner', () => {
    expect(loginStatus({ loginUserId: null }, [], NOW)).toBe('NONE');
    expect(loginStatus({ loginUserId: null }, [open], NOW)).toBe('INVITED');
    expect(loginStatus({ loginUserId: null }, [{ ...open, expiresAt: day(-1) }, { ...open, revokedAt: NOW }], NOW)).toBe('NONE');
    expect(loginStatus({ loginUserId: 'u1' }, [open], NOW)).toBe('ACTIVE');
  });

  it('the account owner does not get a member sign-in; everyone else may', () => {
    expect(canHaveLogin({ isPrimary: true })).toBe(false);
    expect(canHaveLogin({ isPrimary: false })).toBe(true);
  });
});
