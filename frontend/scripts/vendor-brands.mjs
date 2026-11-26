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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg } from './svg-safe.mjs';

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
// Logos from outside the Simple Icons set: public-domain files from Wikimedia Commons (and, where a company's own page allows it,
// press-kit files), kept in brands/assets/ with their licence recorded in brands/sources.json. Every file is cleaned by the strict
// SVG cleaner (shapes, gradients and colours only; a file that cannot be made safe is refused) and keeps its own colours.
const sources = JSON.parse(readFileSync(join(root, 'brands/sources.json'), 'utf8'));
const byKey = new Map(brands.map((b) => [b.key, b]));
const refused = [];
let fromAssets = 0;
for (const a of sources.assets) {
  const b = byKey.get(a.key);
  if (!b) throw new Error(`sources.json names ${a.key}, which is not in brands.json`);
  if (manifest[a.key]) continue; // the Simple Icons mark wins
  const path = join(root, 'brands', a.asset);
  if (!existsSync(path)) {
    refused.push(`${a.key}: file ${a.asset} is missing`);
    continue;
  }
  try {
    // plain PNG/JPEG logos (some credit unions publish no vector mark) are shown through <img>, which never runs code;
    // they are accepted only when the magic bytes match the extension and the file is small
    const raster = /\.(png|jpe?g)$/i.exec(a.asset);
    let file = `${a.key}.svg`;
    if (raster) {
      const bytes = readFileSync(path);
      const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!(png || jpg) || bytes.length > 100_000) throw new Error('not a small PNG or JPEG image');
      file = `${a.key}.${png ? 'png' : 'jpg'}`;
      writeFileSync(join(out, file), bytes);
    } else {
      const { svg } = sanitizeSvg(readFileSync(path, 'utf8'));
      writeFileSync(join(out, file), svg + '\n');
    }
    manifest[a.key] = { file, hex: null, title: b.name, source: a.source, license: a.licence, url: a.page, retrieved: a.retrieved, ...(a.author ? { credit: { author: a.author, licence: 'CC BY-SA 4.0', licenceUrl: a.licenceUrl } } : {}) };
    fromAssets++;
  } catch (e) {
    refused.push(`${a.key}: ${e.message}`);
  }
}
if (refused.length) console.log(`not used (could not be cleaned): ${refused.join('; ')}`);
console.log(`vendored ${fromAssets} logos from brands/assets`);
writeFileSync(join(root, 'src/lib/brands.generated.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(manifest).length} brands have a logo (simple-icons ${version} plus brands/assets); ${brands.length - Object.keys(manifest).length} use a monogram`);
if (missing.length) console.log(`not in this simple-icons version: ${missing.join(', ')}`);
