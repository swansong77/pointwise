import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { TransactionKind } from "@prisma/client";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { simpleParser } from "mailparser";
import { PrismaService } from "../common/prisma.service";
import { htmlToText } from "../domain/card-extract";
import {
  domainOf,
  gmailForwardingConfirmation,
  inboxToken,
  parseAlert,
  senderAllowed,
  senderAuth,
  senderDomains,
  statementDigits,
} from "../domain/email-alerts";
import { classifyMail, MAIL_KIND_LABEL } from "../domain/mail-classify";
import { issuerNameForDomain } from "../domain/offer-mail";
import { OfferAutomationService } from "../offer-automation/offer-automation.service";
import { StatementError } from "../domain/spend";
import { extractPdfLines } from "../spend/pdf-extract";
import { SpendService } from "../spend/spend.service";
import { evidenceHashOf, LoyaltyIngestService } from "../loyalty/loyalty-ingest.service";
import { parseLoyaltyEmail, programForDomain, ProgramRule } from "../domain/loyalty-email";
import { parseLoyaltyStatement } from "../domain/loyalty-statement";

const DAY = 86_400_000;
const KEEP_DAYS = 90;
const STALE_DAYS = 21;

/** stores one inbound item's parsed facts (never the email body) */
type RecordFn = (data: Record<string, unknown>) => Promise<unknown>;

const tokenNew = () => `u-${randomBytes(15).toString("hex").slice(0, 24)}`;

/**
 * Automatic transaction capture without bank credentials: each user gets a private address; card
 * alert emails (and statement PDFs) forwarded there become transactions on the matching card, and
 * the benefit tracker updates as usual. Email bodies are parsed in memory and never stored; nothing
 * is sent to an AI provider. Bank connections (Plaid) are the other automatic channel.
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spend: SpendService,
    private readonly loyalty: LoyaltyIngestService,
    @Optional() private readonly offerAutomation?: OfferAutomationService,
  ) {}

  domain(env = process.env) {
    return env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null;
  }

  /** Constant-time check of the shared secret the inbound mail provider sends. */
  checkSecret(given: string | undefined, env = process.env) {
    const secret = env.INBOUND_EMAIL_SECRET;
    if (!secret || !this.domain(env))
      throw new ServiceUnavailableException(
        "Inbound email is not configured on this server",
      );
    const a = Buffer.from(given ?? "");
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async inboxRow(userId: string) {
    return (
      (await this.prisma.emailInbox.findUnique({ where: { userId } })) ??
      this.prisma.emailInbox.create({ data: { userId, token: tokenNew() } })
    );
  }

  async rotate(userId: string) {
    await this.inboxRow(userId);
    await this.prisma.emailInbox.update({
      where: { userId },
      data: { token: tokenNew() },
    });
    return this.status(userId);
  }

  async setEnabled(userId: string, enabled: boolean) {
    await this.inboxRow(userId);
    await this.prisma.emailInbox.update({
      where: { userId },
      data: { enabled },
    });
    return this.status(userId);
  }

  // ───────── receiving ─────────

  /** One raw MIME message from the inbound mail provider. Never throws for message content. */
  async receive(
    rawMime: Buffer,
    envelopeTo: string[],
    now = new Date(),
  ): Promise<{ accepted: boolean; status?: string; kind?: string }> {
    const mail = await simpleParser(rawMime, {
      skipImageLinks: true,
      skipTextToHtml: true,
    });
    const headerTo = (name: string) => {
      const v = mail.headers.get(name);
      if (!v) return [];
      if (typeof v === "string") return [v];
      const o = v as { text?: string; value?: Array<{ address?: string }> };
      return [o.text ?? "", ...(o.value ?? []).map((x) => x.address ?? "")];
    };
    const token = inboxToken(
      [
        ...envelopeTo,
        ...headerTo("delivered-to"),
        ...headerTo("x-original-to"),
        ...headerTo("x-forwarded-to"),
        ...headerTo("to"),
        ...headerTo("cc"),
      ],
      this.domain(),
    );
    const inbox = token
      ? await this.prisma.emailInbox.findUnique({ where: { token } })
      : null;
    if (!inbox || !inbox.enabled) return { accepted: false };
    const userId = inbox.userId;
    await this.prisma.emailInbox.update({
      where: { id: inbox.id },
      data: { received: { increment: 1 }, lastReceivedAt: now },
    });
    await this.prisma.inboundEmail.deleteMany({
      where: {
        userId,
        receivedAt: { lt: new Date(now.getTime() - KEEP_DAYS * DAY) },
      },
    });

    return this.processMail(userId, mail, now, process.env.INBOUND_AUTHSERV_ID);
  }

  /**
   * A message read from a connected mailbox (IMAP / API) instead of forwarded to the private address.
   * Same allow-list, authentication check, statement and alert parsing, and dedupe. `authservId` is the
   * mailbox provider's Authentication-Results id when known; without it the sender cannot be verified and
   * the record is marked unverified.
   */
  async receiveFromMailbox(
    userId: string,
    rawMime: Buffer,
    authservId: string | undefined,
    now = new Date(),
  ): Promise<{ accepted: boolean; status?: string; kind?: string }> {
    const mail = await simpleParser(rawMime, { skipImageLinks: true, skipTextToHtml: true });
    return this.processMail(userId, mail, now, authservId);
  }

  private async processMail(
    userId: string,
    mail: Awaited<ReturnType<typeof simpleParser>>,
    now: Date,
    authservId: string | undefined,
  ): Promise<{ accepted: boolean; status?: string; kind?: string }> {
    const fromAddr = mail.from?.value?.[0]?.address ?? "";
    const fromDomain = domainOf(fromAddr);
    const subject = (mail.subject ?? "").slice(0, 200);
    const text =
      mail.text?.trim() ||
      (typeof mail.html === "string" ? htmlToText(mail.html) : "");
    const record: RecordFn = (data) =>
      this.prisma.inboundEmail.create({
        data: {
          userId,
          fromDomain: fromDomain || "unknown",
          subject,
          ...data,
        } as never,
      });

    const confirm =
      fromDomain === "google.com"
        ? gmailForwardingConfirmation(fromAddr, subject, text)
        : null;
    if (confirm) {
      await record({
        kind: "FORWARD_CONFIRMATION",
        status: "PROCESSED",
        confirmationCode: confirm.code,
        confirmationUrl: confirm.url,
        note: "Confirm forwarding in Gmail",
      });
      return {
        accepted: true,
        kind: "FORWARD_CONFIRMATION",
        status: "PROCESSED",
      };
    }
    if (!senderAllowed(fromDomain, senderDomains())) {
      await record({
        kind: "IGNORED",
        status: "REJECTED",
        note: "sender is not a known card issuer",
      });
      return { accepted: true, kind: "IGNORED", status: "REJECTED" };
    }
    const authHeaders = ([] as string[]).concat(
      (mail.headers.get("authentication-results") as
        string | string[] | undefined) ?? [],
    );
    const auth = senderAuth(
      authHeaders,
      authservId,
      fromDomain,
    );
    if (auth === "fail") {
      await record({
        kind: "IGNORED",
        status: "REJECTED",
        note: "sender authentication failed (DKIM/DMARC)",
      });
      return { accepted: true, kind: "IGNORED", status: "REJECTED" };
    }
    const verified = auth === "pass";

    // loyalty program mail: balances, status, certificates, expiry notices (and loyalty statements)
    const program = programForDomain(fromDomain);
    if (program) {
      const handled = await this.loyaltyMail(userId, program, mail, subject, text, fromDomain, verified, record, now);
      if (handled) return handled;
    }

    // statement PDFs attached to the email
    const pdfs = (mail.attachments ?? []).filter(
      (a) =>
        a.contentType === "application/pdf" || /\.pdf$/i.test(a.filename ?? ""),
    );
    if (pdfs.length) {
      let last: { status: string } = { status: "PROCESSED" };
      for (const a of pdfs.slice(0, 3))
        last = await this.statementAttachment(
          userId,
          a.content,
          record,
          verified,
        );
      return { accepted: true, kind: "STATEMENT", status: last.status };
    }

    // an offer-alert email from an issuer the member keeps an email offers account for
    const offerIssuer = issuerNameForDomain(fromDomain);
    if (offerIssuer && /\b(offers?|deals?)\b/i.test(subject) && this.offerAutomation) {
      const note = await this.offerAutomation.ingestFromMail(userId, offerIssuer, `${subject}\n${text}`);
      if (note) {
        await record({ kind: "IGNORED", status: "PROCESSED", verified, note });
        return { accepted: true, kind: "IGNORED", status: "PROCESSED" };
      }
    }

    const parsed = parseAlert(subject, text, mail.date ?? now);
    if (parsed.kind === "IGNORED") {
      const seen = classifyMail(subject, text);
      await record({
        kind: "IGNORED",
        status: "PROCESSED",
        verified,
        note: seen === "OTHER" ? parsed.reason : `${MAIL_KIND_LABEL[seen]} — ${parsed.reason}`,
      });
      return { accepted: true, kind: "IGNORED", status: "PROCESSED" };
    }
    const a = parsed.alert;
    const card = await this.cardFor(userId, a.lastDigits);
    const base = {
      kind: "ALERT" as const,
      verified,
      lastDigits: a.lastDigits,
      amountCents: a.amountCents,
      merchant: a.merchant,
      occurredAt: a.occurredAt ?? now,
      credit: a.credit,
    };
    if (!card) {
      await record({
        ...base,
        status: "NEEDS_CARD",
        note: a.lastDigits
          ? `no single card ending in ${a.lastDigits}`
          : "the alert does not say which card",
      });
      return { accepted: true, kind: "ALERT", status: "NEEDS_CARD" };
    }
    const externalId = `email:${createHash("sha256")
      .update(
        mail.messageId ??
          `${fromDomain}|${subject}|${a.amountCents}|${a.merchant}|${base.occurredAt.toISOString()}`,
      )
      .digest("hex")
      .slice(0, 40)}`;
    const r = await this.ingestAlert(
      userId,
      card,
      { ...a, occurredAt: base.occurredAt },
      externalId,
    );
    await record({
      ...base,
      walletCardId: card,
      transactionId: r.transactionIds[0] ?? null,
      status: r.imported ? "PROCESSED" : "DUPLICATE",
      note: r.imported ? null : "already recorded",
    });
    return {
      accepted: true,
      kind: "ALERT",
      status: r.imported ? "PROCESSED" : "DUPLICATE",
    };
  }

  /**
   * A message from a loyalty program's domain. Parsed observations go through the provenance funnel (source EMAIL or
   * STATEMENT). A genuine card transaction alert from the same domain (e.g. a bank that is also a points program)
   * still continues to the card flow. Message bodies are never stored: only a hash identifies the evidence.
   */
  private async loyaltyMail(
    userId: string,
    program: ProgramRule,
    mail: Awaited<ReturnType<typeof simpleParser>>,
    subject: string,
    text: string,
    fromDomain: string,
    verified: boolean,
    record: RecordFn,
    now: Date,
  ): Promise<{ accepted: boolean; kind?: string; status?: string } | null> {
    const when = mail.date ?? now;
    const evidence = evidenceHashOf("email", mail.messageId ?? `${fromDomain}|${subject}|${when.toISOString()}`);
    // loyalty statements (PDF)
    for (const a of (mail.attachments ?? []).filter((x) => x.contentType === "application/pdf" || /\.pdf$/i.test(x.filename ?? "")).slice(0, 3)) {
      try {
        const lines = (await extractPdfLines(a.content)).flat();
        const st = parseLoyaltyStatement(lines, when);
        if (!st.program || st.validation.status === "FAILED" || st.closing == null) continue;
        const observations = [
          ...(st.closing != null ? [{ entity: "ACCOUNT" as const, field: "balance", value: st.closing, rule: "statement.closing", ruleConfidence: st.validation.status === "PASS" ? 95 : 70, observedAt: st.periodEnd ?? when }] : []),
          ...st.activity.map((x) => ({ entity: "ACCOUNT" as const, field: "activity", value: { kind: x.kind, points: x.points, occurredAt: x.occurredAt, balanceAfter: x.balanceAfter, note: x.description }, rule: "statement.line", ruleConfidence: 90, observedAt: x.occurredAt })),
          ...st.extras,
        ];
        const r = await this.loyalty.apply({ userId, programCode: st.program.programCode, sourceType: "STATEMENT", method: "statement-pdf", evidenceHash: evidenceHashOf("pdf", createHash("sha256").update(a.content).digest("hex")), now }, observations);
        await record({ kind: "LOYALTY", status: "PROCESSED", verified, note: r.unmatched ?? `${st.program.name} statement: ${r.applied} applied, ${r.confirmed} confirmed${st.validation.status === "WARNING" ? " (needs review: " + st.validation.reasons[0] + ")" : ""}` });
        return { accepted: true, kind: "LOYALTY", status: "PROCESSED" };
      } catch {
        // not a readable loyalty statement: fall through to the card statement flow
      }
    }
    const parsed = parseLoyaltyEmail(fromDomain, subject, text, when);
    if (!parsed.observations.length) return null;
    const r = await this.loyalty.apply({ userId, programCode: program.programCode, sourceType: "EMAIL", method: parsed.rules.join("+").slice(0, 60) || "email", evidenceHash: evidence, memberDigits: parsed.memberDigits, now }, parsed.observations);
    const isCardAlert = parseAlert(subject, text, when).kind !== "IGNORED";
    if (isCardAlert) return null; // also a card transaction alert: continue to the card flow
    await record({ kind: "LOYALTY", status: "PROCESSED", verified, note: r.unmatched ?? `${program.name}: ${r.applied} applied, ${r.confirmed} confirmed${r.conflicts + r.pending ? `, ${r.conflicts + r.pending} need your decision` : ""}` });
    return { accepted: true, kind: "LOYALTY", status: "PROCESSED" };
  }

  private kindOf(a: { credit: boolean; merchant: string }): TransactionKind {
    if (!a.credit) return "PURCHASE";
    return /refund|return/i.test(a.merchant) ? "REFUND" : "CREDIT";
  }

  private ingestAlert(
    userId: string,
    walletCardId: string,
    a: {
      amountCents: number;
      merchant: string;
      occurredAt: Date;
      credit: boolean;
    },
    externalId: string,
  ) {
    return this.spend.ingest(
      userId,
      walletCardId,
      [
        {
          occurredAt: a.occurredAt,
          description: a.merchant,
          amountCents: a.amountCents,
          kind: this.kindOf(a),
          externalId,
        },
      ],
      "EMAIL",
    );
  }

  private async statementAttachment(
    userId: string,
    content: Buffer,
    save: RecordFn,
    verified: boolean,
  ) {
    try {
      const pages = await extractPdfLines(content);
      const digits = statementDigits(pages.flat());
      const card = await this.cardFor(userId, digits);
      if (!card) {
        await save({
          kind: "STATEMENT",
          status: "NEEDS_CARD",
          verified,
          lastDigits: digits,
          note: "Statement for an unknown card — drop it on the Spending page (Import statements) to choose the card",
        });
        return { status: "NEEDS_CARD" };
      }
      const r = await this.spend.importEmailedStatement(userId, card, content);
      await save({
        kind: "STATEMENT",
        status: r.alreadyImported ? "DUPLICATE" : "PROCESSED",
        verified,
        lastDigits: digits,
        walletCardId: card,
        note: r.alreadyImported
          ? "this statement was already imported"
          : `${r.imported} new, ${r.merged} merged with alerts, ${r.duplicates} already recorded`,
      });
      return { status: r.alreadyImported ? "DUPLICATE" : "PROCESSED" };
    } catch (e) {
      const msg =
        e instanceof StatementError || e instanceof BadRequestException
          ? e.message
          : "The PDF could not be read";
      await save({
        kind: "STATEMENT",
        status: "REJECTED",
        verified,
        note: msg,
      });
      return { status: "REJECTED" };
    }
  }

  /** The user's one open card whose stored last digits match (4 vs 5 digits for Amex handled). */
  private cardFor(userId: string, digits: string | null) {
    return this.spend.cardForDigits(userId, digits);
  }

  // ───────── review ─────────

  async assign(
    userId: string,
    id: string,
    walletCardId: string,
    remember: boolean,
  ) {
    const item = await this.prisma.inboundEmail.findFirst({
      where: { id, userId },
    });
    if (!item) throw new NotFoundException("Item not found");
    if (
      item.status !== "NEEDS_CARD" ||
      item.kind !== "ALERT" ||
      item.amountCents == null ||
      !item.merchant
    )
      throw new BadRequestException(
        "Only alerts waiting for a card can be assigned",
      );
    const card = await this.prisma.walletCard.findFirst({
      where: { id: walletCardId, wallet: { userId } },
      select: { id: true, lastFour: true },
    });
    if (!card) throw new NotFoundException("Wallet card not found");
    const r = await this.ingestAlert(
      userId,
      card.id,
      {
        amountCents: item.amountCents,
        merchant: item.merchant,
        occurredAt: item.occurredAt ?? item.receivedAt,
        credit: item.credit,
      },
      `email:item:${item.id}`,
    );
    if (remember && item.lastDigits && !card.lastFour)
      await this.prisma.walletCard.update({
        where: { id: card.id },
        data: { lastFour: item.lastDigits },
      });
    await this.prisma.inboundEmail.update({
      where: { id },
      data: {
        status: r.imported ? "PROCESSED" : "DUPLICATE",
        walletCardId: card.id,
        transactionId: r.transactionIds[0] ?? null,
      },
    });
    return {
      status: r.imported ? "PROCESSED" : "DUPLICATE",
      benefitUpdates: r.benefitUpdates,
    };
  }

  async discard(userId: string, id: string) {
    const r = await this.prisma.inboundEmail.deleteMany({
      where: { id, userId },
    });
    if (!r.count) throw new NotFoundException("Item not found");
  }

  // ───────── status ─────────

  /** Per card: how its transactions arrive (bank / alert emails / manual) and whether that is current. */
  async status(userId: string, now = new Date()) {
    const inbox = await this.inboxRow(userId);
    const domain = this.domain();
    const [cards, connections, items, lastTx] = await Promise.all([
      this.prisma.walletCard.findMany({
        where: { wallet: { userId }, status: { not: "CLOSED" } },
        select: {
          id: true,
          nickname: true,
          lastFour: true,
          source: true,
          sourceMeta: true,
          card: {
            select: {
              name: true,
              color: true,
              issuer: { select: { name: true } },
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      }),
      this.prisma.bankConnection.findMany({
        where: { userId },
        select: {
          id: true,
          institutionName: true,
          lastSyncedAt: true,
          lastTxSyncAt: true,
          needsReauth: true,
          lastError: true,
        },
      }),
      this.prisma.inboundEmail.findMany({
        where: { userId },
        orderBy: { receivedAt: "desc" },
        take: 50,
      }),
      this.prisma.transaction.groupBy({
        by: ["walletCardId", "source"],
        where: {
          userId,
          occurredAt: { gte: new Date(now.getTime() - 90 * DAY) },
        },
        _max: { occurredAt: true },
        _count: true,
      }),
    ]);
    const coverage = await this.spend.statementCoverage(userId);
    const confirmation = items.find(
      (i) =>
        i.kind === "FORWARD_CONFIRMATION" &&
        now.getTime() - i.receivedAt.getTime() < 7 * DAY,
    );
    const perCard = cards.map((c) => {
      const meta = (c.sourceMeta ?? {}) as { connectionId?: string };
      const conn = connections.find((x) => x.id === meta.connectionId) ?? null;
      const tx = lastTx.filter((x) => x.walletCardId === c.id);
      const last = (src: string) =>
        tx.find((x) => x.source === src)?._max.occurredAt ?? null;
      const lastAny = tx.reduce<Date | null>(
        (a, x) =>
          x._max.occurredAt && (!a || x._max.occurredAt > a)
            ? x._max.occurredAt
            : a,
        null,
      );
      const lastEmail =
        last("EMAIL") ??
        items.find((i) => i.walletCardId === c.id && i.kind === "ALERT")
          ?.receivedAt ??
        null;
      const via =
        conn && !conn.needsReauth
          ? "BANK"
          : lastEmail && now.getTime() - lastEmail.getTime() < STALE_DAYS * DAY
            ? "EMAIL"
            : "MANUAL";
      return {
        walletCardId: c.id,
        name: c.nickname || c.card.name,
        issuer: c.card.issuer.name,
        color: c.card.color,
        lastFour: c.lastFour,
        automatic: via !== "MANUAL",
        via,
        bank: conn
          ? {
              connectionId: conn.id,
              institution: conn.institutionName,
              needsReauth: conn.needsReauth,
              lastSyncedAt: conn.lastTxSyncAt ?? conn.lastSyncedAt,
            }
          : null,
        lastAlertAt: lastEmail,
        lastTransactionAt: lastAny,
        statements: coverage.get(c.id) ?? null,
        /** no automatic feed and no statement covering the last ~month */
        statementDue:
          via === "MANUAL" &&
          (() => {
            const through = coverage.get(c.id)?.through;
            return !through || now.getTime() - through.getTime() > 35 * DAY;
          })(),
        hint: !c.lastFour
          ? "Add the last 4 digits so forwarded alerts and statements can find this card"
          : conn?.needsReauth
            ? "Sign in to the bank again to resume syncing"
            : via === "MANUAL"
              ? "Connect the bank, forward transaction alerts, or drop this card's latest statement"
              : null,
      };
    });
    const senders = [
      "chase.com",
      "americanexpress.com",
      "aexp.com",
      "citi.com",
      "capitalone.com",
      "discover.com",
      "bankofamerica.com",
      "wellsfargo.com",
      "usbank.com",
      "barclaysus.com",
    ];
    return {
      inbox: {
        configured: !!domain,
        address: domain ? `${inbox.token}@${domain}` : null,
        enabled: inbox.enabled,
        received: inbox.received,
        lastReceivedAt: inbox.lastReceivedAt,
        gmailFilter: `from:(${senders.join(" OR ")})`,
        confirmation: confirmation
          ? {
              code: confirmation.confirmationCode,
              url: confirmation.confirmationUrl,
              receivedAt: confirmation.receivedAt,
            }
          : null,
      },
      cards: perCard,
      automated: perCard.filter((c) => c.automatic).length,
      needsCard: items
        .filter((i) => i.status === "NEEDS_CARD")
        .map((i) => ({
          id: i.id,
          kind: i.kind,
          receivedAt: i.receivedAt,
          amountCents: i.amountCents,
          merchant: i.merchant,
          lastDigits: i.lastDigits,
          occurredAt: i.occurredAt,
          credit: i.credit,
          note: i.note,
        })),
      recent: items.slice(0, 20).map((i) => ({
        id: i.id,
        receivedAt: i.receivedAt,
        fromDomain: i.fromDomain,
        subject: i.subject,
        kind: i.kind,
        status: i.status,
        verified: i.verified,
        amountCents: i.amountCents,
        merchant: i.merchant,
        note: i.note,
      })),
    };
  }
}
