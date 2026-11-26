import { confidenceCap, offerKey, parseOfferDate, parseOfferLine, parseOfferText, reliabilityOf, SOURCE_RELIABILITY } from "../../../src/domain/offer-import";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("TC-OFFI: source reliability (ADR-009)", () => {
  it("official 100, account data 90, email 75, AI 50, user 25", () => {
    expect(reliabilityOf("ISSUER_OFFICIAL")).toBe(100);
    expect(reliabilityOf("ACCOUNT_DATA")).toBe(90);
    expect(reliabilityOf("EMAIL")).toBe(75);
    expect(reliabilityOf("AI_INFERRED")).toBe(50);
    expect(reliabilityOf("USER_ENTERED")).toBe(25);
    expect(Object.keys(SOURCE_RELIABILITY)).toHaveLength(8);
  });
  it("confidence is capped by source; verification lifts to account-data level; disputed is zero", () => {
    expect(confidenceCap("USER_ENTERED", "UNVERIFIED")).toBe(25);
    expect(confidenceCap("USER_ENTERED", "VERIFIED")).toBe(90);
    expect(confidenceCap("ISSUER_OFFICIAL", "VERIFIED")).toBe(100);
    expect(confidenceCap("EMAIL", "DISPUTED")).toBe(0);
  });
});

describe("TC-OFFI: dates", () => {
  it.each([["expires 12/31/2026", "2026-12-31"], ["ends 1/5/27", "2027-01-05"], ["through 2026-11-30", "2026-11-30"], ["Jan 15, 2027", "2027-01-15"], ["December 31 2026", "2026-12-31"]])("%s", (t, iso) => {
    expect(parseOfferDate(t)).toEqual(d(iso));
  });
  it("rejects impossible dates", () => {
    expect(parseOfferDate("expires 13/45/2026")).toBeNull();
    expect(parseOfferDate("2026-02-31")).toBeNull();
    expect(parseOfferDate("no date")).toBeNull();
  });
});

describe("TC-OFFI: parsing offers", () => {
  it("spend-and-get with expiry", () => {
    expect(parseOfferLine("Hilton: Spend $500, get $100 back, expires 12/31/2026")).toMatchObject({ merchantText: "Hilton", offerType: "SPEND_GET", minSpendCents: 50_000, valueCents: 10_000, endsAt: d("2026-12-31") });
  });
  it("percent back with a cap", () => {
    expect(parseOfferLine("Uber Eats - 10% back up to $20 - ends Jan 15, 2027")).toMatchObject({ merchantText: "Uber Eats", offerType: "CASHBACK_PERCENT", percent: 10, maxRewardCents: 2_000, endsAt: d("2027-01-15") });
  });
  it("points offers", () => {
    expect(parseOfferLine("Delta: earn 2,000 points on $300+ through 3/1/27")).toMatchObject({ merchantText: "Delta", offerType: "POINTS_BONUS", points: 2000, minSpendCents: 30_000, endsAt: d("2027-03-01") });
  });
  it("merchant after 'at', flat credit without a minimum", () => {
    expect(parseOfferLine("Get $10 back at Chipotle, expires 2026-12-31")).toMatchObject({ merchantText: "Chipotle", offerType: "STATEMENT_CREDIT", valueCents: 1_000, minSpendCents: null });
    expect(parseOfferLine("Spend $50 or more, get $10 back at Chipotle, expires 2026-12-31")).toMatchObject({ merchantText: "Chipotle", offerType: "SPEND_GET", minSpendCents: 5_000, valueCents: 1_000 });
  });
  it("coupons", () => {
    expect(parseOfferLine("Best Buy: coupon code SAVE20 - $20 off, ends 12/31/2026")?.offerType).toBe("COUPON");
  });
  it("an offer without an expiry is kept and flagged", () => {
    const p = parseOfferLine("Costco: $15 back")!;
    expect(p.issues).toEqual(["no expiry date"]);
    expect(p.endsAt).toBeNull();
  });
  it("blocks: skips comments and blanks, rejects lines that are not offers, reports why", () => {
    const r = parseOfferText(["# my offers", "", "Hilton: Spend $500, get $100 back, expires 12/31/2026", "just some words", "Marriott: nice offer"].join("\n"));
    expect(r.offers.map((o) => o.merchantText)).toEqual(["Hilton"]);
    expect(r.rejected.map((x) => x.line)).toEqual([4, 5]);
    expect(r.rejected[1].reason).toMatch(/reward not found/);
  });
  it("caps the number of lines read", () => {
    const many = Array.from({ length: 300 }, () => "Hilton: Spend $500, get $100 back, expires 12/31/2026").join("\n");
    expect(parseOfferText(many, 50).offers).toHaveLength(50);
  });
  it("the key identifies the same offer and tells different ones apart", () => {
    const base = { merchantKey: "hilton", offerType: "SPEND_GET", valueCents: 10_000, percent: null, points: null, minSpendCents: 50_000, endsAt: d("2026-12-31") };
    expect(offerKey(base)).toBe(offerKey({ ...base }));
    expect(offerKey(base)).not.toBe(offerKey({ ...base, valueCents: 5_000 }));
    expect(offerKey({ ...base, endsAt: null })).toContain("|");
  });
});
