import { existsSync } from "fs";
import { join } from "path";
import { PROGRAM_RULES } from "../../../src/domain/loyalty-email";

/* eslint-disable @typescript-eslint/no-require-imports */
// The extension lives outside backend/, so it is absent from the backend Docker build context: this suite runs in a
// full checkout and skips (rather than fails) inside that container.
const dir = join(__dirname, "../../../../extension/src");
const present = existsSync(join(dir, "capture.ts"));
interface ProgramInfo {
  code: string;
  name: string;
  domains: string[];
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const cap: any = present ? require(join(dir, "capture")) : {};
const PROGRAMS: ProgramInfo[] = present ? require(join(dir, "programs.generated")).PROGRAMS : [];
const { buildPayload, checkCapture, hostMatches, MAX_TEXT, normalizeServer, pageTextScript, programForHost, sha256Hex, tokenLooksValid, trimText } = cap;
const maybe = present ? describe : describe.skip;

const programs: ProgramInfo[] = [
  { code: "MAR_BONVOY", name: "Marriott Bonvoy", domains: ["marriott.com", "e.marriott.com"] },
  { code: "HH_HONORS", name: "Hilton Honors", domains: ["hilton.com"] },
];

maybe("TC-EXTN: extension capture helpers", () => {
  it("the extension's program list is generated from the backend table (no drift)", () => {
    expect(PROGRAMS).toEqual(PROGRAM_RULES.map((r) => ({ code: r.programCode, name: r.name, domains: r.domains })));
  });
  it("a page counts only on the program's own domain or its subdomains", () => {
    expect(hostMatches("www.marriott.com", ["marriott.com"])).toBe(true);
    expect(hostMatches("account.marriott.com", ["marriott.com"])).toBe(true);
    expect(hostMatches("marriott.com.evil.example", ["marriott.com"])).toBe(false);
    expect(hostMatches("notmarriott.com", ["marriott.com"])).toBe(false);
    expect(programForHost("www.hilton.com", programs)?.code).toBe("HH_HONORS");
    expect(programForHost("e.marriott.com", programs)?.code).toBe("MAR_BONVOY");
    expect(programForHost("example.org", programs)).toBeNull();
  });
  it("refuses insecure, unrelated or malformed pages, and an unchosen program", () => {
    expect(checkCapture("https://www.marriott.com/loyalty/myAccount", "MAR_BONVOY", programs)).toMatchObject({ ok: true, program: { code: "MAR_BONVOY" } });
    expect(checkCapture("http://www.marriott.com/", "MAR_BONVOY", programs)).toEqual({ ok: false, reason: "Only secure (https) pages can be captured." });
    expect(checkCapture("https://www.hilton.com/", "MAR_BONVOY", programs)).toMatchObject({ ok: false });
    expect((checkCapture("https://www.hilton.com/", "MAR_BONVOY", programs) as { reason: string }).reason).toMatch(/not a Marriott Bonvoy page \(www\.hilton\.com\)/);
    expect(checkCapture("https://www.marriott.com/", "", programs)).toEqual({ ok: false, reason: "Choose a program first." });
    expect(checkCapture("not a url", "MAR_BONVOY", programs)).toEqual({ ok: false, reason: "This page cannot be captured." });
  });
  it("server addresses: https anywhere, http only for localhost, no path", () => {
    expect(normalizeServer("https://pointwise.example.com/some/path?x=1")).toBe("https://pointwise.example.com");
    expect(normalizeServer(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(normalizeServer("http://127.0.0.1:4000")).toBe("http://127.0.0.1:4000");
    expect(normalizeServer("http://pointwise.example.com")).toBeNull();
    expect(normalizeServer("ftp://pointwise.example.com")).toBeNull();
    expect(normalizeServer("nonsense")).toBeNull();
  });
  it("token shape", () => {
    expect(tokenLooksValid("pw_pat_" + "a".repeat(43))).toBe(true);
    expect(tokenLooksValid("  pw_pat_" + "A1_-".repeat(10) + " ")).toBe(true);
    expect(tokenLooksValid("pw_pat_short")).toBe(false);
    expect(tokenLooksValid("sk-" + "a".repeat(40))).toBe(false);
    expect(tokenLooksValid("")).toBe(false);
  });
  it("text is cleaned and capped; the payload carries a stable hash and the capture time", async () => {
    expect(trimText("  a  b \t c  \n\n  d  ")).toBe("a b c\nd");
    expect(trimText("x".repeat(MAX_TEXT + 500))).toHaveLength(MAX_TEXT);
    const when = new Date("2026-11-25T12:00:00Z");
    const p = await buildPayload(programs[0], "Your current points balance is 85,400.", when);
    expect(p).toMatchObject({ program: "MAR_BONVOY", text: "Your current points balance is 85,400.", capturedAt: "2026-11-25T12:00:00.000Z" });
    expect((p as { pageHash: string }).pageHash).toHaveLength(32);
    expect(await buildPayload(programs[0], "Your current points balance is 85,400.", when)).toEqual(p);
    expect(await buildPayload(programs[0], "short", when)).toEqual({ error: "The page has no readable text yet. Wait for it to finish loading and try again." });
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("the page-side script drops scripts, form fields and passwords before reading text", () => {
    const removed: string[] = [];
    const clone = { innerText: "Balance 85,400", textContent: "x", querySelectorAll: (sel: string) => ({ forEach: (f: (n: { remove(): void }) => void) => f({ remove: () => removed.push(sel) }) }) };
    (globalThis as unknown as { document: unknown }).document = { body: { cloneNode: () => clone } };
    expect(pageTextScript()).toBe("Balance 85,400");
    expect(removed[0]).toMatch(/script.*input.*textarea.*\[type=password\]/);
    clone.innerText = "";
    expect(pageTextScript()).toBe("x");
    delete (globalThis as unknown as { document?: unknown }).document;
  });
});
