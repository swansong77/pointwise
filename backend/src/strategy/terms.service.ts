import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';

export interface TermHit {
  cardId: string;
  slug: string;
  card: string;
  kind: 'description' | 'bonus' | 'feature' | 'earning' | 'benefit';
  text: string;
  /** matching fragment with «…» around the matched words */
  snippet: string;
  rank: number;
}

/**
 * Fine-print search over the public card catalog (descriptions, welcome-bonus text, features,
 * earning rules, benefit terms) with PostgreSQL full-text search — retrieval for "does card X
 * include Y?" questions without embeddings or any external AI service. Public data only:
 * private cards (ownerId set) and inactive cards are excluded.
 */
@Injectable()
export class TermsService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string, opts: { card?: string; limit?: number } = {}): Promise<{ query: string; hits: TermHit[] }> {
    const query = q.trim().slice(0, 200);
    if (!query) return { query, hits: [] };
    const limit = Math.min(50, Math.max(1, opts.limit ?? 10));
    const card = opts.card?.trim() || null;
    const rows = await this.prisma.$queryRaw<Array<{ card_id: string; slug: string; card: string; kind: TermHit['kind']; txt: string; snippet: string; rank: number }>>(Prisma.sql`
      WITH cards AS (
        SELECT c.id, c.slug, c.name, c.description, c."bonusDescription"
        FROM "CreditCard" c
        WHERE c."ownerId" IS NULL AND c."isActive" = true
          AND (${card}::text IS NULL OR c.slug = ${card}::text OR c.name ILIKE '%' || ${card}::text || '%')
      ),
      docs AS (
        SELECT id AS card_id, slug, name AS card, 'description' AS kind, description AS txt FROM cards
        UNION ALL SELECT id, slug, name, 'bonus', "bonusDescription" FROM cards
        UNION ALL SELECT f."cardId", c.slug, c.name, 'feature', f.text FROM "CardFeature" f JOIN cards c ON c.id = f."cardId"
        UNION ALL SELECT r."cardId", c.slug, c.name, 'earning', r.description FROM "Reward" r JOIN cards c ON c.id = r."cardId"
        UNION ALL SELECT b."cardId", c.slug, c.name, 'benefit', concat_ws('. ', b.name, b."howIssued", b."actionNeeded", b.notes)
          FROM "Benefit" b JOIN cards c ON c.id = b."cardId" WHERE b."isActive" = true
      ),
      q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
      SELECT d.card_id, d.slug, d.card, d.kind, d.txt,
             ts_headline('english', d.txt, q.tsq, 'StartSel=«, StopSel=», MaxWords=30, MinWords=10, MaxFragments=1') AS snippet,
             ts_rank(to_tsvector('english', d.txt), q.tsq)::float8 AS rank
      FROM docs d, q
      WHERE d.txt IS NOT NULL AND d.txt <> '' AND to_tsvector('english', d.txt) @@ q.tsq
      ORDER BY rank DESC, d.card ASC
      LIMIT ${limit}
    `);
    return { query, hits: rows.map((r) => ({ cardId: r.card_id, slug: r.slug, card: r.card, kind: r.kind, text: r.txt, snippet: r.snippet, rank: Math.round(r.rank * 1000) / 1000 })) };
  }
}
