import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { catalogNames } from '../../../src/seed/brand-names';

// The frontend folder is not in the backend test container; the check runs wherever both folders exist (local, CI).
const fixture = join(__dirname, '../../../../frontend/test/fixtures/catalog-names.json');
const run = existsSync(fixture) ? describe : describe.skip;

run('catalog names for the brand coverage test', () => {
  it('the committed list matches the seed data (regenerate with scripts/export-brand-names.ts)', () => {
    expect(JSON.parse(readFileSync(fixture, 'utf8'))).toEqual(JSON.parse(JSON.stringify(catalogNames())));
  });
});
