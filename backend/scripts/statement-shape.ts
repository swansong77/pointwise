/**
 * Local diagnostic for a statement PDF that does not import cleanly. Run it yourself, on your own machine:
 *
 *   cd backend && npx ts-node scripts/statement-shape.ts /path/to/Statement.pdf > shape.txt
 *
 * It reads the file with the same sandboxed extractor and parser the importer uses, and prints ONLY the
 * layout: every letter becomes "a"/"A" and every digit "9", so no merchant, name, account number or amount
 * is shown. Section headings are the one exception (they are fixed wording such as "Payments, Credits and
 * Adjustments"). Nothing is sent anywhere. Check shape.txt before sharing it.
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { findPeriod, joinSplitLines, matchTxLine, parseStatementPdf, printedTotals, scanStatementPdf } from "../src/domain/spend-pdf";

const file = process.argv[2];
if (!file) {
  console.error("usage: ts-node scripts/statement-shape.ts <statement.pdf>");
  process.exit(2);
}

const HEADING = /^(?:standard purchases?|purchases?|payments?[, ]|credits|other credits|transactions|new charges|fees|interest|cash advances|total|account summary|previous balance|new balance|trans date|post date|cardholder|page \d)/i;
const mask = (s: string) => s.replace(/[A-Z]/g, "A").replace(/[a-z]/g, "a").replace(/\d/g, "9");

const raw = execFileSync("node", [join(__dirname, "../src/spend/pdf-text.mjs")], { input: readFileSync(file), maxBuffer: 64 * 1024 * 1024 });
const { pages, error } = JSON.parse(raw.toString()) as { pages?: string[][]; error?: string };
if (!pages) {
  console.log(`extractor error: ${error}`);
  process.exit(1);
}

const out: string[] = [];
let n = 0;
for (const [pi, page] of pages.entries()) {
  out.push(`--- page ${pi + 1}: ${page.length} lines`);
  for (const line of joinSplitLines(page)) {
    n++;
    const l = line.trim();
    if (!l) continue;
    const tx = matchTxLine(l) ? "TX " : "   ";
    const shown = HEADING.test(l) && l.length <= 48 && !/\d\.\d{2}/.test(l) && !matchTxLine(l) ? l.replace(/[$\d,.\-]+/g, (m) => mask(m)) : mask(l);
    out.push(`${String(n).padStart(4)} ${tx}${shown.slice(0, 110)}`);
  }
}

const parsed = parseStatementPdf(pages, "x");
const keyOf = (r: { occurredAt: Date; signedCents: number; description: string }) => `${r.occurredAt.toISOString().slice(0, 10)}|${r.signedCents}|${r.description}`;
const counts = new Map<string, number>();
for (const r of parsed.rows) counts.set(keyOf(r), (counts.get(keyOf(r)) ?? 0) + 1);
const dup = [...counts.values()].filter((c) => c > 1).length;
const t = printedTotals(pages);
out.push("");
out.push(`rows ${parsed.rows.length} (credits ${parsed.rows.filter((r) => r.signedCents < 0).length}, charges ${parsed.rows.filter((r) => r.signedCents > 0).length})`);
out.push(`rows that repeat another row exactly (same date, amount, description): ${dup}`);
out.push(`scan count ${scanStatementPdf(pages).count}; period found: ${findPeriod(pages.flat()).end ? "yes" : "no"}`);
out.push(`printed credit totals recognised: ${t ? t.credits.length : "no summary"}; printed charge totals recognised: ${t ? t.charges.length : "no summary"}`);
console.log(out.join("\n"));
