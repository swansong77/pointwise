import { isTrusted, MerchantIdentity, MIN_RESOLVE_CONFIDENCE, resolveMerchant } from "../../../src/domain/merchant-resolve";
import { MERCHANT_IDENTITIES } from "../../../src/seed/merchant-identities";

const merchants: MerchantIdentity[] = MERCHANT_IDENTITIES.map((i, n) => ({ id: `m${n}`, slug: i.slug, name: i.name, hosts: i.hosts, aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent }));
const slug = (d: string, mcc?: string) => resolveMerchant(d, merchants, { mcc })?.slug ?? null;

describe("TC-MER: canonical merchant resolution", () => {
  it.each(["AMZN", "AMAZON", "AMAZON MKTPLACE", "AMZN MKTP US*2K4", "AMZN DIGITAL", "AMZN PRIME", "AMAZON.COM*AB12C WA", "Amazon Prime Video"])("%s → Amazon", (d) => {
    expect(slug(d)).toBe("amazon");
  });
  it("every Amazon descriptor carries the parent company", () => {
    expect(resolveMerchant("AMZN DIGITAL", merchants)).toMatchObject({ name: "Amazon", parentCompany: "Amazon.com, Inc." });
    expect(resolveMerchant("WHOLEFDS MKT", merchants)).toMatchObject({ slug: "whole-foods-market", parentCompany: "Amazon.com, Inc." });
  });
  it.each([
    ["UBER", "uber"],
    ["UBER TRIP", "uber"],
    ["UBER*TRIP HELP.UBER.COM", "uber"],
    ["UBR TECHNOLOGIES", "uber"],
    ["UBER ONE", "uber"],
    ["UBER EATS", "uber-eats"],
    ["UBER*EATS", "uber-eats"],
    ["UBEREATS HELP.UBER.COM", "uber-eats"],
  ])("%s → %s (Uber Eats stays separate from Uber)", (d, s) => {
    expect(slug(d)).toBe(s);
  });
  it.each([
    ["HAMPTON INN & SUITES ORLANDO", "hilton"],
    ["DOUBLETREE BY HILTON", "hilton"],
    ["SHERATON HOTEL CHICAGO", "marriott"],
    ["RITZ-CARLTON", "marriott"],
    ["GRAND HYATT SEATTLE", "hyatt"],
    ["HOLIDAY INN EXPRESS", "ihg"],
    ["DELTA AIR 0062345", "delta-air-lines"],
    ["UNITED 0162345 AIRLINES", "united-airlines"],
    ["COSTCO WHSE #0123", "costco"],
    ["WALMART+ MEMBERSHIP", "walmart-plus"],
    ["WALMART SUPERCENTER", "walmart"],
    ["AT&T WIRELESS", "att"],
    ["SHAKE SHACK NEW YORK", "shake-shack"],
  ])("%s → %s", (d, s) => {
    expect(slug(d)).toBe(s);
  });
  it("the Amex credit line 'Walmart+ Member …' resolves to Walmart", () => {
    expect(slug("Walmart+ Member 10/26 02737 8005550100 AR")).toBe("walmart");
  });
  it("unknown merchants are not guessed", () => {
    for (const d of ["JOES DINER", "SQ *BEAN STREET COFFEE", "FIXTURE HARDWARE", "", "   "]) expect(slug(d)).toBeNull();
  });
  it("'UNITED STATES TENNIS A USTA.COM' is not United Airlines", () => {
    for (const d of ["UNITED STATES TENNIS A USTA.COM NY", "UNITED STATES TENNIS A WHITE PLAINS NY", "AplPay UNITED STATES TENNIS A WHITE PLAINS NY", "UNITED STATES POSTAL SERVICE"]) expect(slug(d)).toBeNull();
    // United itself still resolves, by name, alias or its whole host
    for (const d of ["UNITED 0162345 AIRLINES", "UNITED AIR 0162345", "UNITED.COM TX", "UNITED … UNITED.COM TX"]) expect(slug(d)).toBe("united-airlines");
  });
  it("a bare host word resolves only at low confidence, never trusted", () => {
    const r = resolveMerchant("DELTA FAUCET", merchants)!;
    expect(r).toMatchObject({ slug: "delta-air-lines", via: "HOST", confidence: 0.7 });
    expect(isTrusted(r)).toBe(false);
  });
  it("an MCC agreeing with the merchant raises confidence; a conflicting MCC lowers it", () => {
    const base = resolveMerchant("HILTON", merchants)!;
    const agree = resolveMerchant("HILTON", merchants, { mcc: "7011" })!;
    const clash = resolveMerchant("HILTON", merchants, { mcc: "5812" })!;
    expect(agree.confidence).toBeGreaterThan(base.confidence);
    expect(clash.confidence).toBeLessThan(base.confidence);
    expect(isTrusted(base)).toBe(true);
    expect(isTrusted(clash)).toBe(true); // an exact name still wins over a stray code (a hotel restaurant is still Hilton)
    // but a weaker (host-only) match is pushed below the trusted line by a conflicting code
    expect(isTrusted(resolveMerchant("HILTON PLAZA", merchants, { mcc: "5812" }))).toBe(false); // name-in-text match + conflicting code
    expect(isTrusted(resolveMerchant("DELTA FAUCET", merchants, { mcc: "5200" }))).toBe(false);
    expect(isTrusted(null)).toBe(false);
  });
  it("a one-letter slip falls back to a low-confidence fuzzy match", () => {
    const r = resolveMerchant("WALGRENS 1234", merchants)!;
    expect(r).toMatchObject({ slug: "walgreens", via: "FUZZY", confidence: 0.6 });
    expect(isTrusted(r)).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(MIN_RESOLVE_CONFIDENCE);
  });
  it("reports how the match was made", () => {
    expect(resolveMerchant("Amazon", merchants)).toMatchObject({ via: "EXACT_NAME", confidence: 0.98 });
    expect(resolveMerchant("AMZN", merchants)).toMatchObject({ via: "ALIAS" });
    expect(resolveMerchant("WWW.BESTBUY.COM ORDER", merchants)?.slug).toBe("best-buy");
  });
  it("seed identities are well formed: unique slugs, aliases and MCC for every merchant", () => {
    const slugs = MERCHANT_IDENTITIES.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(MERCHANT_IDENTITIES.length).toBeGreaterThanOrEqual(55);
    for (const i of MERCHANT_IDENTITIES) {
      expect(i.mcc.length).toBeGreaterThan(0);
      expect(i.mcc.every((c) => /^\d{4}$/.test(c))).toBe(true);
      expect(i.industry.length).toBeGreaterThan(2);
    }
  });
  it("matchMerchant (statement import) also uses aliases", () => {
    const { matchMerchant } = jest.requireActual("../../../src/domain/spend") as typeof import("../../../src/domain/spend");
    expect(matchMerchant("UBR TECHNOLOGIES 8005550101", merchants)?.slug).toBe("uber");
  });
});
