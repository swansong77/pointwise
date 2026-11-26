import { describe, expect, it } from 'vitest';
import { sanitizeSvg } from '../scripts/svg-safe.mjs';

const wrap = (inner: string, attrs = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;
const refused = (svg: string) => {
  try {
    sanitizeSvg(svg);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

describe('strict SVG cleaner', () => {
  it('keeps shapes, colours and gradients and drops editor metadata, comments and the XML header', () => {
    const { svg } = sanitizeSvg(`<?xml version="1.0"?><!-- made by a tool --><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://x" viewBox="0 0 10 10" inkscape:version="1"><metadata><rdf:RDF/></metadata><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h10v10z" fill="url(#g)"/><sodipodi:namedview a="b"/></svg>`);
    expect(svg).toContain('<path d="M0 0h10v10z" fill="url(#g)"/>');
    expect(svg).toContain('<linearGradient id="g">');
    expect(svg).not.toMatch(/inkscape|sodipodi|metadata|rdf|<!--|<\?xml/);
  });

  it('turns inline styles and simple class rules into attributes', () => {
    expect(sanitizeSvg(wrap('<path d="M0 0h1" style="fill:#ff0000;stroke:none;font-family:Arial"/>')).svg).toContain('fill="#ff0000"');
    const r = sanitizeSvg(wrap('<style>.a{fill:#00f}.b{stroke:#000;stroke-width:2}</style><path class="a b" d="M0 0h1"/>')).svg;
    expect(r).toMatch(/fill="#00f"/);
    expect(r).toMatch(/stroke-width="2"/);
    expect(r).not.toContain('<style');
    expect(r).not.toContain('class=');
  });

  it('adds a viewBox from the size when there is none', () => {
    expect(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="10"><rect width="2" height="2"/></svg>').svg).toContain('viewBox="0 0 20 10"');
    expect(refused('<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>')).toMatch(/viewBox or size/);
  });

  it('refuses anything that could run code or fetch something', () => {
    expect(refused(wrap('<script>alert(1)</script>'))).toMatch(/<script> is not allowed/);
    expect(refused(wrap('<path d="M0 0" onload="x()"/>'))).toMatch(/event handler/);
    expect(refused(wrap('<image href="http://evil/x.png"/>'))).toMatch(/<image> is not allowed/);
    expect(refused(wrap('<use href="#a"/>'))).toMatch(/<use> is not allowed/);
    expect(refused(wrap('<a href="http://evil"><path d="M0 0"/></a>'))).toMatch(/<a> is not allowed/);
    expect(refused(wrap('<foreignObject><div/></foreignObject>'))).toMatch(/foreignObject/);
    expect(refused(wrap('<text>Logo</text>'))).toMatch(/<text> is not allowed/);
    expect(refused(wrap('<mask id="m"><rect width="1" height="1"/></mask>'))).toMatch(/<mask> is not allowed/);
    expect(refused(wrap('<path d="M0 0" fill="url(http://evil/x)"/>'))).toMatch(/value that is not allowed/);
    expect(refused(wrap('<path d="M0 0" style="fill:url(http://evil/x)"/>'))).toMatch(/not allowed/);
    expect(refused(wrap('<path d="M0 0" fill="javascript:alert(1)"/>'))).toMatch(/not allowed/);
    expect(refused(wrap('<linearGradient id="g" xlink:href="http://evil/g"/><path d="M0 0"/>'))).toMatch(/external references/);
    expect(refused(wrap('<path d="M0 0" foo="2"/>'))).toMatch(/attribute "foo"/);
  });

  it('refuses unusual styles, entities, damaged and empty files, and large files', () => {
    expect(refused(wrap('<style>path{fill:red}</style><path d="M0 0"/>'))).toMatch(/selector/);
    expect(refused(wrap('<style>@import url(http://evil/x.css);</style><path d="M0 0"/>'))).toBeTruthy();
    expect(refused(wrap('<style>.a{behavior:url(x)}</style><path class="a" d="M0 0"/>'))).toMatch(/not allowed/);
    expect(refused('<!DOCTYPE svg [<!ENTITY x "http://evil/">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"/></svg>')).toMatch(/entity/);
    expect(refused('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0"></svg>')).toMatch(/not well formed/);
    expect(refused('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>')).toMatch(/draws nothing/);
    expect(refused('not an svg')).toBeTruthy();
    expect(refused(wrap(`<path d="${'M0 0 '.repeat(50_000)}"/>`))).toMatch(/larger than 200 KB/);
  });

  it('accepts the namespace entities Illustrator writes, but nothing else', () => {
    const adobe = '<!DOCTYPE svg [<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">]><svg xmlns="http://www.w3.org/2000/svg" xmlns:x="&ns_extend;" viewBox="0 0 1 1"><path d="M0 0h1"/></svg>';
    expect(refused(adobe)).toBeNull();
  });
});
