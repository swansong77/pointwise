import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { accountHealth, aggregateHealth, householdHealth, ScoredItem } from '../domain/loyalty-health';
import { programByCode } from '../domain/loyalty-email';
import { freshness, nextRefreshAt, Priority, refreshPlan, refreshPriority, summarizeRuns } from '../domain/loyalty-refresh';
import { CreditInfo, LoyaltyService } from './loyalty.service';

const DAY = 86_400_000;
export const EXTENSION_SCOPE = 'loyalty:ingest';
const PAT_PREFIX = 'pw_pat_';
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

/** Refresh scheduling, health, audit and extension tokens. Prisma-only apart from the loyalty views it reads. */
@Injectable()
export class LoyaltyAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
  ) {}

  private async sources(userId: string) {
    const [mailboxes, tokens] = await Promise.all([
      this.prisma.mailbox.count({ where: { userId, active: true } }),
      this.prisma.personalAccessToken.count({ where: { userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    ]);
    return { mailbox: mailboxes > 0, extension: tokens > 0 };
  }

  /** Recomputes priority, next refresh time and confidence for every account; returns the rows with their plans. */
  async refreshStatus(userId: string, now = new Date()) {
    const [accts, statuses, certs, routes, pending, src, runs] = await Promise.all([
      this.loyalty.accounts(userId, now),
      this.loyalty.statuses(userId, now),
      this.loyalty.certificates(userId, undefined, now),
      this.loyalty.transferRoutes(now),
      this.prisma.loyaltyObservation.groupBy({ by: ['accountId'], where: { userId, outcome: { in: ['CONFLICT', 'PENDING'] } }, _count: true }),
      this.sources(userId),
      this.prisma.loyaltySyncRun.findMany({ where: { userId, startedAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { accountId: true, status: true } }),
    ]);
    const pendingBy = new Map(pending.map((p) => [p.accountId, p._count]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: Array<Record<string, any>> = [];
    for (const a of accts) {
      const risky = statuses.some((s) => s.current && s.program === a.programName && s.member === a.member && (s.view.risk === 'HIGH' || s.view.risk === 'MEDIUM'));
      const certSoon = certs.some((c) => c.view.effectiveStatus === 'AVAILABLE' && c.view.daysLeft != null && c.view.daysLeft <= 60 && (c.accountId === a.id || (!c.accountId && c.program === a.programName && c.member === a.member)));
      const bonus = a.isBankCurrency && routes.some((r) => r.currency === a.programCode && !!r.activeBonusPercent);
      const { priority, reasons } = refreshPriority({ balance: a.balance, lastObservedAt: a.lastObservedAt, lastSuccessAt: a.lastSuccessfulRefreshAt, sourceType: a.balanceSource, reliability: a.balanceReliability ?? 0, daysToExpiry: a.prediction.daysLeft, pendingObservations: pendingBy.get(a.id) ?? 0, transferBonusActive: bonus, statusAtRisk: risky, certificateExpiringSoon: certSoon, now });
      const next = nextRefreshAt(priority, a.lastSuccessfulRefreshAt ?? a.lastObservedAt, now);
      const fresh = freshness(a.lastObservedAt, priority, now);
      if (priority !== a.refreshPriority || !a.nextRefreshAt || a.nextRefreshAt.getTime() !== next.getTime()) await this.prisma.loyaltyAccount.update({ where: { id: a.id }, data: { refreshPriority: priority, nextRefreshAt: next, refreshConfidence: a.refreshConfidence } });
      const rule = a.programCode ? programByCode(a.programCode) : null;
      rows.push({
        accountId: a.id,
        member: a.member,
        program: a.programName,
        priority,
        reasons,
        freshness: fresh,
        lastObservedAt: a.lastObservedAt,
        lastSuccessfulRefreshAt: a.lastSuccessfulRefreshAt,
        nextRefreshAt: next,
        due: next.getTime() <= now.getTime(),
        refreshConfidence: a.refreshConfidence,
        source: a.balanceSource,
        reliability: a.balanceReliability,
        sync: summarizeRuns(runs.filter((r) => r.accountId === a.id)),
        plan: refreshPlan(a.programName, fresh, { mailbox: src.mailbox, programHasEmailRules: !!rule, extension: src.extension }),
      });
    }
    const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    rows.sort((x, y) => order[x.priority] - order[y.priority] || (x.lastObservedAt?.getTime() ?? 0) - (y.lastObservedAt?.getTime() ?? 0));
    const count = (f: string) => rows.filter((r) => r.freshness === f).length;
    return { generatedAt: now, sources: src, summary: { accounts: rows.length, fresh: count('FRESH'), aging: count('AGING'), stale: count('STALE'), never: count('NEVER'), due: rows.filter((r) => r.due).length, sync: summarizeRuns(runs) }, accounts: rows };
  }

  /** Users with accounts that are due and urgent, for the scheduled refresh. */
  async dueUsers(now: Date): Promise<string[]> {
    const rows = await this.prisma.loyaltyAccount.findMany({ where: { balance: { gt: 0 }, refreshPriority: { in: ['CRITICAL', 'HIGH'] }, OR: [{ nextRefreshAt: null }, { nextRefreshAt: { lte: now } }] }, select: { userId: true }, distinct: ['userId'], take: 1000 });
    return rows.map((r) => r.userId);
  }

  /** 0–100 health for every account, program and the household. */
  async health(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [accts, statuses, certs, routes, runs] = await Promise.all([
      this.loyalty.accounts(userId, now),
      this.loyalty.statuses(userId, now),
      this.loyalty.certificates(userId, undefined, now),
      this.loyalty.transferRoutes(now),
      this.prisma.loyaltySyncRun.findMany({ where: { userId, startedAt: { gte: new Date(now.getTime() - 30 * DAY) } }, select: { accountId: true, status: true } }),
    ]);
    const items: Array<ScoredItem & { program: string; member: string; health: ReturnType<typeof accountHealth> }> = [];
    for (const a of accts) {
      const myCerts = certs.filter((c) => c.view.effectiveStatus === 'AVAILABLE' && (c.accountId === a.id || (!c.accountId && c.program === a.programName && c.member === a.member)));
      const st = statuses.find((s) => s.current && s.program === a.programName && s.member === a.member);
      const priority: Priority = a.refreshPriority;
      const h = accountHealth({
        freshness: freshness(a.lastObservedAt, priority, now),
        syncSuccessRate: summarizeRuns(runs.filter((r) => r.accountId === a.id)).successRate,
        expirationLevel: a.prediction.level,
        refreshConfidence: a.refreshConfidence,
        certificatesExpiring: myCerts.filter((c) => c.view.daysLeft != null && c.view.daysLeft <= 90).length,
        statusRisk: st ? st.view.risk : null,
        transferOpportunityOpen: a.isBankCurrency && routes.some((r) => r.currency === a.programCode && !!r.activeBonusPercent && r.advice.verdict === 'TRANSFER_NOW'),
        expiredValueCents: Math.round(a.expiredPoints * a.centsPerPoint),
        currentValueCents: a.valueCents,
        creditsExpiringCents: 0,
        creditsTotalCents: 0,
      });
      items.push({ id: a.id, label: a.programName, program: a.programCode ?? a.programName, member: a.member, score: h.score, weight: Math.max(a.valueCents, 1), health: h });
    }
    const byProgram = new Map<string, typeof items>();
    for (const i of items) byProgram.set(i.program, [...(byProgram.get(i.program) ?? []), i]);
    const available = certs.filter((c) => c.view.effectiveStatus === 'AVAILABLE');
    const household = householdHealth(items, {
      certificatesExpiring: available.filter((c) => c.view.daysLeft != null && c.view.daysLeft <= 90).length,
      certificatesTotal: available.length,
      creditsExpiringCents: credits.filter((c) => c.expiresAt && c.expiresAt.getTime() - now.getTime() <= 30 * DAY).reduce((s, c) => s + c.remainingCents, 0),
      creditsTotalCents: credits.reduce((s, c) => s + c.remainingCents, 0),
    });
    return {
      generatedAt: now,
      household,
      programs: [...byProgram.entries()].map(([program, list]) => ({ program, name: list[0].label, ...aggregateHealth(list) })).sort((a, b) => a.score - b.score),
      accounts: items.map((i) => ({ accountId: i.id, program: i.label, member: i.member, ...i.health })).sort((a, b) => a.score - b.score),
    };
  }

  /** What changed recently: accepted observations and logged balance changes. */
  async recentChanges(userId: string, days = 30, now = new Date()) {
    const since = new Date(now.getTime() - days * DAY);
    const [obs, events] = await Promise.all([
      this.prisma.loyaltyObservation.findMany({ where: { userId, outcome: 'ACCEPTED', createdAt: { gte: since }, field: { in: ['balance', 'statusLevel', 'expiresAt', 'certificate', 'pendingBalance'] } }, orderBy: { createdAt: 'desc' }, take: 100, include: { account: { select: { nickname: true, program: { select: { name: true } }, currency: { select: { name: true } }, profile: { select: { nickname: true } } } } } }),
      this.prisma.loyaltyEvent.findMany({ where: { userId, occurredAt: { gte: since }, kind: { not: 'SNAPSHOT' } }, orderBy: { occurredAt: 'desc' }, take: 100, include: { account: { select: { program: { select: { name: true } }, currency: { select: { name: true } }, customName: true, profile: { select: { nickname: true } } } } } }),
    ]);
    const changes = [
      ...obs.map((o) => ({ at: o.createdAt, member: o.account?.profile.nickname ?? null, program: o.account?.program?.name ?? o.account?.currency?.name ?? 'Program', what: o.field, value: o.value, source: o.sourceType, reliability: o.reliability, reason: o.reason })),
      ...events.map((e) => ({ at: e.occurredAt, member: e.account.profile.nickname, program: e.account.program?.name ?? e.account.currency?.name ?? e.account.customName ?? 'Program', what: e.kind.toLowerCase(), value: e.points, source: null, reliability: null, reason: e.note ?? '' })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { days, changes: changes.slice(0, 100) };
  }

  /**
   * The weekly audit: the eight questions, answered from the engines. Nothing here is generated by a model, and
   * it is never sent to one; a local model may only rephrase it (workflow privacy rules).
   */
  async audit(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [exp, certs, valuation, statuses, fresh, changes] = await Promise.all([this.loyalty.expirations(userId, now), this.loyalty.certificates(userId, undefined, now), this.loyalty.valuation(userId, credits, now), this.loyalty.statuses(userId, now), this.refreshStatus(userId, now), this.recentChanges(userId, 30, now)]);
    const dated = exp.items.filter((i) => i.prediction.expiresAt && i.prediction.atRiskPoints > 0).sort((a, b) => (a.prediction.daysLeft ?? 9e9) - (b.prediction.daysLeft ?? 9e9));
    const unused = certs.filter((c) => c.category === 'FREE_NIGHT' && c.view.effectiveStatus === 'AVAILABLE');
    const atRiskStatus = statuses.filter((s) => s.current && (s.view.risk === 'HIGH' || s.view.risk === 'MEDIUM'));
    const redeemFirst = [
      ...dated.slice(0, 3).map((i) => ({ kind: 'POINTS', label: `${i.balance.toLocaleString('en-US')} ${i.program} ${i.unit}`, member: i.member, daysLeft: i.prediction.daysLeft, valueCents: i.valueCents })),
      ...certs.filter((c) => c.view.effectiveStatus === 'AVAILABLE' && c.view.daysLeft != null).sort((a, b) => (a.view.daysLeft ?? 0) - (b.view.daysLeft ?? 0)).slice(0, 3).map((c) => ({ kind: c.category, label: c.name, member: c.member, daysLeft: c.view.daysLeft, valueCents: c.potentialValueCents })),
    ].sort((a, b) => (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9)).slice(0, 5);
    const stale = fresh.accounts.filter((a) => a.freshness === 'STALE' || a.freshness === 'NEVER');
    const mostAtRisk = [...exp.items].filter((i) => i.prediction.atRiskPoints > 0 && i.prediction.level !== 'NONE').sort((a, b) => b.prediction.atRiskPoints * b.valueCents - a.prediction.atRiskPoints * a.valueCents).slice(0, 3);
    const qa = [
      { question: 'What loyalty assets are expiring next?', answer: dated.length ? `${dated[0].program}: ${dated[0].prediction.atRiskPoints.toLocaleString('en-US')} ${dated[0].unit} in ${dated[0].prediction.daysLeft} day(s) (confidence ${dated[0].prediction.confidence}%).` : 'Nothing with a known expiry date.', items: dated.slice(0, 5).map((i) => i.message ?? i.program) },
      { question: 'What free night certificates remain unused?', answer: unused.length ? `${unused.length} unused: ${unused.slice(0, 3).map((c) => `${c.name}${c.view.daysLeft != null ? ` (${c.view.daysLeft} days)` : ''}`).join(', ')}.` : 'None.', items: unused.map((c) => c.name) },
      { question: 'What is my total loyalty portfolio value?', answer: `${usd(valuation.currentCents)} now, ${usd(valuation.potentialCents)} potential; ${usd(valuation.atRiskCents)} at risk, ${usd(valuation.expiredCents)} expired, ${usd(valuation.recoveredCents)} recovered.`, items: [] as string[] },
      { question: 'What elite statuses are at risk?', answer: atRiskStatus.length ? atRiskStatus.map((s) => s.view.headline).join('; ') + '.' : 'None.', items: atRiskStatus.map((s) => s.view.headline) },
      { question: 'What rewards should I redeem first?', answer: redeemFirst.length ? redeemFirst.map((r) => `${r.label} (${r.member}${r.daysLeft != null ? `, ${r.daysLeft} days` : ''})`).join('; ') + '.' : 'Nothing is urgent.', items: redeemFirst.map((r) => r.label) },
      { question: 'What accounts have not refreshed recently?', answer: stale.length ? `${stale.length}: ${stale.slice(0, 4).map((a) => `${a.program} (${a.member})`).join(', ')}.` : 'All accounts are current.', items: stale.map((a) => `${a.program} (${a.member})`) },
      { question: 'What balances changed recently?', answer: changes.changes.filter((c) => c.what === 'balance').length ? `${changes.changes.filter((c) => c.what === 'balance').length} balance update(s) in the last ${changes.days} days.` : 'No balance changes recorded.', items: changes.changes.slice(0, 5).map((c) => `${c.program}: ${c.what}`) },
      { question: 'What points are most at risk?', answer: mostAtRisk.length ? mostAtRisk.map((i) => `${i.balance.toLocaleString('en-US')} ${i.program} ${i.unit} (${i.prediction.level.toLowerCase()})`).join('; ') + '.' : 'None.', items: mostAtRisk.map((i) => i.program) },
    ];
    return { generatedAt: now, questions: qa };
  }

  // ───────────── extension tokens ─────────────

  async listTokens(userId: string) {
    return this.prisma.personalAccessToken.findMany({ where: { userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } }, select: { id: true, name: true, prefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  /** A token that can only post loyalty snapshots; shown once, never stored in the clear. */
  async createToken(userId: string, name: string, expiresInDays = 90) {
    const active = await this.prisma.personalAccessToken.count({ where: { userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } } });
    if (active >= 5) throw new NotFoundException('Maximum of 5 active extension tokens');
    const token = PAT_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.personalAccessToken.create({ data: { userId, name, prefix: token.slice(0, PAT_PREFIX.length + 6), tokenHash: hashToken(token), scopes: [EXTENSION_SCOPE], expiresAt: new Date(Date.now() + expiresInDays * DAY) } });
    return { id: row.id, name: row.name, token, expiresAt: row.expiresAt, scopes: row.scopes };
  }

  async revokeToken(userId: string, id: string) {
    const r = await this.prisma.personalAccessToken.updateMany({ where: { id, userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Token not found');
  }
}
