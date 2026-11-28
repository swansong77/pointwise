import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CaptureService } from '../capture/capture.service';
import { PrismaService } from '../common/prisma.service';
import { channelScope } from '../common/channel-scope';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { senderDomains } from '../domain/email-alerts';
import { authservIdFor, MailboxConfig, MailboxConnector } from './connector';
import { GmailConnector, GraphConnector } from './oauth.connectors';
import { buildAuthUrl, credentialsFor, exchangeCode, FetchLike, KIND_PATH, newVerifier, OAuthError, OAuthKind, openState, redirectUri, revokeToken, sealState } from './oauth';
import { assertPublicHost } from './host-guard';
import { ImapConnector } from './imap.connector';

/** Google shows an app password as four groups of four letters with spaces; the spaces are not part of it. */
export const cleanPassword = (host: string, password: string) => (/(^|\.)(gmail|googlemail)\.com$/i.test(host.trim()) ? password.replace(/\s+/g, '') : password);

/** per person: the owner's household-wide mailboxes, and each member's own (or the ones the owner assigns to that member) */
export const MAX_MAILBOXES = 3;
const SINCE_DAYS = 30;
const MAX_PER_RUN = 60;

export interface ConnectDto {
  label: string;
  host: string;
  port?: number;
  username: string;
  password: string;
  folder?: string;
  /** the household member this mailbox feeds (owner only); omitted = the whole household */
  profileId?: string;
}

/**
 * Connected mailboxes (ADR-002). IMAP is supported; Gmail and Microsoft Graph OAuth adapters are not built
 * yet (docs/email-ingestion-research.md lists what must be verified first). The app password is encrypted at
 * rest; messages are read-only, filtered to card-issuer senders by envelope before any body is fetched,
 * processed in memory and never stored.
 */
@Injectable()
export class MailboxService {
  private readonly logger = new Logger(MailboxService.name);
  /** replaceable in tests */
  connectorFor: (cfg: MailboxConfig, rotate?: (token: string) => Promise<void>) => MailboxConnector = (cfg, rotate) => {
    if (cfg.kind === 'IMAP') return new ImapConnector(cfg);
    const kind = cfg.kind as OAuthKind;
    const creds = credentialsFor(kind);
    if (!creds) throw new Error('This sign-in is not configured on the server');
    const session = { kind, refreshToken: cfg.password, creds, fetch: this.oauthFetch, onRotate: rotate };
    return kind === 'GMAIL' ? new GmailConnector(session) : new GraphConnector(session);
  };
  /** replaceable in tests */
  oauthFetch: FetchLike = (url, init) => fetch(url, init as RequestInit) as never;

  constructor(
    private readonly prisma: PrismaService,
    private readonly capture: CaptureService,
  ) {}

  private view(m: { id: string; profile?: { id: string; nickname: string } | null; kind: string; label: string; host: string | null; port: number | null; username: string; folder: string; active: boolean; lastSyncAt: Date | null; lastStatus: string | null; lastError: string | null; processed: number; createdAt: Date }) {
    return {
      id: m.id,
      profile: m.profile ? { id: m.profile.id, nickname: m.profile.nickname } : null,
      kind: m.kind,
      label: m.label,
      host: m.host,
      port: m.port,
      username: m.username,
      folder: m.folder,
      active: m.active,
      lastSyncAt: m.lastSyncAt,
      lastStatus: m.lastStatus,
      lastError: m.lastError,
      processed: m.processed,
      createdAt: m.createdAt,
    };
  }

  async list(userId: string) {
    const rows = await this.prisma.mailbox.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { profile: { select: { id: true, nickname: true } } } });
    return rows.map((m) => this.view(m));
  }

  /** Who the mailbox feeds: a member's own is always their profile; an owner's is the whole household unless assigned to a member of theirs. */
  private async profileFor(userId: string, requested?: string | null): Promise<string | null> {
    const scope = await channelScope(this.prisma, userId, requested);
    if (requested && scope.profileId !== requested) throw new BadRequestException('Unknown household member');
    return scope.profileId;
  }

  async connect(userId: string, dto: ConnectDto) {
    const profileId = await this.profileFor(userId, dto.profileId);
    const count = await this.prisma.mailbox.count({ where: { userId, profileId } });
    if (count >= MAX_MAILBOXES) throw new BadRequestException(`You can connect up to ${MAX_MAILBOXES} mailboxes${profileId ? ' for this person' : ''}`);
    try {
      await assertPublicHost(dto.host);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const cfg: MailboxConfig = { kind: 'IMAP', host: dto.host.trim().toLowerCase(), port: dto.port ?? 993, username: dto.username.trim(), password: cleanPassword(dto.host, dto.password), folder: (dto.folder ?? 'INBOX').trim() };
    try {
      await this.connectorFor(cfg).verify();
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const dup = await this.prisma.mailbox.findUnique({ where: { userId_kind_username: { userId, kind: 'IMAP', username: cfg.username } } });
    if (dup) throw new BadRequestException('This mailbox is already connected');
    const row = await this.prisma.mailbox.create({
      include: { profile: { select: { id: true, nickname: true } } },
      data: { userId, profileId, kind: 'IMAP', label: dto.label.trim().slice(0, 60), host: cfg.host, port: cfg.port, username: cfg.username, folder: cfg.folder, secretEnc: encryptSecret(cfg.password) },
    });
    return this.view(row);
  }

  async disconnect(userId: string, id: string) {
    const m = await this.prisma.mailbox.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Mailbox not found');
    // Google lets us revoke the grant; Microsoft does not (the user removes it in their account settings)
    if (m.kind === 'GMAIL') await revokeToken('GMAIL', decryptSecret(m.secretEnc), this.oauthFetch);
    await this.prisma.mailbox.deleteMany({ where: { id, userId } });
  }

  // ───────── OAuth (Gmail, Outlook) ─────────

  /** Which sign-in options this server is configured for, and the redirect URI to register with the provider. */
  providers() {
    return { gmail: !!credentialsFor('GMAIL'), outlook: !!credentialsFor('GRAPH'), redirectUri: redirectUri() };
  }

  /** The provider's consent URL for this user. The state is sealed, expires in 10 minutes and names the user. */
  async startOAuth(userId: string, pathKind: string, requestedProfileId?: string): Promise<{ url: string }> {
    const kind = KIND_PATH[pathKind];
    if (!kind) throw new BadRequestException('Unknown provider');
    const creds = credentialsFor(kind);
    if (!creds) throw new BadRequestException('This sign-in is not set up on this server yet (see docs/email-ingestion-research.md)');
    const verifier = kind === 'GRAPH' ? newVerifier() : undefined;
    const profileId = (await this.profileFor(userId, requestedProfileId)) ?? undefined;
    return { url: buildAuthUrl(kind, creds.clientId, sealState({ userId, kind, verifier, profileId }), verifier) };
  }

  /** Completes the sign-in: exchanges the code, stores the encrypted refresh token and creates (or refreshes) the mailbox. */
  async finishOAuth(code: string | undefined, state: string | undefined, error?: string): Promise<{ ok: boolean; message?: string; member: boolean }> {
    const r = await this.finishOAuthInner(code, state, error);
    // a member returns to their own page, not the owner's Spending page
    const st = state ? openState(state) : null;
    const member = st ? !!(await this.prisma.profile.findUnique({ where: { loginUserId: st.userId }, select: { id: true } })) : false;
    return { ...r, member };
  }

  private async finishOAuthInner(code: string | undefined, state: string | undefined, error?: string): Promise<{ ok: boolean; message?: string }> {
    const st = state ? openState(state) : null;
    if (!st) return { ok: false, message: 'The sign-in link expired. Start again.' };
    if (error || !code) return { ok: false, message: error === 'access_denied' ? 'You declined access.' : 'The provider did not complete the sign-in.' };
    const creds = credentialsFor(st.kind);
    if (!creds) return { ok: false, message: 'This sign-in is not set up on this server.' };
    try {
      const tokens = await exchangeCode(st.kind, code, creds, st.verifier, this.oauthFetch);
      if (!tokens.refreshToken) return { ok: false, message: 'The provider did not grant offline access. Remove the app from your account permissions and try again.' };
      const cfg: MailboxConfig = { kind: st.kind, host: null, port: null, username: '', password: tokens.refreshToken, folder: st.kind === 'GMAIL' ? 'INBOX' : 'inbox' };
      const conn = this.connectorFor(cfg) as MailboxConnector & { address?: () => Promise<string> };
      const address = (await conn.address?.()) ?? 'account';
      const existing = await this.prisma.mailbox.findUnique({ where: { userId_kind_username: { userId: st.userId, kind: st.kind, username: address } } });
      if (existing) {
        await this.prisma.mailbox.update({ where: { id: existing.id }, data: { secretEnc: encryptSecret(tokens.refreshToken), active: true, lastStatus: null, lastError: null } });
        return { ok: true };
      }
      const profileId = await this.profileFor(st.userId, st.profileId);
      if ((await this.prisma.mailbox.count({ where: { userId: st.userId, profileId } })) >= MAX_MAILBOXES) return { ok: false, message: `You can connect up to ${MAX_MAILBOXES} mailboxes${profileId ? ' for this person' : ''}` };
      await this.prisma.mailbox.create({
        data: { userId: st.userId, profileId, kind: st.kind, label: st.kind === 'GMAIL' ? 'Gmail' : 'Outlook', username: address, folder: cfg.folder, secretEnc: encryptSecret(tokens.refreshToken) },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async syncNow(userId: string, id: string, now = new Date()) {
    const m = await this.prisma.mailbox.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Mailbox not found');
    return this.sync(m.id, now);
  }

  /** Worker job: every active mailbox, sequentially. Returns how many messages were processed. */
  async syncAll(now = new Date()): Promise<number> {
    const rows = await this.prisma.mailbox.findMany({ where: { active: true }, select: { id: true } });
    let n = 0;
    for (const r of rows) n += (await this.sync(r.id, now)).processed;
    return n;
  }

  async sync(id: string, now = new Date()): Promise<{ processed: number; skipped: number; status: string; more: boolean }> {
    const m = await this.prisma.mailbox.findUniqueOrThrow({ where: { id } });
    const cfg: MailboxConfig = { kind: m.kind, host: m.host, port: m.port, username: m.username, password: decryptSecret(m.secretEnc), folder: m.folder };
    let processed = 0;
    let skipped = 0;
    try {
      const rotate = async (token: string) => {
        await this.prisma.mailbox.update({ where: { id }, data: { secretEnc: encryptSecret(token) } });
      };
      const page = await this.connectorFor(cfg, rotate).fetchNew(m.cursor, { allowedDomains: senderDomains(), sinceDays: SINCE_DAYS, max: MAX_PER_RUN });
      const authserv = m.kind === 'GMAIL' ? 'mx.google.com' : authservIdFor(m.host);
      for (const msg of page.messages) {
        try {
          await this.capture.receiveFromMailbox(m.userId, msg.raw, authserv, now, m.profileId);
          processed++;
        } catch (e) {
          skipped++;
          this.logger.warn(`mailbox ${m.id}: message ${msg.id} skipped: ${(e as Error).message}`);
        }
      }
      await this.prisma.mailbox.update({
        where: { id },
        data: { cursor: page.cursor, lastSyncAt: now, lastStatus: 'OK', lastError: null, processed: { increment: processed } },
      });
      return { processed, skipped, status: 'OK', more: page.more };
    } catch (e) {
      // the cursor is left unchanged so nothing is lost; the next run retries
      const reconnect = e instanceof OAuthError && e.needsReconnect;
      await this.prisma.mailbox.update({ where: { id }, data: { lastSyncAt: now, lastStatus: reconnect ? 'RECONNECT' : 'ERROR', lastError: (e as Error).message.slice(0, 300) } });
      return { processed, skipped, status: reconnect ? 'RECONNECT' : 'ERROR', more: false };
    }
  }
}
