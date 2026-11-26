import { SpendCoreModule } from "../spend/spend.module";
import { SpendService } from "../spend/spend.service";
import { classify } from "../domain/spend";
import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Headers,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiProperty,
  ApiTags,
} from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { Request } from "express";
import { IsString, MaxLength, MinLength } from "class-validator";
import {
  createHash,
  createPublicKey,
  KeyObject,
  randomUUID,
  verify as verifySignature,
} from "crypto";
import { AuthUser, CurrentUser, Public } from "../common/decorators";
import { decryptSecret, encryptSecret } from "../common/crypto";
import { PrismaService } from "../common/prisma.service";
import { limitsFor } from "../domain/entitlements";
import {
  BUSINESS_REPORTS_TO_PERSONAL,
  canonicalIssuer,
  matchExisting,
} from "../domain/import";
import { HouseholdsModule, HouseholdsService } from "./households";

/** A credit account as returned by an aggregator. Aggregators do NOT provide open dates or annual fees. */
export interface BankAccount {
  externalId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  creditLimitCents: number | null;
}

/** A posted card transaction from an aggregator. */
export interface BankTransaction {
  externalId: string;
  accountId: string;
  date: Date;
  description: string;
  merchantName: string | null;
  /** positive = money spent (aggregator convention), negative = payment / credit / refund */
  signedCents: number;
  category: string | null;
  pending: boolean;
}

export interface BankTransactionPage {
  added: BankTransaction[];
  modified: BankTransaction[];
  removed: string[];
  nextCursor: string;
  hasMore: boolean;
}

/** Provider-neutral bank connector (Plaid today; MX / Finicity would implement the same). */
export interface BankConnector {
  readonly provider: "PLAID";
  /** with an access token: update mode (the user signs in again to repair the connection) */
  createLinkToken(
    userId: string,
    opts?: { accessToken?: string },
  ): Promise<string>;
  /** public key (JWK) that signs webhooks, by key id (optional capability) */
  webhookKey?(keyId: string): Promise<Record<string, unknown>>;
  exchange(publicToken: string): Promise<{
    itemId: string;
    accessToken: string;
    institutionName: string | null;
  }>;
  creditAccounts(
    accessToken: string,
  ): Promise<{ institutionName: string | null; accounts: BankAccount[] }>;
  remove(accessToken: string): Promise<void>;
  /** sandbox only: a public token without the Link UI */
  sandboxPublicToken(): Promise<string>;
  /** incremental card transactions since `cursor` (optional capability) */
  transactionsSync?(
    accessToken: string,
    cursor: string | null,
  ): Promise<BankTransactionPage>;
}

export class ExchangeDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(200) publicToken: string;
}

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

/** Minimal Plaid REST client (fetch). Docs: plaid.com/docs/api — products: liabilities. */
export class PlaidConnector implements BankConnector {
  readonly provider = "PLAID" as const;
  private readonly logger = new Logger("Plaid");
  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    readonly env: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await this.fetchFn(
      `${PLAID_HOSTS[this.env] ?? PLAID_HOSTS.sandbox}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.clientId,
          secret: this.secret,
          ...body,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as T & {
      error_code?: string;
      error_message?: string;
    };
    if (!res.ok) {
      this.logger.warn(`${path} failed: ${json.error_code ?? res.status}`);
      throw new BadGatewayException(
        `Bank provider error: ${json.error_code ?? res.status}`,
      );
    }
    return json;
  }

  async createLinkToken(userId: string, opts: { accessToken?: string } = {}) {
    const r = await this.call<{ link_token: string }>("/link/token/create", {
      client_name: "PointWise",
      user: { client_user_id: userId },
      ...(opts.accessToken
        ? { access_token: opts.accessToken }
        : { products: ["liabilities", "transactions"] }),
      country_codes: ["US"],
      language: "en",
      ...(process.env.PLAID_WEBHOOK_URL && {
        webhook: process.env.PLAID_WEBHOOK_URL,
      }),
    });
    return r.link_token;
  }

  async webhookKey(keyId: string) {
    const r = await this.call<{ key: Record<string, unknown> }>(
      "/webhook_verification_key/get",
      { key_id: keyId },
    );
    return r.key;
  }

  async exchange(publicToken: string) {
    const r = await this.call<{ access_token: string; item_id: string }>(
      "/item/public_token/exchange",
      { public_token: publicToken },
    );
    return {
      itemId: r.item_id,
      accessToken: r.access_token,
      institutionName: null,
    };
  }

  async creditAccounts(accessToken: string) {
    const r = await this.call<{
      accounts: Array<{
        account_id: string;
        name: string;
        official_name: string | null;
        mask: string | null;
        type: string;
        subtype: string | null;
        balances: { limit: number | null };
      }>;
      item?: { institution_name?: string | null };
    }>("/liabilities/get", { access_token: accessToken });
    return {
      institutionName: r.item?.institution_name ?? null,
      accounts: r.accounts
        .filter(
          (a) =>
            a.type === "credit" &&
            (a.subtype ?? "credit card") === "credit card",
        )
        .map((a) => ({
          externalId: a.account_id,
          name: a.name,
          officialName: a.official_name,
          mask: a.mask,
          creditLimitCents:
            a.balances.limit == null
              ? null
              : Math.round(a.balances.limit * 100),
        })),
    };
  }

  async remove(accessToken: string) {
    await this.call("/item/remove", { access_token: accessToken });
  }

  async transactionsSync(
    accessToken: string,
    cursor: string | null,
  ): Promise<BankTransactionPage> {
    type PlaidTx = {
      transaction_id: string;
      account_id: string;
      amount: number;
      date: string;
      name: string;
      merchant_name?: string | null;
      pending: boolean;
      personal_finance_category?: {
        primary?: string;
        detailed?: string;
      } | null;
      category?: string[] | null;
    };
    const r = await this.call<{
      added: PlaidTx[];
      modified: PlaidTx[];
      removed: Array<{ transaction_id: string }>;
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: accessToken,
      ...(cursor && { cursor }),
      count: 500,
    });
    const map = (x: PlaidTx): BankTransaction => ({
      externalId: `plaid:${x.transaction_id}`,
      accountId: x.account_id,
      date: new Date(`${x.date}T00:00:00Z`),
      description: x.name,
      merchantName: x.merchant_name ?? null,
      signedCents: Math.round(x.amount * 100),
      category:
        x.personal_finance_category?.detailed ??
        x.personal_finance_category?.primary ??
        x.category?.join(" / ") ??
        null,
      pending: x.pending,
    });
    return {
      added: r.added.map(map),
      modified: r.modified.map(map),
      removed: r.removed.map((x) => `plaid:${x.transaction_id}`),
      nextCursor: r.next_cursor,
      hasMore: r.has_more,
    };
  }

  async sandboxPublicToken() {
    const r = await this.call<{ public_token: string }>(
      "/sandbox/public_token/create",
      {
        institution_id: "ins_109508",
        initial_products: ["liabilities", "transactions"],
      },
    );
    return r.public_token;
  }
}

export const BANK_CONNECTOR = "BANK_CONNECTOR";

export function connectorFromEnv(env = process.env): BankConnector | null {
  if (
    (env.BANK_PROVIDER ?? "none") !== "plaid" ||
    !env.PLAID_CLIENT_ID ||
    !env.PLAID_SECRET
  )
    return null;
  return new PlaidConnector(
    env.PLAID_CLIENT_ID,
    env.PLAID_SECRET,
    env.PLAID_ENV ?? "sandbox",
  );
}

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  readonly connector: BankConnector | null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
    connector?: BankConnector | null,
    private readonly spend?: SpendService,
  ) {
    this.connector = connector === undefined ? connectorFromEnv() : connector;
  }

  private need(): BankConnector {
    if (!this.connector)
      throw new ServiceUnavailableException(
        "Bank connections are not configured on this server (BANK_PROVIDER=plaid + PLAID_* keys).",
      );
    return this.connector;
  }

  status() {
    const c = this.connector as PlaidConnector | null;
    return {
      enabled: !!c,
      provider: c?.provider ?? null,
      environment: c?.env ?? null,
      sandbox: c?.env === "sandbox",
    };
  }

  list(userId: string) {
    return this.prisma.bankConnection.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        institutionName: true,
        lastSyncedAt: true,
        lastTxSyncAt: true,
        needsReauth: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async linkToken(userId: string) {
    return { linkToken: await this.need().createLinkToken(userId) };
  }

  /** Link token in update mode: the user signs in to the bank again; then call relinked(). */
  async relinkToken(userId: string, id: string) {
    const conn = await this.owned(userId, id);
    return {
      linkToken: await this.need().createLinkToken(userId, {
        accessToken: decryptSecret(conn.accessTokenEnc),
      }),
    };
  }

  async relinked(userId: string, id: string) {
    await this.owned(userId, id);
    await this.prisma.bankConnection.update({
      where: { id },
      data: { needsReauth: false, lastError: null },
    });
    return this.sync(userId, id);
  }

  private keys = new Map<string, { key: KeyObject; at: number }>();

  /**
   * Plaid webhook: verifies the Plaid-Verification JWT (ES256, ≤ 5 minutes old, signed body hash),
   * then syncs new transactions or marks a connection that needs the user to sign in again.
   */
  async webhook(rawBody: Buffer, verification: string | undefined) {
    const c = this.connector;
    if (!c?.webhookKey)
      throw new ServiceUnavailableException(
        "Bank connections are not configured",
      );
    if (!verification)
      throw new ForbiddenException("Missing Plaid-Verification");
    let claims: { request_body_sha256?: string };
    try {
      const [h, p, s] = verification.split(".");
      if (!h || !p || !s) throw new Error("malformed token");
      const header = JSON.parse(
        Buffer.from(h, "base64url").toString("utf8"),
      ) as { alg?: string; kid?: string };
      if (header.alg !== "ES256" || !header.kid)
        throw new Error("unexpected algorithm");
      let cached = this.keys.get(header.kid);
      if (!cached || Date.now() - cached.at > 3_600_000) {
        cached = {
          key: createPublicKey({
            key: (await c.webhookKey(header.kid)) as never,
            format: "jwk",
          }),
          at: Date.now(),
        };
        this.keys.set(header.kid, cached);
      }
      const ok = verifySignature(
        "sha256",
        Buffer.from(`${h}.${p}`),
        { key: cached.key, dsaEncoding: "ieee-p1363" },
        Buffer.from(s, "base64url"),
      );
      if (!ok) throw new Error("bad signature");
      claims = JSON.parse(
        Buffer.from(p, "base64url").toString("utf8"),
      ) as typeof claims & { iat?: number };
      const iat = (claims as { iat?: number }).iat;
      if (!iat || Math.abs(Date.now() / 1000 - iat) > 300)
        throw new Error("token too old");
    } catch (e) {
      this.logger.warn(`plaid webhook rejected: ${(e as Error).message}`);
      throw new ForbiddenException("Invalid webhook signature");
    }
    const hash = createHash("sha256").update(rawBody).digest("hex");
    if (!claims.request_body_sha256 || claims.request_body_sha256 !== hash)
      throw new ForbiddenException("Webhook body does not match its signature");
    const body = JSON.parse(rawBody.toString("utf8")) as {
      webhook_type?: string;
      webhook_code?: string;
      item_id?: string;
      error?: { error_code?: string } | null;
    };
    const conn = body.item_id
      ? await this.prisma.bankConnection.findFirst({
          where: { provider: c.provider, itemId: body.item_id },
        })
      : null;
    if (!conn) return { handled: false };
    const type = `${body.webhook_type}/${body.webhook_code}`;
    if (body.webhook_type === "TRANSACTIONS") {
      void this.syncTransactions(
        conn.userId,
        conn.id,
        decryptSecret(conn.accessTokenEnc),
        conn.txCursor ?? null,
      ).catch((e) =>
        this.logger.warn(`webhook sync failed: ${(e as Error).message}`),
      );
      return { handled: true, type };
    }
    if (
      type === "ITEM/ERROR" ||
      type === "ITEM/PENDING_EXPIRATION" ||
      type === "ITEM/PENDING_DISCONNECT"
    ) {
      await this.prisma.bankConnection.update({
        where: { id: conn.id },
        data: {
          needsReauth: true,
          lastError:
            body.error?.error_code ?? body.webhook_code ?? "ITEM_ERROR",
        },
      });
      return { handled: true, type };
    }
    if (type === "ITEM/LOGIN_REPAIRED") {
      await this.prisma.bankConnection.update({
        where: { id: conn.id },
        data: { needsReauth: false, lastError: null },
      });
      return { handled: true, type };
    }
    return { handled: false, type };
  }

  async connect(userId: string, publicToken: string) {
    const c = this.need();
    const { itemId, accessToken } = await c.exchange(publicToken);
    const conn = await this.prisma.bankConnection.upsert({
      where: { provider_itemId: { provider: c.provider, itemId } },
      update: { accessTokenEnc: encryptSecret(accessToken), userId },
      create: {
        userId,
        provider: c.provider,
        itemId,
        accessTokenEnc: encryptSecret(accessToken),
      },
    });
    const sync = await this.sync(userId, conn.id);
    return { id: conn.id, ...sync };
  }

  /** Sandbox convenience: create a test item without the Link UI and connect it. */
  async connectSandbox(userId: string) {
    const c = this.need();
    if ((c as PlaidConnector).env !== "sandbox")
      throw new ForbiddenException("Only available in the Plaid sandbox");
    return this.connect(userId, await c.sandboxPublicToken());
  }

  private async owned(userId: string, id: string) {
    const conn = await this.prisma.bankConnection.findUnique({ where: { id } });
    if (!conn || conn.userId !== userId)
      throw new NotFoundException("Connection not found");
    return conn;
  }

  /** Pull credit-card accounts and create/update wallet cards (source BANK). */
  async sync(userId: string, id: string, now = new Date()) {
    const c = this.need();
    const conn = await this.owned(userId, id);
    const { institutionName, accounts } = await c.creditAccounts(
      decryptSecret(conn.accessTokenEnc),
    );
    const primary = await this.households.primary(userId);
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const existingRows = await this.prisma.walletCard.findMany({
      where: { walletId: wallet.id },
      include: { card: { include: { issuer: true } } },
    });
    const existing = existingRows.map((w) => ({
      id: w.id,
      cardName: w.nickname || w.card.name,
      issuer: w.card.issuer.name,
      lastDigits: w.lastFour,
      owner: primary.nickname,
    }));
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    const limits = limitsFor(sub, now);
    const issuerName =
      institutionName ?? conn.institutionName ?? "Connected bank";
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const a of accounts) {
      const bySource = existingRows.find(
        (w) => w.source === "BANK" && w.sourceRef === a.externalId,
      );
      const match = bySource
        ? { id: bySource.id }
        : matchExisting(
            {
              cardName: a.officialName ?? a.name,
              issuer: issuerName,
              lastDigits: a.mask,
              owner: primary.nickname,
            },
            existing,
          );
      const meta = {
        provider: c.provider,
        connectionId: conn.id,
        accountId: a.externalId,
        syncedAt: now.toISOString(),
      };
      if (match) {
        const cur = existingRows.find((w) => w.id === match.id);
        await this.prisma.walletCard.update({
          where: { id: match.id },
          data: {
            creditLimitCents: a.creditLimitCents,
            lastFour: cur?.lastFour ?? a.mask,
            sourceMeta: meta,
            ...(cur?.source === "MANUAL" ? {} : { sourceRef: a.externalId }),
          },
        });
        updated++;
        continue;
      }
      if (existingRows.length + created >= limits.maxCards) {
        skipped++;
        continue;
      }
      const issuer = await this.prisma.issuer.upsert({
        where: { name: issuerName },
        update: {},
        create: {
          name: issuerName,
          businessReportsToPersonal: BUSINESS_REPORTS_TO_PERSONAL.has(
            canonicalIssuer(issuerName),
          ),
        },
      });
      const cash = await this.prisma.rewardCurrency.findFirst({
        where: { isCash: true },
      });
      if (!cash) throw new ServiceUnavailableException("Catalog is not seeded");
      const card = await this.prisma.creditCard.create({
        data: {
          slug: `u-${randomUUID()}`,
          name: (a.officialName ?? a.name).slice(0, 120),
          issuerId: issuer.id,
          network: "OTHER",
          currencyId: cash.id,
          isActive: false,
          ownerId: userId,
        },
      });
      await this.prisma.walletCard.create({
        data: {
          walletId: wallet.id,
          cardId: card.id,
          profileId: primary.id,
          lastFour: a.mask,
          creditLimitCents: a.creditLimitCents,
          source: "BANK",
          sourceRef: a.externalId,
          sourceMeta: meta,
          sortOrder: existingRows.length + created,
        },
      });
      created++;
    }
    const transactions = await this.syncTransactions(
      userId,
      conn.id,
      decryptSecret(conn.accessTokenEnc),
      conn.txCursor ?? null,
    );
    await this.prisma.bankConnection.update({
      where: { id },
      data: { lastSyncedAt: now, institutionName: issuerName },
    });
    return {
      accounts: accounts.length,
      created,
      updated,
      skipped,
      transactions,
      note: "Banks do not share open dates or annual fees — add them on the card to include it in 5/24.",
    };
  }

  /**
   * Posted card transactions since the stored cursor → spend tracking (dedupe by bank id, benefits
   * updated automatically). Pending transactions wait until they post; removed ones are deleted.
   */
  private async syncTransactions(
    userId: string,
    connectionId: string,
    accessToken: string,
    cursor: string | null,
  ) {
    const c = this.connector;
    if (!c?.transactionsSync || !this.spend) return null;
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: {
        cards: { select: { id: true, sourceRef: true, sourceMeta: true } },
      },
    });
    const cardFor = new Map<string, string>();
    for (const w of wallet?.cards ?? []) {
      const meta = (w.sourceMeta ?? {}) as {
        accountId?: string;
        connectionId?: string;
      };
      if (
        meta.accountId &&
        (!meta.connectionId || meta.connectionId === connectionId)
      )
        cardFor.set(meta.accountId, w.id);
      else if (w.sourceRef) cardFor.set(w.sourceRef, w.id);
    }
    const posted = new Map<string, BankTransaction[]>();
    const removed: string[] = [];
    let next = cursor;
    let pages = 0;
    try {
      for (let more = true; more && pages < 20; pages++) {
        const page = await c.transactionsSync(accessToken, next);
        for (const t of [...page.added, ...page.modified]) {
          const wc = cardFor.get(t.accountId);
          if (!wc || t.pending || t.signedCents === 0) continue;
          posted.set(wc, [...(posted.get(wc) ?? []), t]);
        }
        removed.push(...page.removed);
        next = page.nextCursor;
        more = page.hasMore;
      }
    } catch (e) {
      const msg = (e as Error).message;
      this.logger.warn(`transactions sync failed for ${connectionId}: ${msg}`);
      const reauth =
        /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|INVALID_CREDENTIALS/.test(msg);
      await this.prisma.bankConnection.update({
        where: { id: connectionId },
        data: {
          lastError: msg.slice(0, 200),
          ...(reauth && { needsReauth: true }),
        },
      });
      return {
        error: reauth
          ? "The bank needs you to sign in again"
          : "Transactions could not be synced this time",
      };
    }
    let imported = 0;
    let benefitUpdates = 0;
    for (const [walletCardId, txs] of posted) {
      const r = await this.spend.ingest(
        userId,
        walletCardId,
        txs.map((t) => ({
          occurredAt: t.date,
          description: t.merchantName ?? t.description,
          merchantName: t.merchantName,
          amountCents: Math.abs(t.signedCents),
          kind: classify(t.description, t.signedCents),
          externalId: t.externalId,
          bankCategory: t.category,
        })),
        "BANK",
      );
      imported += r.imported;
      benefitUpdates += r.benefitUpdates.length;
    }
    const del = removed.length
      ? await this.prisma.transaction.deleteMany({
          where: { userId, externalId: { in: removed } },
        })
      : { count: 0 };
    // usage confirmed by a credit the bank removed goes back to expected
    if (del.count)
      await this.prisma.benefitUsage.updateMany({
        where: {
          creditTransactionId: null,
          status: "CONFIRMED",
          source: "AUTO_PURCHASE",
          userBenefit: { walletCard: { wallet: { userId } } },
        },
        data: { status: "EXPECTED" },
      });
    await this.prisma.bankConnection.update({
      where: { id: connectionId },
      data: {
        txCursor: next,
        lastTxSyncAt: new Date(),
        needsReauth: false,
        lastError: null,
      },
    });
    return { imported, removed: del.count, benefitUpdates, pages };
  }

  async disconnect(userId: string, id: string): Promise<void> {
    const conn = await this.owned(userId, id);
    if (this.connector) {
      try {
        await this.connector.remove(decryptSecret(conn.accessTokenEnc));
      } catch (e) {
        this.logger.warn(
          `provider removal failed for ${id}: ${(e as Error).message}`,
        );
      }
    }
    await this.prisma.bankConnection.delete({ where: { id } });
  }

  /** Worker job: re-sync every connection. */
  async syncAll(now = new Date()): Promise<number> {
    if (!this.connector) return 0;
    const conns = await this.prisma.bankConnection.findMany({
      select: { id: true, userId: true },
    });
    let n = 0;
    for (const c of conns) {
      try {
        await this.sync(c.userId, c.id, now);
        n++;
      } catch (e) {
        this.logger.warn(`sync ${c.id} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }
}

@ApiTags("connections")
@ApiBearerAuth()
@Controller("connections")
export class ConnectionsController {
  constructor(private readonly svc: ConnectionsService) {}

  @Get("status") status() {
    return this.svc.status();
  }
  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.sub);
  }
  @Post("plaid/link-token") link(@CurrentUser() u: AuthUser) {
    return this.svc.linkToken(u.sub);
  }
  @Post("plaid/exchange") exchange(
    @CurrentUser() u: AuthUser,
    @Body() dto: ExchangeDto,
  ) {
    return this.svc.connect(u.sub, dto.publicToken);
  }
  @Post("plaid/sandbox") sandbox(@CurrentUser() u: AuthUser) {
    return this.svc.connectSandbox(u.sub);
  }
  /** Plaid → PointWise webhook (new transactions, sign-in needed). Signature-verified; no user token. */
  @Public()
  @SkipThrottle()
  @Post("plaid/webhook")
  @HttpCode(200)
  @ApiExcludeEndpoint()
  webhook(
    @Req() req: Request,
    @Headers("plaid-verification") verification?: string,
  ) {
    return this.svc.webhook(
      Buffer.isBuffer(req.body) ? req.body : Buffer.from(""),
      verification,
    );
  }
  @Post(":id/relink-token") @HttpCode(200) relink(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.relinkToken(u.sub, id);
  }
  @Post(":id/relinked") @HttpCode(200) relinked(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.relinked(u.sub, id);
  }
  @Post(":id/sync") sync(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.sync(u.sub, id);
  }
  @Delete(":id") @HttpCode(204) remove(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.disconnect(u.sub, id);
  }
}

@Module({
  imports: [HouseholdsModule, SpendCoreModule],
  controllers: [ConnectionsController],
  providers: [
    {
      provide: ConnectionsService,
      useFactory: (p: PrismaService, h: HouseholdsService, s: SpendService) =>
        new ConnectionsService(p, h, undefined, s),
      inject: [PrismaService, HouseholdsService, SpendService],
    },
  ],
  exports: [ConnectionsService],
})
export class ConnectionsModule {}
