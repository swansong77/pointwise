import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { checkDecision, checkPreferences, Decision, EMPTY_PREFS, MAX_MEMORY_ROWS, Preferences } from '../domain/copilot-memory';

const PREFS_KEY = 'preferences';

/** What Copilot remembers: preferences, decisions about plan items, and what it already recommended. Stays in PointWise. */
@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async preferences(userId: string): Promise<Preferences> {
    const row = await this.prisma.copilotMemory.findUnique({ where: { userId_kind_key: { userId, kind: 'PREFERENCE', key: PREFS_KEY } } });
    const v = (row?.value ?? {}) as Partial<Preferences>;
    return { ...EMPTY_PREFS, ...v };
  }

  async setPreferences(userId: string, input: unknown): Promise<Preferences> {
    const c = checkPreferences(input);
    if (!c.ok) throw new BadRequestException(c.error);
    const merged: Preferences = { ...(await this.preferences(userId)), ...c.value };
    await this.prisma.copilotMemory.upsert({
      where: { userId_kind_key: { userId, kind: 'PREFERENCE', key: PREFS_KEY } },
      update: { value: merged as unknown as Prisma.InputJsonValue },
      create: { userId, kind: 'PREFERENCE', key: PREFS_KEY, value: merged as unknown as Prisma.InputJsonValue, source: 'USER' },
    });
    return merged;
  }

  /** active decisions by item id; expired ones are removed */
  async decisions(userId: string, now: Date): Promise<Map<string, Decision>> {
    await this.prisma.copilotMemory.deleteMany({ where: { userId, kind: 'DECISION', updatedAt: { lt: new Date(now.getTime() - 100 * 86_400_000) } } });
    const rows = await this.prisma.copilotMemory.findMany({ where: { userId, kind: 'DECISION' }, take: MAX_MEMORY_ROWS });
    const out = new Map<string, Decision>();
    for (const r of rows) {
      const d = r.value as unknown as Decision;
      if (d && typeof d.until === 'string' && new Date(d.until).getTime() > now.getTime()) out.set(r.key, d);
    }
    return out;
  }

  async decide(userId: string, body: { itemId: unknown; action: unknown; days?: unknown }, now = new Date()): Promise<Decision> {
    const c = checkDecision(body, now);
    if (!c.ok) throw new BadRequestException(c.error);
    const where = { userId_kind_key: { userId, kind: 'DECISION' as const, key: c.value.itemId } };
    if (!(await this.prisma.copilotMemory.findUnique({ where })) && (await this.prisma.copilotMemory.count({ where: { userId } })) >= MAX_MEMORY_ROWS) throw new BadRequestException('Copilot is remembering too many things. Forget some first.');
    await this.prisma.copilotMemory.upsert({ where, update: { value: c.value as unknown as Prisma.InputJsonValue, source: 'USER' }, create: { userId, kind: 'DECISION', key: c.value.itemId, value: c.value as unknown as Prisma.InputJsonValue, source: 'USER' } });
    return c.value;
  }

  /** what was recommended, so it can be shown and not repeated forever */
  async recordRecommended(userId: string, items: Array<{ id: string; title: string }>, now: Date) {
    for (const it of items.slice(0, 3)) {
      const where = { userId_kind_key: { userId, kind: 'RECOMMENDATION' as const, key: it.id } };
      const prev = await this.prisma.copilotMemory.findUnique({ where });
      const shown = ((prev?.value as { shown?: number } | undefined)?.shown ?? 0) + 1;
      const value = { shown, lastShownAt: now.toISOString(), title: it.title.slice(0, 120) } as unknown as Prisma.InputJsonValue;
      await this.prisma.copilotMemory.upsert({ where, update: { value }, create: { userId, kind: 'RECOMMENDATION', key: it.id, value, source: 'COPILOT' } });
    }
    const extra = (await this.prisma.copilotMemory.count({ where: { userId, kind: 'RECOMMENDATION' } })) - 100;
    if (extra > 0) {
      const old = await this.prisma.copilotMemory.findMany({ where: { userId, kind: 'RECOMMENDATION' }, orderBy: { updatedAt: 'asc' }, take: extra, select: { id: true } });
      await this.prisma.copilotMemory.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
  }

  list(userId: string) {
    return this.prisma.copilotMemory.findMany({ where: { userId }, orderBy: [{ kind: 'asc' }, { updatedAt: 'desc' }], take: MAX_MEMORY_ROWS });
  }

  async forget(userId: string, id: string) {
    const r = await this.prisma.copilotMemory.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Nothing to forget');
  }

  async forgetAll(userId: string, kind?: 'PREFERENCE' | 'DECISION' | 'RECOMMENDATION') {
    return { removed: (await this.prisma.copilotMemory.deleteMany({ where: { userId, ...(kind ? { kind } : {}) } })).count };
  }
}
