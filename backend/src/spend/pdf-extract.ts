import { spawn } from "child_process";
import { join } from "path";
import { StatementError } from "../domain/spend";

const SCRIPT = join(__dirname, "pdf-text.mjs");
const MAX_OUTPUT = 8 * 1024 * 1024;

const MESSAGES: Record<string, string> = {
  password:
    "This PDF is password-protected. Download it again without a password (or print it to PDF) and upload that file.",
  invalid: "This file is not a readable PDF.",
  too_many_pages: "This PDF has too many pages for a card statement (40 max).",
  failed: "The PDF could not be read.",
};

/**
 * Text lines of a PDF, extracted in a separate Node process with a memory cap and a timeout, so a
 * malicious or huge PDF cannot affect the API. The process gets no secrets (empty environment).
 */
export function extractPdfLines(
  pdf: Buffer,
  opts: { timeoutMs?: number; maxPages?: number } = {},
): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", SCRIPT],
      {
        env: { PDF_MAX_PAGES: String(opts.maxPages ?? 40) },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let out = "";
    let size = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new StatementError("Reading the PDF took too long."));
    }, opts.timeoutMs ?? 20_000);
    child.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size > MAX_OUTPUT) {
        child.kill("SIGKILL");
        return;
      }
      out += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      let r: { pages?: string[][]; error?: string };
      try {
        r = JSON.parse(out);
      } catch {
        return reject(new StatementError(MESSAGES.failed));
      }
      if (r.error)
        return reject(new StatementError(MESSAGES[r.error] ?? MESSAGES.failed));
      resolve(r.pages ?? []);
    });
    child.stdin.on("error", () => undefined); // the child may exit before reading everything
    child.stdin.end(pdf);
  });
}
