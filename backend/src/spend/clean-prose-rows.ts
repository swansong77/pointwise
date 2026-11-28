/** Removes sentence rows stored by statement PDFs imported before the prose fix (see scripts/clean-prose-rows.ts). */
import { PrismaClient } from "@prisma/client";
import { isProse } from "../domain/spend-pdf";


const usd = (c: number) => (c / 100).toFixed(2);

export async function cleanProseRows(prisma: PrismaClient, apply: boolean, log: (line: string) => void = console.log) {
  const rows = await prisma.transaction.findMany({
    where: { source: "PDF", externalId: { startsWith: "pdf:" } },
    select: { id: true, walletCardId: true, amountCents: true, kind: true, description: true },
  });
  const prose = rows.filter((r) => r.description && isProse(r.description));
  const ids = prose.map((r) => r.id);
  const linked = new Set<string>();
  if (ids.length) {
    for (const u of await prisma.benefitUsage.findMany({
      where: { OR: [{ transactionId: { in: ids } }, { creditTransactionId: { in: ids } }] },
      select: { transactionId: true, creditTransactionId: true },
    })) {
      if (u.transactionId) linked.add(u.transactionId);
      if (u.creditTransactionId) linked.add(u.creditTransactionId);
    }
    for (const d of await prisma.benefitDetection.findMany({ where: { transactionId: { in: ids } }, select: { transactionId: true } })) linked.add(d.transactionId);
  }
  const deletable = prose.filter((r) => !linked.has(r.id));
  const perCard = new Map<string, { n: number; cents: number }>();
  for (const r of deletable) {
    const e = perCard.get(r.walletCardId) ?? { n: 0, cents: 0 };
    e.n++;
    e.cents += r.amountCents;
    perCard.set(r.walletCardId, e);
  }
  log(`PDF-imported rows checked: ${rows.length}`);
  log(`rows that are really sentences: ${prose.length} (total ${usd(prose.reduce((n, r) => n + r.amountCents, 0))})`);
  log(`  kept because a benefit record points at them: ${prose.length - deletable.length}`);
  log(`  to delete: ${deletable.length} across ${perCard.size} card(s)`);
  let i = 0;
  for (const [, e] of perCard) log(`    card ${++i}: ${e.n} rows, ${usd(e.cents)}`);
  if (!apply) {
    log("dry run: nothing changed. Run again with --apply to delete the rows above.");
    return { found: deletable.length, deleted: 0 };
  }
  const res = await prisma.transaction.deleteMany({ where: { id: { in: deletable.map((r) => r.id) } } });
  log(`deleted ${res.count} rows.`);
  return { found: deletable.length, deleted: res.count };
}
