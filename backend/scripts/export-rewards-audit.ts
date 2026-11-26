/**
 * Audits the category earning rates of every card in the seed data and writes docs/rewards-audit.md.
 *   npx ts-node --transpile-only scripts/export-rewards-audit.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { auditAll, renderAudit } from '../src/domain/reward-audit';
import { auditCards } from '../src/seed/reward-audit-data';

const { cards, currencies } = auditCards();
const result = auditAll(cards, currencies);
const out = join(__dirname, '../../docs/rewards-audit.md');
writeFileSync(out, renderAudit(result, new Date().toISOString().slice(0, 10), cards));
console.log(`${result.cards} cards: ${result.bySeverity.error} errors, ${result.bySeverity.warn} warnings; ${result.verifiedCards} fully and ${result.partiallyVerified} partly confirmed -> ${out}`);
console.log(JSON.stringify(result.byCode));
