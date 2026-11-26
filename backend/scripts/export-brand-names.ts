/**
 * Writes the names the app shows logos for (issuers, merchants, loyalty programs, reward currencies, networks) from the
 * seed data to frontend/test/fixtures/catalog-names.json. The frontend test uses it to prove every name resolves to a
 * brand entry, and a backend test fails when this file is out of date. Names only: no personal data.
 *   npx ts-node --transpile-only scripts/export-brand-names.ts
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import { catalogNames } from '../src/seed/brand-names';

const out = join(__dirname, '../../frontend/test/fixtures/catalog-names.json');
writeFileSync(out, JSON.stringify(catalogNames(), null, 2) + '\n');
console.log(`wrote ${out}`);
