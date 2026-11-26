#!/usr/bin/env node
/**
 * Vendors brand icons into frontend/public/brands from the Simple Icons package (CC0-1.0), so the app serves them
 * itself and never contacts a third party at runtime. Nothing is scraped from any company's site.
 *
 *   cd /tmp && npm pack simple-icons && tar xzf simple-icons-*.tgz
 *   node scripts/vendor-brands.mjs /tmp/package
 *
 * Reads brands/brands.json; for each brand with a "simple" slug writes public/brands/<key>.svg (filled with the
 * brand colour) and records it in src/lib/brands.generated.json. Brands without an icon get a generated monogram
 * in the UI. Logos remain the trademarks of their owners and are shown only to identify them (see docs/brand-assets.md).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const pkgDir = resolve(process.argv[2] ?? join(root, 'node_modules/simple-icons'));
// Only static data is read (SVG files and a JSON list); no code from the downloaded package is ever executed.
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const slugOf = (e) => e.slug ?? e.title.toLowerCase().replace(/[^a-z0-9]/g, '');
const bySlug = new Map(JSON.parse(readFileSync(join(pkgDir, 'data/simple-icons.json'), 'utf8')).map((e) => [slugOf(e), e]));

const brands = JSON.parse(readFileSync(join(root, 'brands/brands.json'), 'utf8'));
const out = join(root, 'public/brands');
mkdirSync(out, { recursive: true });
const manifest = {};
const missing = [];
for (const b of brands) {
  if (!b.simple) continue;
  const icon = bySlug.get(b.simple);
  let raw;
  try {
    raw = readFileSync(join(pkgDir, 'icons', `${b.simple}.svg`), 'utf8');
  } catch {
    raw = null;
  }
  if (!icon || !raw) {
    missing.push(b.simple);
    continue;
  }
  // the icon has no fill, so it would render black; give it the brand colour
  const svg = raw.trim().replace('<svg ', `<svg fill="#${icon.hex}" `);
  writeFileSync(join(out, `${b.key}.svg`), svg + '\n');
  manifest[b.key] = { file: `${b.key}.svg`, hex: `#${icon.hex}`, title: icon.title, source: 'simple-icons', license: 'CC0-1.0', version };
}
writeFileSync(join(root, 'src/lib/brands.generated.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`vendored ${Object.keys(manifest).length} icons (simple-icons ${version}); ${brands.length - Object.keys(manifest).length} brands use a monogram`);
if (missing.length) console.log(`not in this simple-icons version: ${missing.join(', ')}`);
