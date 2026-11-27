import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { BenefitsService } from '../portfolio/benefits';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { OfferInventoryService } from '../offers/offer-inventory.service';
import { LIFECYCLE_LABEL } from '../domain/offer-lifecycle';
import { offerLabel } from '../domain/plan-insights';
import { Dictionaries, understand } from '../domain/query-understanding';
import { rankDocs, SearchDoc, TYPE_LABEL } from '../domain/search-index';
import { routeFor } from '../domain/search-router';
import { SearchMemoryService } from './search-memory.service';

/** names (cards, members) are cheap to read and people add them just before asking; the larger index can be a little older */
const DICT_TTL_MS = 10_000;
const USER_TTL_MS = 30_000;
const CATALOG_TTL_MS = 5 * 60_000;
const MAX_USERS_CACHED = 500;

/** A tiny time-boxed memo. The index is rebuilt from the database at most every half minute per user. */
class Memo<T> {
  private readonly map = new Map<string, { at: number; value: T }>();
  constructor(
    private readonly ttl: number,
    private readonly max = MAX_USERS_CACHED,
  ) {}
  async get(key: string, make: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.map.get(key);
    if (hit && now - hit.at < this.ttl) return hit.value;
    const value = await make();
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    this.map.set(key, { at: now, value });
    return value;
  }
}

export interface Suggestion {
  type: 'ENTITY' | 'QUERY' | 'EXAMPLE' | 'SAVED' | 'RECENT';
  id: string;
  label: string;
  sublabel?: string;
  /** what kind of thing it is ("Your card", "Offer") */
  kind?: string;
  href?: string;
  /** a question to run */
  query?: string;
}

/** What to show when nothing has been typed. */
export const EXAMPLE_QUESTIONS = [
  'What card should I use at Costco for $1,500?',
  "What's expiring?",
  'How many points do I have?',
  'Show all Hilton offers',
  'What is my 5/24 status?',
  'Which free night certificates expire next?',
  'What card should I get next?',
  'Review annual fees',
];

const usd = (c: number) => '$' + (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

/** Everything the search bar knows about one household, rebuilt every few seconds (names) to half a minute (the index). */
@Injectable()
export class SearchService {
  private readonly userDocs = new Memo<SearchDoc[]>(USER_TTL_MS);
  private readonly userDict = new Memo<Dictionaries>(DICT_TTL_MS);
  private readonly catalogDocs = new Memo<SearchDoc[]>(CATALOG_TTL_MS, 4);
  private readonly catalogDict = new Memo<Pick<Dictionaries, 'merchants' | 'programs'>>(CATALOG_TTL_MS, 4);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: OfferInventoryService,
    private readonly benefits: BenefitsService,
    private readonly loyalty: LoyaltyService,
    private readonly memory: SearchMemoryService,
  ) {}

  /** Names the language engine needs: merchants and programs (shared), the household's cards and members (per user). */
  async dictionaries(userId: string): Promise<Dictionaries> {
    return this.userDict.get(userId, async () => {
      const [shared, wallet, catalog, profiles] = await Promise.all([
        this.catalogDict.get('all', async () => ({
          merchants: (await this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true, hosts: true, aliases: true, mcc: true, parentCompany: true } })).map((m) => ({ ...m })),
          programs: (await this.prisma.loyaltyProgram.findMany({ where: { isActive: true }, select: { id: true, name: true, kind: true } })).map((p) => ({ id: p.id, name: p.name, kind: String(p.kind) })),
        })),
        this.prisma.walletCard.findMany({ where: { wallet: { userId } }, select: { id: true, card: { select: { id: true, name: true } } } }),
        this.prisma.creditCard.findMany({ where: { isActive: true, ownerId: null }, select: { id: true, name: true } }),
        this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true, relationship: true, isPrimary: true } }),
      ]);
      const owned = new Set(wallet.map((w) => w.card.id));
      return {
        merchants: shared.merchants,
        programs: shared.programs,
        cards: [...wallet.map((w) => ({ id: w.card.id, name: w.card.name, walletCardId: w.id })), ...catalog.filter((c) => !owned.has(c.id)).map((c) => ({ id: c.id, name: c.name, walletCardId: null }))],
        members: profiles.map((p) => ({ id: p.id, nickname: p.nickname, relationship: p.isPrimary ? ('SELF' as const) : (p.relationship as never) })),
      };
    });
  }

  private async sharedDocs(): Promise<SearchDoc[]> {
    return this.catalogDocs.get('all', async () => {
      const [merchants, categories, cards, programs] = await Promise.all([
        this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true, aliases: true, parentCompany: true, isPopular: true } }),
        this.prisma.category.findMany({ select: { id: true, slug: true, name: true } }),
        this.prisma.creditCard.findMany({ where: { isActive: true, ownerId: null }, select: { id: true, name: true, annualFeeCents: true, popularity: true, issuer: { select: { name: true } } } }),
        this.prisma.loyaltyProgram.findMany({ where: { isActive: true }, select: { id: true, name: true, kind: true, code: true } }),
      ]);
      return [
        ...merchants.map((m): SearchDoc => ({ type: 'MERCHANT', id: m.id, title: m.name, subtitle: m.parentCompany ?? undefined, keywords: m.aliases, href: '/merchants/' + m.slug, weight: m.isPopular ? 0.85 : 0.7 })),
        ...categories.map((c): SearchDoc => ({ type: 'CATEGORY', id: c.id, title: c.name, href: '/categories/' + c.slug, weight: 0.6 })),
        ...cards.map((c): SearchDoc => ({ type: 'CARD', id: c.id, title: c.name, subtitle: c.issuer.name + ' · ' + (c.annualFeeCents ? '$' + Math.round(c.annualFeeCents / 100) + '/yr' : 'no annual fee'), keywords: [c.issuer.name], href: '/wallet', weight: 0.4 + Math.min(0.2, (c.popularity ?? 0) / 500) })),
        ...programs.map((p): SearchDoc => ({ type: 'PROGRAM', id: p.id, title: p.name, subtitle: String(p.kind).toLowerCase(), keywords: [p.code], href: '/loyalty', weight: 0.7 })),
      ];
    });
  }

  /** The household's own things: cards, offers, benefits, certificates, accounts, members, plans, notifications, recent transactions. */
  async docsFor(userId: string): Promise<SearchDoc[]> {
    return this.userDocs.get(userId, async () => {
      const [wallet, offers, benefits, certs, accounts, members, plans, trips, notes, txns, statuses] = await Promise.all([
        this.prisma.walletCard.findMany({ where: { wallet: { userId } }, select: { id: true, nickname: true, lastFour: true, status: true, profile: { select: { nickname: true } }, card: { select: { name: true, issuer: { select: { name: true } } } } } }),
        this.inventory.rows(userId),
        this.benefits.list(userId, {}),
        this.prisma.loyaltyCertificate.findMany({ where: { userId }, select: { id: true, name: true, category: true, status: true, expiresAt: true, profile: { select: { nickname: true } }, program: { select: { name: true } } }, take: 100 }),
        this.loyalty.accounts(userId),
        this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true, relationship: true } }),
        this.prisma.plannedPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, merchantText: true, item: true, amountCents: true, status: true } }),
        this.prisma.awardTrip.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, destination: true, dateFrom: true, cabin: true } }),
        this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 25, select: { id: true, title: true, body: true, link: true } }),
        this.prisma.transaction.findMany({ where: { userId, kind: 'PURCHASE' }, orderBy: { occurredAt: 'desc' }, take: 200, select: { id: true, description: true, amountCents: true, occurredAt: true } }),
        this.prisma.eliteStatus.findMany({ where: { userId }, select: { id: true, programName: true, level: true, profile: { select: { nickname: true } } } }),
      ]);
      const docs: SearchDoc[] = [];
      for (const w of wallet) docs.push({ type: 'WALLET_CARD', id: w.id, title: w.nickname || w.card.name, subtitle: [w.card.issuer.name, w.profile?.nickname, w.lastFour ? '••' + w.lastFour : null, w.status.toLowerCase()].filter(Boolean).join(' · '), keywords: [w.card.name, w.card.issuer.name], href: '/wallet/' + w.id, weight: 1 });
      for (const o of offers) docs.push({ type: 'OFFER', id: o.id, title: offerLabel(o.merchant?.name ?? o.merchantText, o), subtitle: [o.cardholder, o.card, LIFECYCLE_LABEL[o.state], o.endsAt ? 'ends ' + day(o.endsAt) : null].filter(Boolean).join(' · '), keywords: [o.merchant?.name ?? o.merchantText, o.issuer ?? '', o.card ?? '', 'offer'], href: o.walletCardId ? '/wallet/' + o.walletCardId : '/offers/inventory', weight: 0.9 });
      for (const b of benefits) docs.push({ type: 'BENEFIT', id: b.id, title: b.name, subtitle: [b.walletCard.name, usd(b.currentPeriod.remainingCents) + ' left'].join(' · '), keywords: [b.kind, 'benefit', 'credit'], href: '/benefits', weight: 0.8 });
      for (const c of certs) docs.push({ type: 'CERTIFICATE', id: c.id, title: c.name, subtitle: [c.profile.nickname, c.status.toLowerCase(), c.expiresAt ? 'expires ' + day(c.expiresAt) : null].filter(Boolean).join(' · '), keywords: [c.program?.name ?? '', c.category, 'certificate'], href: '/loyalty', weight: 0.9 });
      for (const a of accounts) docs.push({ type: 'LOYALTY', id: a.id, title: a.programName, subtitle: a.member + ' · ' + a.balance.toLocaleString('en-US') + ' ' + a.unit, keywords: ['points', 'miles', 'balance'], href: '/loyalty', weight: 0.9 });
      for (const s of statuses) docs.push({ type: 'LOYALTY', id: s.id, title: (s.programName + ' ' + (s.level ?? '')).trim(), subtitle: s.profile.nickname + ' · elite status', keywords: ['elite', 'status'], href: '/loyalty', weight: 0.8 });
      for (const m of members) docs.push({ type: 'MEMBER', id: m.id, title: m.nickname, subtitle: String(m.relationship).toLowerCase(), keywords: [String(m.relationship)], href: '/household', weight: 0.8 });
      for (const p of plans) docs.push({ type: 'PLAN', id: p.id, title: p.item ? p.item + ' · ' + p.merchantText : p.merchantText, subtitle: usd(p.amountCents) + ' · ' + p.status.toLowerCase(), keywords: ['plan', 'shopping'], href: '/offers/plan', weight: 0.8 });
      for (const t of trips) docs.push({ type: 'TRIP', id: t.id, title: 'Trip to ' + t.destination, subtitle: [day(t.dateFrom), t.cabin?.toLowerCase()].filter(Boolean).join(' · '), keywords: ['travel', 'trip', 'award'], href: '/loyalty', weight: 0.8 });
      for (const n of notes) docs.push({ type: 'NOTIFICATION', id: n.id, title: n.title, subtitle: n.body.slice(0, 80), href: n.link || '/notifications', weight: 0.5 });
      for (const t of txns) docs.push({ type: 'TRANSACTION', id: t.id, title: t.description ?? 'Transaction', subtitle: usd(t.amountCents) + ' · ' + day(t.occurredAt), href: '/spending', weight: 0.4 });
      return [...docs, ...(await this.sharedDocs())];
    });
  }

  /** As-you-type: what the question is read as, and the matching things. Fast: from the cached index, no engines run. */
  async suggest(userId: string, q: string, now = new Date()) {
    const started = Date.now();
    const text = q.trim().slice(0, 200);
    if (!text) {
      // saved searches first, then recent questions, then examples to fill the list
      const { saved, recent } = await this.memory.quick(userId);
      const seen = new Set<string>();
      const out: Suggestion[] = [];
      const add = (s: Suggestion) => {
        const key = (s.query ?? s.label).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(s);
      };
      for (const e of saved) add({ type: 'SAVED', id: 'saved:' + e.id, label: e.name || e.query, sublabel: e.name ? e.query : undefined, kind: 'Saved', query: e.query });
      for (const e of recent) add({ type: 'RECENT', id: 'recent:' + e.id, label: e.query, sublabel: e.summary ?? undefined, kind: 'Recent', query: e.query });
      for (const e of EXAMPLE_QUESTIONS) add({ type: 'EXAMPLE', id: e, label: e, query: e });
      return { q: text, understood: null, suggestions: out.slice(0, 10), tookMs: Date.now() - started };
    }
    const [docs, dict] = await Promise.all([this.docsFor(userId), this.dictionaries(userId)]);
    const u = understand(text, dict, now);
    const suggestions: Suggestion[] = [];
    let understood: { intent: string; confidence: number; title: string } | null = null;
    if (u.intent !== 'UNKNOWN' && u.confidence >= 0.5) {
      const r = routeFor(u);
      understood = { intent: u.intent, confidence: u.confidence, title: r.title };
      suggestions.push({ type: 'QUERY', id: 'ask', label: text, sublabel: r.title + ' — press Enter', kind: 'Ask', query: text });
    }
    for (const h of rankDocs(docs, text, 7)) suggestions.push({ type: 'ENTITY', id: h.doc.type + ':' + h.doc.id, label: h.doc.title, sublabel: h.doc.subtitle, kind: TYPE_LABEL[h.doc.type], href: h.doc.href });
    if (!suggestions.some((s) => s.type === 'QUERY')) suggestions.unshift({ type: 'QUERY', id: 'ask', label: text, sublabel: 'Ask PointWise — press Enter', kind: 'Ask', query: text });
    return { q: text, understood, suggestions, tookMs: Date.now() - started };
  }
}
