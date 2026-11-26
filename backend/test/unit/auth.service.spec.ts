import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService, sha256 } from '../../src/auth/auth.service';
import { configMock, createPrismaMock, PrismaMock } from './prisma-mock';

describe('AuthService', () => {
  let prisma: PrismaMock;
  let mail: { send: jest.Mock };
  let svc: AuthService;
  const user = { id: 'u1', email: 'a@b.co', name: 'A', role: 'USER', passwordHash: '', deletedAt: null, emailVerified: null };

  beforeEach(async () => {
    prisma = createPrismaMock();
    mail = { send: jest.fn().mockResolvedValue(true) };
    svc = new AuthService(prisma as never, new JwtService({}), configMock() as never, mail as never);
    prisma.refreshToken.create.mockResolvedValue({});
    prisma.analyticsEvent.create.mockResolvedValue({});
    user.passwordHash = await argon2.hash('correct-horse-1', { type: argon2.argon2id });
  });

  describe('register', () => {
    it('creates user and returns tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(user);
      const res = await svc.register({ email: 'a@b.co', password: 'correct-horse-1', name: 'A' });
      expect(res.accessToken).toBeTruthy();
      expect(res.refreshToken.length).toBeGreaterThan(40);
      expect(res.user).toEqual({ id: 'u1', email: 'a@b.co', name: 'A', role: 'USER' });
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(data.wallet).toEqual({ create: {} });
      expect(data.subscription.create.plan).toBe('FREE');
      // refresh token stored hashed, never plaintext
      expect(prisma.refreshToken.create.mock.calls[0][0].data.tokenHash).toBe(sha256(res.refreshToken));
    });
    it('rejects duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(svc.register({ email: 'a@b.co', password: 'x' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('accepts correct password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(svc.login('a@b.co', 'correct-horse-1')).resolves.toHaveProperty('accessToken');
    });
    it('rejects wrong password, unknown user, deleted user and oauth-only user with the same error', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user);
      await expect(svc.login('a@b.co', 'nope')).rejects.toThrow('Invalid email or password');
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await expect(svc.login('x@b.co', 'nope')).rejects.toThrow('Invalid email or password');
      prisma.user.findUnique.mockResolvedValueOnce({ ...user, deletedAt: new Date() });
      await expect(svc.login('a@b.co', 'correct-horse-1')).rejects.toThrow('Invalid email or password');
      prisma.user.findUnique.mockResolvedValueOnce({ ...user, passwordHash: null });
      await expect(svc.login('a@b.co', 'correct-horse-1')).rejects.toThrow('Invalid email or password');
    });
  });

  describe('refresh', () => {
    const stored = (over: Record<string, unknown> = {}) => ({
      id: 'rt1', userId: 'u1', familyId: 'fam', revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user, ...over,
    });
    it('rotates the token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored());
      prisma.refreshToken.update.mockResolvedValue({});
      const res = await svc.refresh('old-token-xxxxxxxxxxxxxxxxxxxx');
      expect(res.accessToken).toBeTruthy();
      expect(prisma.refreshToken.create.mock.calls[0][0].data.familyId).toBe('fam');
      expect(prisma.refreshToken.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
    });
    it('detects reuse and revokes the family', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date() }));
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
      await expect(svc.refresh('reused')).rejects.toThrow('reuse');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: 'fam', revokedAt: null } }));
    });
    it('rejects unknown and expired tokens', async () => {
      prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
      await expect(svc.refresh('unknown')).rejects.toBeInstanceOf(UnauthorizedException);
      prisma.refreshToken.findUnique.mockResolvedValueOnce(stored({ expiresAt: new Date(Date.now() - 1) }));
      await expect(svc.refresh('expired')).rejects.toThrow('expired');
    });
  });

  it('logout revokes family; unknown token is a no-op', async () => {
    prisma.refreshToken.findUnique.mockResolvedValueOnce({ familyId: 'fam' });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await svc.logout('t');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
    prisma.refreshToken.findUnique.mockResolvedValueOnce(null);
    await svc.logout('t2');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
  });

  describe('oauthExchange', () => {
    const dto = { provider: 'google' as const, providerAccountId: 'g-1', email: 'a@b.co', name: 'A' };
    it('rejects a bad internal secret', async () => {
      await expect(svc.oauthExchange(dto, 'wrong')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.oauthExchange(dto, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('logs in an existing linked account', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue({ user });
      await expect(svc.oauthExchange(dto, 'internal-secret-for-tests')).resolves.toHaveProperty('accessToken');
      expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    });
    it('links to an existing user by email and verifies email', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.oAuthAccount.create.mockResolvedValue({});
      prisma.user.update.mockResolvedValue({ ...user, emailVerified: new Date() });
      await svc.oauthExchange(dto, 'internal-secret-for-tests');
      expect(prisma.oAuthAccount.create).toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
    });
    it('creates a new user when none exists', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...user, emailVerified: new Date() });
      prisma.oAuthAccount.create.mockResolvedValue({});
      await svc.oauthExchange(dto, 'internal-secret-for-tests');
      expect(prisma.user.create).toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
    it('rejects deleted accounts', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue({ user: { ...user, deletedAt: new Date() } });
      await expect(svc.oauthExchange(dto, 'internal-secret-for-tests')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('password reset', () => {
    it('forgotPassword emails a link for known users only', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user);
      prisma.passwordResetToken.create.mockResolvedValue({});
      await svc.forgotPassword('a@b.co');
      expect(mail.send).toHaveBeenCalledWith('a@b.co', expect.any(String), expect.stringContaining('/reset-password?token='));
      prisma.user.findUnique.mockResolvedValueOnce(null);
      await svc.forgotPassword('nobody@b.co');
      expect(mail.send).toHaveBeenCalledTimes(1);
    });
    it('resetPassword updates hash and revokes sessions', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({ id: 'p', userId: 'u1', usedAt: null, expiresAt: new Date(Date.now() + 1000) });
      prisma.user.update.mockResolvedValue({});
      prisma.passwordResetToken.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({});
      await svc.resetPassword('token-abcdefghijklmnopqrstuvwxyz', 'new-password-1');
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
    });
    it('resetPassword rejects used/expired/unknown tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce(null);
      await expect(svc.resetPassword('t', 'p')).rejects.toBeInstanceOf(UnauthorizedException);
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ usedAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
      await expect(svc.resetPassword('t', 'p')).rejects.toBeInstanceOf(UnauthorizedException);
      prisma.passwordResetToken.findUnique.mockResolvedValueOnce({ usedAt: null, expiresAt: new Date(Date.now() - 1000) });
      await expect(svc.resetPassword('t', 'p')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
