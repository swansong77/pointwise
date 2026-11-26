import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRANDS, brandsOfKind, initials, KIND_LABEL, KIND_ORDER, logoUrl, monogramColor, normalize, resolveBrand } from '../src/lib/brands';

const PUBLIC = join(__dirname, '../public/brands');

describe('brand library', () => {
  it('keys are unique and every kind has brands', () => {
    expect(new Set(BRANDS.map((b) => b.key)).size).toBe(BRANDS.length);
    for (const k of KIND_ORDER) {
      expect(brandsOfKind(k).length).toBeGreaterThan(0);
      expect(KIND_LABEL[k]).toBeTruthy();
    }
    expect(BRANDS.length).toBeGreaterThanOrEqual(85);
  });
  it('every icon file exists, is a plain SVG (shapes only: no scripts, links, images or styles) and nothing is left over', () => {
    const withFile = BRANDS.filter((b) => b.file);
    expect(withFile.length).toBeGreaterThanOrEqual(45);
    for (const b of withFile) {
      const path = join(PUBLIC, b.file!);
      expect(existsSync(path)).toBe(true);
      const svg = readFileSync(path, 'utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(b.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(svg).toContain(`fill="${b.hex}"`);
      expect([...svg.matchAll(/<([a-zA-Z]+)/g)].map((m) => m[1]).every((t) => ['svg', 'title', 'path'].includes(t))).toBe(true);
      expect(svg).not.toMatch(/script|javascript:|on\w+=|href|<style|foreignObject|<image/i);
      expect(logoUrl(b)).toBe(`/brands/${b.file}`);
    }
    const onDisk = readdirSync(PUBLIC).filter((f) => f.endsWith('.svg'));
    expect(onDisk.sort()).toEqual(withFile.map((b) => b.file!).sort());
    expect(existsSync(join(PUBLIC, 'LICENSE-simple-icons.md'))).toBe(true);
    expect(logoUrl(BRANDS.find((b) => !b.file)!)).toBeNull();
  });
  it('the programs, banks and bank currencies in the catalog all have a brand', () => {
    for (const code of ['AA_AADVANTAGE', 'UA_MILEAGEPLUS', 'DL_SKYMILES', 'WN_RAPIDREWARDS', 'AS_MILEAGEPLAN', 'B6_TRUEBLUE', 'AC_AEROPLAN', 'BA_AVIOS', 'VS_FLYINGCLUB', 'AF_FLYINGBLUE', 'SQ_KRISFLYER', 'QR_PRIVILEGE', 'EK_SKYWARDS', 'EY_GUEST', 'HA_HAWAIIANMILES', 'MAR_BONVOY', 'HH_HONORS', 'WOH_HYATT', 'IHG_ONE', 'WYN_REWARDS', 'CHOICE_PRIV', 'BW_REWARDS', 'ACCOR_ALL', 'AMEX_MR', 'CHASE_UR', 'C1_MILES', 'CITI_TYP', 'BILT_POINTS', 'WF_REWARDS', 'BOA_POINTS', 'USB_REWARDS', 'RAKUTEN', 'TOPCASHBACK', 'HILTON_POINTS', 'MARRIOTT_POINTS', 'HYATT_POINTS', 'UNITED_MILES', 'DELTA_MILES'])
      expect(resolveBrand({ code }), code).not.toBeNull();
    for (const issuer of ['Chase', 'American Express', 'Citi', 'Capital One', 'Bank of America', 'Wells Fargo', 'U.S. Bank', 'Discover']) expect(resolveBrand({ name: issuer }, ['ISSUER']), issuer).not.toBeNull();
    for (const net of ['VISA', 'MASTERCARD']) expect(resolveBrand({ network: net }), net).not.toBeNull();
    expect(resolveBrand({ network: 'AMEX' }, ['NETWORK', 'ISSUER'])?.key).toBe('american-express');
    expect(resolveBrand({ network: 'DISCOVER' }, ['NETWORK', 'ISSUER'])?.key).toBe('discover');
  });
});

describe('brand resolution', () => {
  it('matches by code, name, alias and slug, ignoring case, spacing and punctuation', () => {
    expect(resolveBrand({ code: 'MAR_BONVOY' })?.key).toBe('marriott');
    expect(resolveBrand('Marriott Bonvoy')?.key).toBe('marriott');
    expect(resolveBrand('  u.s.   bank ')?.key).toBe('us-bank');
    expect(resolveBrand({ slug: 'uber-eats', name: 'Uber Eats' })?.key).toBe('uber');
    expect(resolveBrand('Walmart+')?.key).toBe('walmart');
    expect(resolveBrand({ code: 'NOPE', name: 'Delta SkyMiles' })?.key).toBe('delta');
    expect(resolveBrand({ issuer: 'Chase' })?.key).toBe('chase');
    expect(resolveBrand('AT&T')?.key).toBe('att');
  });
  it('does not guess: unrelated or partial names are not matched without a kind filter', () => {
    expect(resolveBrand('Delta Faucet')).toBeNull();
    expect(resolveBrand('Joes Corner Diner')).toBeNull();
    expect(resolveBrand('')).toBeNull();
    expect(resolveBrand(null)).toBeNull();
    expect(resolveBrand(undefined)).toBeNull();
    expect(resolveBrand({})).toBeNull();
    expect(resolveBrand('Marriott Bonvoy Boundless')).toBeNull();
  });
  it('a kind filter allows a longer name to contain a brand, and restricts what can match', () => {
    expect(resolveBrand('Marriott Bonvoy Boundless', ['HOTEL'])?.key).toBe('marriott');
    expect(resolveBrand('Marriott Bonvoy Boundless', ['AIRLINE'])).toBeNull();
    expect(resolveBrand('Chase', ['HOTEL'])).toBeNull();
    expect(resolveBrand('Chase', ['ISSUER'])?.key).toBe('chase');
    expect(resolveBrand('abc', ['HOTEL'])).toBeNull(); // too short to search inside
  });
  it('normalizes', () => {
    expect(normalize('Macy\'s')).toBe('macys');
    expect(normalize('Walmart+')).toBe('walmart+');
    expect(normalize('A & B')).toBe('aandb');
  });
});

describe('monograms', () => {
  it('initials: two words, one word, filler words, short acronyms, empty', () => {
    expect(initials('Wyndham Rewards')).toBe('WR');
    expect(initials('Citi')).toBe('C');
    expect(initials('The Home Depot')).toBe('HD');
    expect(initials('Bank of America')).toBe('A');
    expect(initials('IHG One Rewards')).toBe('IO');
    expect(initials('TSA')).toBe('TS');
    expect(initials('')).toBe('?');
    expect(initials('& &')).toBe('?');
  });
  it('colours are stable and dark enough for white text', () => {
    expect(monogramColor('Hyatt')).toBe(monogramColor('hyatt!'));
    for (const n of ['Hyatt', 'IHG', 'Capital One', 'Citi', 'CLEAR', 'x']) {
      const hex = monogramColor(n);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      expect(1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
