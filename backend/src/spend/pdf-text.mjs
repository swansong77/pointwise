/**
 * PDF → text lines, run in a separate Node process (see pdf-extract.ts): the API never parses
 * untrusted PDFs in-process. Reads the PDF from stdin and writes one JSON object to stdout:
 *   { pages: [[line, …], …] }  or  { error: "password" | "invalid" | "too_many_pages" | "failed" }
 * Lines are rebuilt from positioned text items (same baseline → one line, ordered left to right).
 * No scripts, fonts or network: eval is disabled and the document comes from memory.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const MAX_PAGES = Number(process.env.PDF_MAX_PAGES || 40);
const out = (o) => process.stdout.write(JSON.stringify(o));

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const data = new Uint8Array(Buffer.concat(chunks));

try {
  const task = getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  if (doc.numPages > MAX_PAGES) {
    out({ error: "too_many_pages", pages: doc.numPages });
    process.exit(0);
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!row) rows.push((row = { y, items: [] }));
      row.items.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(
      rows.map((r) => {
        r.items.sort((a, b) => a.x - b.x);
        let line = "";
        let end = null;
        for (const it of r.items) {
          if (end !== null && it.x - end > 1) line += " ";
          line += it.s;
          end = it.x + it.w;
        }
        return line.replace(/\s+/g, " ").trim();
      }),
    );
    page.cleanup();
  }
  await task.destroy();
  out({ pages });
} catch (e) {
  const name = e && e.name;
  if (process.env.PDF_DEBUG) process.stderr.write(String(e && e.stack) + "\n");
  out({
    error:
      name === "PasswordException"
        ? "password"
        : name === "InvalidPDFException"
          ? "invalid"
          : "failed",
  });
}
