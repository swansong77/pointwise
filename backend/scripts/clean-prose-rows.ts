/**
 * One-off cleanup for statement PDFs that were imported before the "sentence read as a transaction" fix
 * (two-column Capital One summary pages: a date-led sentence sharing a line with "Payments - $xx.xx" was stored as a
 * second copy of the payment).
 *
 *   cd backend
 *   npx ts-node scripts/clean-prose-rows.ts            # dry run: counts and totals only, changes nothing
 *   npx ts-node scripts/clean-prose-rows.ts --apply    # deletes exactly the rows the dry run listed
 *
 * It only looks at rows imported from a PDF (source PDF, id starting "pdf:") whose description is prose by the same rule
 * the importer now uses. A row that a benefit usage or detection points at is never deleted: it is reported instead.
 * Output is counts and dollar totals only: no descriptions, merchants or account details are printed.
 * Re-importing the statement afterwards finds the real rows already recorded and adds nothing twice.
 */
import { PrismaClient } from "@prisma/client";
import { cleanProseRows } from "../src/spend/clean-prose-rows";

const prisma = new PrismaClient();
cleanProseRows(prisma, process.argv.includes("--apply")).finally(() => prisma.$disconnect());
