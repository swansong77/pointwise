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
  it('every icon file exists and is a plain, safe SVG (shapes, gradients and colours only: no scripts, links, images, styles or text) and nothing is left over', async () => {
    const { ALLOWED_ELEMENTS } = await import('../scripts/svg-safe.mjs');
    const manifest = JSON.parse(readFileSync(join(__dirname, '../src/lib/brands.generated.json'), 'utf8')) as Record<string, { source: string; hex: string | null; license: string }>;
    const withFile = BRANDS.filter((b) => b.file);
    expect(withFile.length).toBeGreaterThanOrEqual(75);
    for (const b of withFile) {
      const path = join(PUBLIC, b.file!);
      expect(existsSync(path)).toBe(true);
      const m = manifest[b.key];
      if (/\.(png|jpg)$/.test(b.file!)) {
        // a plain raster logo from Commons: real image bytes, small, with a recorded licence
        const bytes = readFileSync(path);
        expect(bytes.length).toBeLessThanOrEqual(100_000);
        expect(b.file!.endsWith('.png') ? bytes[0] === 0x89 && bytes[1] === 0x50 : bytes[0] === 0xff && bytes[1] === 0xd8).toBe(true);
        expect(m.license.length).toBeGreaterThan(10);
        expect(logoUrl(b)).toBe(`/brands/${b.file}`);
        continue;
      }
      const svg = readFileSync(path, 'utf8');
      expect(svg.startsWith('<svg')).toBe(true);
      if (m.source === 'simple-icons') {
        expect(b.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(svg).toContain(`fill="${b.hex}"`);
        expect([...svg.matchAll(/<([a-zA-Z]+)/g)].map((x) => x[1]).every((t) => ['svg', 'title', 'path'].includes(t))).toBe(true);
      } else {
        // logos from Wikimedia Commons or a company's own page keep their colours; the element set is the cleaner's allow-list
        expect(m.license.length).toBeGreaterThan(10);
        expect([...svg.matchAll(/<([a-zA-Z]+)/g)].map((x) => x[1].toLowerCase()).every((t) => ALLOWED_ELEMENTS.has(t))).toBe(true);
      }
      expect(svg).not.toMatch(/script|javascript:|data:|\son\w+=|xlink:href="(?!#)|href="(?!#)|<style|foreignObject|<image|<text|<use/i);
      expect(logoUrl(b)).toBe(`/brands/${b.file}`);
    }
    const onDisk = readdirSync(PUBLIC).filter((f) => /\.(svg|png|jpg)$/.test(f));
    expect(onDisk.sort()).toEqual(withFile.map((b) => b.file!).sort());
    expect(existsSync(join(PUBLIC, 'LICENSE-simple-icons.md'))).toBe(true);
    expect(existsSync(join(PUBLIC, 'NOTICE-commons-logos.md'))).toBe(true);
    expect(logoUrl(BRANDS.find((b) => !b.file)!)).toBeNull();
  });
  it('every logo that does not come from Simple Icons is recorded with its source page and licence', () => {
    const sources = JSON.parse(readFileSync(join(__dirname, '../brands/sources.json'), 'utf8')) as { assets: Array<{ key: string; page: string; licence: string; retrieved: string }>; skipped: Array<[string, string]> };
    const manifest = JSON.parse(readFileSync(join(__dirname, '../src/lib/brands.generated.json'), 'utf8')) as Record<string, { source: string; url?: string }>;
    for (const [key, m] of Object.entries(manifest)) {
      if (m.source === 'simple-icons') continue;
      const rec = sources.assets.find((a) => a.key === key);
      expect(rec, key).toBeTruthy();
      expect(rec!.page).toMatch(/^https:\/\/(commons\.wikimedia\.org|[a-z.]*)\//);
      expect(rec!.licence).toMatch(/PD-|CC0|public domain|CC BY-SA 4\.0 \(attribution required/i);
      if (/CC BY-SA/.test(rec!.licence)) expect((rec as unknown as { author?: string }).author, key).toBeTruthy();
      expect(rec!.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.url).toBe(rec!.page);
    }
    // a brand that was looked at and refused has a reason on record
    for (const [key, why] of sources.skipped) {
      expect(why.length).toBeGreaterThan(10);
      expect(manifest[key]?.source === 'wikimedia-commons').toBe(false);
    }
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
