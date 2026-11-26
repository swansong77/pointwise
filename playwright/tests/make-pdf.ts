/**
 * Minimal PDF writer for tests: one Helvetica text line per entry, top to bottom, several pages.
 * Lets tests build synthetic card statements (never real ones) without a PDF library.
 */
export function makePdf(pages: string[][]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) ;
  add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  add(''); // 2 pages — filled below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3
  const kids: number[] = [];
  for (const lines of pages) {
    const content = ['BT', '/F1 10 Tf', ...lines.map((l, i) => `1 0 0 1 40 ${760 - i * 14} Tm (${esc(l)}) Tj`), 'ET'].join('\n');
    add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const contentId = objects.length;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    kids.push(objects.length);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
