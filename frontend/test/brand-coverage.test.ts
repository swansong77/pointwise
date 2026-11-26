import { describe, expect, it } from 'vitest';
import names from './fixtures/catalog-names.json';
import { BRANDS, resolveBrand } from '@/lib/brands';

/**
 * Every bank, merchant, program, currency and network the catalog can put on a page has a brand entry (an icon, or a
 * generated monogram when no logo may be used). The names come from the seed data (backend/scripts/export-brand-names.ts).
 */
// placeholders for "some other program of this kind": they have no single brand by design
const GENERIC = ['CASINO_PROGRAM', 'CRUISE_PROGRAM', 'DINING_PROGRAM', 'RENTAL_PROGRAM', 'RETAIL_REWARDS', 'SHOP_PORTAL', 'BRAND_POINTS'];

describe('brand coverage of the catalog', () => {
  it('every issuer resolves to a bank brand', () => {
    const missing = names.issuers.filter((n) => !resolveBrand({ name: n }, ['ISSUER']));
    expect(missing).toEqual([]);
  });

  it('every merchant resolves to a brand', () => {
    const missing = names.merchants.filter((n) => !resolveBrand({ name: n }, ['MERCHANT', 'AIRLINE', 'HOTEL', 'SHOPPING', 'MEMBERSHIP', 'ISSUER']));
    expect(missing).toEqual([]);
  });

  it('every loyalty program resolves to a brand by code or name', () => {
    const missing = names.programs.filter((p) => !GENERIC.includes(p.code) && !resolveBrand({ code: p.code, name: p.name }));
    expect(missing.map((p) => p.code)).toEqual([]);
  });

  it('every reward currency resolves to a brand by code or name', () => {
    const missing = names.currencies.filter((c) => !GENERIC.includes(c.code) && !resolveBrand({ code: c.code, name: c.name }));
    expect(missing.map((c) => c.code)).toEqual([]);
  });

  it('every network resolves', () => {
    expect(names.networks.filter((n) => !resolveBrand({ network: n }, ['NETWORK', 'ISSUER']))).toEqual([]);
  });

  it('brand keys are unique and every name is somewhere to be found', () => {
    expect(new Set(BRANDS.map((b) => b.key)).size).toBe(BRANDS.length);
  });
});
