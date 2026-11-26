import { readFileSync } from 'fs';
import { join } from 'path';
import { catalogNames } from '../../../src/seed/brand-names';

describe('catalog names for the brand coverage test', () => {
  it('the committed list matches the seed data (regenerate with scripts/export-brand-names.ts)', () => {
    const file = JSON.parse(readFileSync(join(__dirname, '../../../../frontend/test/fixtures/catalog-names.json'), 'utf8'));
    expect(file).toEqual(JSON.parse(JSON.stringify(catalogNames())));
  });
});
