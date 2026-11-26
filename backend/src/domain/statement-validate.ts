/**
 * Statement validation (pure): did the import capture everything printed on the statement?
 * Compares an independent scan of the statement (count and total of dated amount lines) with what
 * was imported, and reports PASS / WARNING / FAILED with a confidence score.
 */
export type ValidationStatus = "PASS" | "WARNING" | "FAILED";

export interface ValidationInput {
  /** from scanStatementPdf, or the CSV data-row count / sum */
  statement: { count: number; cents: number };
  /** rows read by the parser (new + already known) */
  imported: { count: number; cents: number };
  /** lines the parser could not read */
  unreadLines?: number;
  /** the statement itself shows a zero balance and no activity */
  noActivity?: boolean;
  /** totals the statement prints, and the same totals computed from the imported rows */
  printed?: { credits: number[]; charges: number[]; rowCredits: number; rowCharges: number } | null;
}

export interface StatementValidationResult {
  statementCount: number;
  importedCount: number;
  differenceCount: number;
  statementCents: number;
  importedCents: number;
  missingCents: number;
  confidence: number;
  status: ValidationStatus;
  notes: string[];
}

export const WARN_COUNT_RATIO = 0.05;

export function validateStatement(i: ValidationInput): StatementValidationResult {
  const sc = i.statement.count;
  const ic = i.imported.count;
  const diff = sc - ic;
  const missing = Math.max(0, i.statement.cents - i.imported.cents);
  const unread = i.unreadLines ?? 0;
  const notes: string[] = [];
  let status: ValidationStatus;
  let printedGap = 0;
  if (sc === 0 && ic === 0 && i.noActivity) {
    status = "PASS";
    notes.push("The statement shows no activity for this period.");
  } else if (sc === 0 && ic === 0) {
    status = "FAILED";
    notes.push("No transactions were found on this statement.");
  } else if (diff === 0 && missing === 0 && unread === 0) {
    status = "PASS";
  } else if (
    diff >= 0 &&
    diff <= Math.max(1, Math.floor(sc * WARN_COUNT_RATIO)) &&
    unread <= Math.max(1, Math.floor(sc * WARN_COUNT_RATIO)) &&
    missing <= Math.max(5_000, Math.floor(i.statement.cents * 0.02))
  ) {
    status = "WARNING";
  } else {
    status = "FAILED";
  }
  if (i.printed) {
    const nearest = (options: number[], v: number) => options.reduce((b, o) => (Math.abs(o - v) < Math.abs(b - v) ? o : b), options[0] ?? 0);
    const checks: Array<[string, number[], number]> = [
      ["charges", i.printed.charges, i.printed.rowCharges],
      ["payments and credits", i.printed.credits, i.printed.rowCredits],
    ];
    for (const [label, options, got] of checks) {
      if (options.includes(got)) continue;
      const want = nearest(options, got);
      const gap = Math.abs(want - got);
      notes.push(`The statement prints ${label} of ${(want / 100).toFixed(2)} but the imported rows total ${(got / 100).toFixed(2)}.`);
      printedGap = Math.max(printedGap, gap);
    }
    if (printedGap > 0) {
      const big = printedGap >= 5_000 || printedGap > Math.max(i.statement.cents, 1) * 0.02;
      if (status === "PASS" || status === "WARNING") status = big ? "FAILED" : "WARNING";
    }
  }
  if (diff > 0) notes.push(`${diff} transaction${diff === 1 ? "" : "s"} on the statement were not imported.`);
  if (diff < 0) notes.push(`${-diff} more rows were imported than the statement scan found.`);
  if (missing > 0) notes.push(`${(missing / 100).toFixed(2)} of statement amounts are missing.`);
  if (unread > 0) notes.push(`${unread} line${unread === 1 ? "" : "s"} could not be read.`);
  const penalty =
    (printedGap > 0 ? 40 : 0) +
    Math.abs(diff) * 15 + unread * 10 + (sc ? Math.round((missing / Math.max(1, i.statement.cents)) * 100) : 0);
  const confidence =
    status === "PASS" ? 100 : Math.max(0, Math.min(status === "WARNING" ? 90 : 60, 100 - penalty));
  return {
    statementCount: sc,
    importedCount: ic,
    differenceCount: diff,
    statementCents: i.statement.cents,
    importedCents: i.imported.cents,
    missingCents: missing,
    confidence,
    status,
    notes,
  };
}
