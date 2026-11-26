/**
 * A strict SVG cleaner for logos that come from outside (icon sets, company press kits, Wikimedia Commons).
 *
 * The result contains only drawing elements and a short list of presentation attributes. Anything that could run code or
 * fetch something (script, style, image, use, a, foreignObject, text, filters, event handlers, external links, data: and
 * javascript: values) is either removed (non-rendering editor metadata) or makes the file fail, and a failed file is not
 * used. Simple class-based <style> rules (the kind Illustrator writes) are turned into attributes first.
 * Pure string code; no XML parser is executed and nothing from the file is ever run.
 */
export const ALLOWED_ELEMENTS = new Set(['svg', 'title', 'desc', 'path', 'g', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath']);
const CANON = { lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath' };

export const ALLOWED_ATTRS = new Set([
  'd', 'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'opacity',
  'transform', 'viewbox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'spreadmethod', 'fx', 'fy', 'id', 'clip-path', 'xmlns', 'preserveaspectratio', 'role', 'aria-label', 'aria-hidden', 'version', 'clippathunits',
]);
const CANON_ATTR = { viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod', preserveaspectratio: 'preserveAspectRatio', clippathunits: 'clipPathUnits' };
const STYLE_PROPS = new Set(['fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'stop-color', 'stop-opacity']);
export const MAX_BYTES = 200 * 1024;

const IGNORED_PROP = /^(display|visibility|mix-blend-mode|isolation|enable-background|paint-order|vector-effect|font[\w-]*|text[\w-]*|letter-spacing|word-spacing|line-height|white-space|writing-mode|-inkscape[\w-]*|marker[\w-]*|shape-rendering|image-rendering|color[\w-]*|solid-[\w-]+)$/;
const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** A value that may appear in an attribute: no scripts, no external addresses. Internal references (url(#id)) are fine. */
function safeValue(v) {
  const t = decodeEntities(v).trim();
  if (/javascript:|data:|<|>|expression\(|@import/i.test(t)) return false;
  for (const m of t.matchAll(/url\(([^)]*)\)/gi)) if (!/^\s*['"]?#[\w.-]+['"]?\s*$/.test(m[1])) return false;
  return true;
}

function parseStyleBlock(css) {
  const rules = new Map();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!clean) return rules;
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim());
    const decls = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      const p = d.slice(0, i).trim().toLowerCase();
      const val = d.slice(i + 1).trim();
      if (!STYLE_PROPS.has(p)) {
        if (IGNORED_PROP.test(p)) continue;
        throw new Error(`style property "${p}" is not allowed`);
      }
      if (!safeValue(val)) throw new Error(`style value for "${p}" is not allowed`);
      decls[p] = val;
    }
    for (const s of sels) {
      if (!/^\.[A-Za-z_][\w-]*$/.test(s)) throw new Error(`style selector "${s}" is not allowed (only simple classes)`);
      rules.set(s.slice(1), { ...(rules.get(s.slice(1)) ?? {}), ...decls });
    }
  }
  if (!rules.size && /\S/.test(clean.replace(/\{[^}]*\}/g, ''))) throw new Error('the style block could not be understood');
  return rules;
}

/**
 * @returns {{ svg: string }} the cleaned SVG. Throws Error with the reason when the file cannot be made safe.
 */
export function sanitizeSvg(input) {
  if (Buffer.byteLength(input) > MAX_BYTES) throw new Error('file is larger than 200 KB');
  let s = input.replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, '');
  // Illustrator writes namespace entities in the DOCTYPE; accept only those (their values are never used by a rendered attribute)
  for (const e of input.matchAll(/<!ENTITY\s+\S+\s+["']([^"']*)["']/gi)) if (!/^https?:\/\/ns\.adobe\.com\//.test(e[1])) throw new Error('entity definitions are not allowed');
  // editor and metadata blocks with namespaces or the metadata element: not rendered, removed whole
  s = s.replace(/<(metadata|(?:sodipodi|inkscape|rdf|dc|cc|sketch|serif|xpacket|i|ns\d*):[A-Za-z]+)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g, '');
  // class rules from a single <style> block
  let rules = new Map();
  const styles = [...s.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)];
  if (styles.length > 1) throw new Error('more than one style block');
  if (styles.length) {
    rules = parseStyleBlock(styles[0][1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
    s = s.replace(styles[0][0], '');
  }
  const out = [];
  const stack = [];
  let rest = s;
  let sawSvg = false;
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/;
  for (;;) {
    const m = tag.exec(rest);
    if (!m) break;
    const between = rest.slice(0, m.index);
    if (between.trim() && stack.length && ['title', 'desc'].includes(stack[stack.length - 1])) out.push(between.replace(/[<>&]/g, ''));
    else if (between.trim() && !stack.length) throw new Error('text outside the svg element');
    else if (between.trim() && !['title', 'desc'].includes(stack[stack.length - 1] ?? '')) throw new Error('text content (the logo uses a font) is not allowed');
    rest = rest.slice(m.index + m[0].length);
    const closing = m[1] === '/';
    const rawName = m[2];
    const name = rawName.toLowerCase();
    if (rawName.includes(':') && !closing && !ALLOWED_ELEMENTS.has(name)) throw new Error(`element <${rawName}> is not allowed`);
    if (!ALLOWED_ELEMENTS.has(name)) throw new Error(`element <${rawName}> is not allowed`);
    if (closing) {
      if (stack.pop() !== name) throw new Error('the svg is not well formed');
      out.push(`</${CANON[name] ?? name}>`);
      continue;
    }
    if (name === 'svg') sawSvg = true;
    else if (!sawSvg) throw new Error('content before the svg element');
    const attrs = {};
    for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const an = a[1];
      const lower = an.toLowerCase();
      const val = a[2] ?? a[3] ?? '';
      if (lower.startsWith('xmlns:') || lower === 'xmlns') continue;
      if (lower.includes(':') && !lower.startsWith('xlink:')) continue; // editor namespaces (inkscape:, sodipodi:, serif: ...) never render
      if (lower.startsWith('on')) throw new Error(`event handler "${an}" is not allowed`);
      if (lower === 'xml:space' || lower === 'enable-background' || lower === 'data-name' || lower === 'version' || lower === 'baseprofile' || lower === 'xml:space') continue;
      if (lower === 'href' || lower === 'xlink:href') {
        if (!/^#[\w.-]+$/.test(val.trim())) throw new Error('external references are not allowed');
        attrs.href = val.trim();
        continue;
      }
      if (lower === 'class') {
        for (const c of val.split(/\s+/).filter(Boolean)) {
          const r = rules.get(c);
          if (r) for (const [p, v] of Object.entries(r)) if (!(p in attrs)) attrs[p] = v;
        }
        continue;
      }
      if (lower === 'style') {
        for (const d of val.split(';')) {
          const i = d.indexOf(':');
          if (i < 0) continue;
          const p = d.slice(0, i).trim().toLowerCase();
          const v = d.slice(i + 1).trim();
          if (!STYLE_PROPS.has(p)) {
            if (IGNORED_PROP.test(p)) continue;
            throw new Error(`style property "${p}" is not allowed`);
          }
          if (!safeValue(v)) throw new Error(`style value for "${p}" is not allowed`);
          attrs[p] = v;
        }
        continue;
      }
      if (!ALLOWED_ATTRS.has(lower)) {
        if (['data-name', 'xml:space', 'focusable', 'overflow', 'shape-rendering', 'text-rendering', 'image-rendering', 'color-interpolation-filters', 'filterunits'].includes(lower)) continue;
        throw new Error(`attribute "${an}" on <${rawName}> is not allowed`);
      }
      if (!safeValue(val)) throw new Error(`attribute "${an}" has a value that is not allowed`);
      attrs[CANON_ATTR[lower] ?? lower] = decodeEntities(val);
    }
    const selfClose = m[4] === '/';
    const attrText = Object.entries(attrs)
      .map(([k, v]) => ` ${k === 'href' ? 'href' : k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
      .join('');
    if (name === 'svg' && !attrs.xmlns) out.push(`<svg xmlns="http://www.w3.org/2000/svg"${attrText}`);
    else out.push(`<${CANON[name] ?? name}${attrText}`);
    out.push(selfClose ? '/>' : '>');
    if (!selfClose) stack.push(name);
  }
  if (rest.trim()) throw new Error('unexpected content after the last element');
  if (stack.length) throw new Error('the svg is not well formed');
  if (/&(?!amp;|quot;|apos;|lt;|gt;|#\d+;)[A-Za-z_][\w.-]*;/.test(out.join(''))) throw new Error('an entity reference is not allowed');
  if (!sawSvg) throw new Error('no svg element');
  let svg = out.join('');
  // a usable viewBox
  const root = /<svg\b[^>]*>/.exec(svg)[0];
  if (!/viewBox=/.test(root)) {
    const w = /\swidth="([\d.]+)(?:px)?"/.exec(root);
    const h = /\sheight="([\d.]+)(?:px)?"/.exec(root);
    if (!w || !h) throw new Error('the svg has no viewBox or size');
    svg = svg.replace(root, root.replace('<svg', `<svg viewBox="0 0 ${w[1]} ${h[1]}"`));
  }
  if (!/<(path|rect|circle|ellipse|polygon|polyline|line)\b/.test(svg)) throw new Error('the svg draws nothing');
  return { svg };
}
