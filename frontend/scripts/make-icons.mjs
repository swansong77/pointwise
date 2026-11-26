#!/usr/bin/env node
/**
 * Renders the PNG icons from the mark (public/logo/pointwise-mark.svg): the app icon, the install icons, a maskable
 * install icon (the mark inside the safe zone on a full-bleed background) and the browser-extension icons.
 *   node scripts/make-icons.mjs
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mark = readFileSync(join(root, 'public/logo/pointwise-mark.svg'));
const outIcons = join(root, 'public/icons');
const outExt = resolve(root, '../extension/icons');
mkdirSync(outIcons, { recursive: true });
mkdirSync(outExt, { recursive: true });

const png = (size, file) => sharp(mark, { density: 384 }).resize(size, size).png().toFile(file);
await png(180, join(root, 'src/app/apple-icon.png'));
await png(192, join(outIcons, 'icon-192.png'));
await png(512, join(outIcons, 'icon-512.png'));
// maskable: full-bleed gradient with the mark inside the central 80% (platforms crop the corners)
const inner = await sharp(mark, { density: 384 }).resize(Math.round(512 * 0.7), Math.round(512 * 0.7)).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#4338ca' } }).composite([{ input: inner, gravity: 'centre' }]).png().toFile(join(outIcons, 'icon-maskable-512.png'));
for (const s of [16, 32, 48, 128]) await png(s, join(outExt, `icon-${s}.png`));
console.log('icons written');
