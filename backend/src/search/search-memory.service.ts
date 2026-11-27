import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SearchEntryKind } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Related } from '../domain/answer-compose';
import { Understanding } from '../domain/query-understanding';
import { emptySlots, sanitizeSlots, Slots } from '../domain/search-router';
import { EntryRefs, EntryRow, isStale, MAX_HISTORY, MAX_SAVED, normalizeQuery, pushTurn, redactQuery, refsFrom, summarizeHistory } from '../domain/search-history';

const toRow = (e: { id: string; query: string; normalized: string; intent: string | null; kind: SearchEntryKind; name: string | null; uses: number; summary: string | null; entityRefs: Prisma.JsonValue | null; lastUsedAt: Date }): EntryRow => ({
  id: e.id,
  query: e.query,
  normalized: e.normalized,
  intent: e.intent,
  kind: e.kind,
  name: e.name,
  uses: e.uses,
  summary: e.summary,
  entityRefs: (e.entityRefs as unknown as EntryRefs | null) ?? null,
  lastUsedAt: e.lastUsedAt,
});

/** The search bar's memory of one member: the conversation in progress, the questions asked, and the searches kept. */
@Injectable()
export class SearchMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────── conversation ─────────────

  /** The slots of a conversation the member owns and that is not stale; null for an unknown, someone else's or idle one. */
  async slotsOf(userId: string, sessionId: string | undefined, now: Date): Promise<Slots | null> {
    if (!sessionId) return null;
    const s = await this.prisma.searchSession.findFirst({ where: { id: sessionId, userId }, select: { slots: true, updatedAt: true } });
    if (!s || isStale(s.updatedAt, now)) return null;
    return sanitizeSlots(s.slots) ?? emptySlots();
  }

  /** Writes the slots and the turn; starts a conversation when there is none. Returns its id. */
  async remember(userId: string, sessionId: string | undefined, slots: Slots, turn: { q: string; intent: string | null; summary: string }, now: Date): Promise<string> {
    const existing = sessionId ? await this.prisma.searchSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, turns: true, updatedAt: true } }) : null;
    const t = { q: redactQuery(turn.q), intent: turn.intent, summary: turn.summary.slice(0, 200), at: now.toISOString() };
    if (existing && !isStale(existing.updatedAt, now)) {
      await this.prisma.searchSession.update({ where: { id: existing.id }, data: { slots: slots as unknown as Prisma.InputJsonValue, turns: pushTurn(existing.turns, t) as unknown as Prisma.InputJsonValue } });
      return existing.id;
    }
    // idle conversations of this member are cleared as a new one starts
    await this.prisma.searchSession.deleteMany({ where: { userId, updatedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
    const created = await this.prisma.searchSession.create({ data: { userId, slots: slots as unknown as Prisma.InputJsonValue, turns: pushTurn([], t) as unknown as Prisma.InputJsonValue } });
    return created.id;
  }

  // ───────────── history ─────────────

  /** Counts a question that was answered. The same question again raises its count; only the newest MAX_HISTORY are kept. */
  async record(userId: string, q: string, u: Understanding, summary: string, related: Related[], now: Date): Promise<void> {
    const normalized = normalizeQuery(q);
    if (!normalized) return;
    const data = { query: redactQuery(q), intent: u.intent === 'UNKNOWN' ? null : u.intent, summary: summary.slice(0, 200), entityRefs: refsFrom(u, related) as unknown as Prisma.InputJsonValue, lastUsedAt: now };
    await this.prisma.searchEntry.upsert({
      where: { userId_normalized_kind: { userId, normalized, kind: 'HISTORY' } },
      update: { ...data, uses: { increment: 1 } },
      create: { userId, normalized, kind: 'HISTORY', ...data },
    });
    const extra = await this.prisma.searchEntry.findMany({ where: { userId, kind: 'HISTORY' }, orderBy: { lastUsedAt: 'desc' }, skip: MAX_HISTORY, select: { id: true } });
    if (extra.length) await this.prisma.searchEntry.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
  }

  async entries(userId: string): Promise<EntryRow[]> {
    return (await this.prisma.searchEntry.findMany({ where: { userId }, orderBy: { lastUsedAt: 'desc' }, take: MAX_HISTORY + MAX_SAVED })).map(toRow);
  }

  /** A short list for the empty bar: saved searches, then recent questions. */
  async quick(userId: string) {
    const rows = await this.prisma.searchEntry.findMany({ where: { userId }, orderBy: { lastUsedAt: 'desc' }, take: 60 });
    const d = summarizeHistory(rows.map(toRow));
    return { saved: d.saved.slice(0, 4), recent: d.recent.slice(0, 4) };
  }

  async dashboard(userId: string) {
    const [entries, plans, trips] = await Promise.all([
      this.entries(userId),
      this.prisma.plannedPurchase.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, merchantText: true, item: true, amountCents: true, status: true, plannedFor: true, createdAt: true } }),
      this.prisma.awardTrip.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, destination: true, dateFrom: true, dateTo: true, cabin: true, createdAt: true } }),
    ]);
    return { ...summarizeHistory(entries), recentPlans: plans, recentTrips: trips, totals: { questions: entries.filter((e) => e.kind === 'HISTORY').reduce((s, e) => s + e.uses, 0), saved: entries.filter((e) => e.kind === 'SAVED').length } };
  }

  async clearHistory(userId: string): Promise<{ removed: number }> {
    const r = await this.prisma.searchEntry.deleteMany({ where: { userId, kind: 'HISTORY' } });
    return { removed: r.count };
  }

  async removeEntry(userId: string, id: string): Promise<void> {
    const r = await this.prisma.searchEntry.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Search not found');
  }

  // ───────────── saved searches ─────────────

  async save(userId: string, query: string, name: string | undefined, now: Date): Promise<EntryRow> {
    const normalized = normalizeQuery(query);
    if (!normalized) throw new BadRequestException('Nothing to save');
    const existing = await this.prisma.searchEntry.findUnique({ where: { userId_normalized_kind: { userId, normalized, kind: 'SAVED' } } });
    if (!existing && (await this.prisma.searchEntry.count({ where: { userId, kind: 'SAVED' } })) >= MAX_SAVED) throw new BadRequestException(`You can keep up to ${MAX_SAVED} saved searches`);
    // a saved search keeps the details of the question it came from
    const from = await this.prisma.searchEntry.findUnique({ where: { userId_normalized_kind: { userId, normalized, kind: 'HISTORY' } } });
    const label = name?.trim().slice(0, 80) || null;
    const row = await this.prisma.searchEntry.upsert({
      where: { userId_normalized_kind: { userId, normalized, kind: 'SAVED' } },
      update: { name: label ?? existing?.name ?? null, lastUsedAt: now },
      create: { userId, normalized, kind: 'SAVED', query: redactQuery(query), name: label, intent: from?.intent ?? null, summary: from?.summary ?? null, entityRefs: (from?.entityRefs as Prisma.InputJsonValue | null) ?? undefined, lastUsedAt: now },
    });
    return toRow(row);
  }

  /** Whether a question is saved, for the star in the answer. */
  async isSaved(userId: string, q: string): Promise<EntryRow | null> {
    const normalized = normalizeQuery(q);
    if (!normalized) return null;
    const row = await this.prisma.searchEntry.findUnique({ where: { userId_normalized_kind: { userId, normalized, kind: 'SAVED' } } });
    return row ? toRow(row) : null;
  }
}
