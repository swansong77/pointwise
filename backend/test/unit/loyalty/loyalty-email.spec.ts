import { loyaltySenderDomains, parseLoyaltyEmail, parseLoyaltyText, programByCode, programForDomain, PROGRAM_RULES } from "../../../src/domain/loyalty-email";

const day = (s: string) => new Date(`${s}T00:00:00Z`); // parsed dates are UTC midnight
const AT = new Date("2026-11-20T12:00:00Z");
const get = (r: ReturnType<typeof parseLoyaltyEmail>, field: string) => r.observations.find((o) => o.field === field);

describe("TC-MAIL: program registry", () => {
  it("covers the airlines, hotels, bank programs and portals asked for, all flagged unverified", () => {
    const codes = PROGRAM_RULES.map((r) => r.programCode);
    for (const c of ["AA_AADVANTAGE", "UA_MILEAGEPLUS", "DL_SKYMILES", "WN_RAPIDREWARDS", "AS_MILEAGEPLAN", "B6_TRUEBLUE", "AC_AEROPLAN", "BA_AVIOS", "VS_FLYINGCLUB", "AF_FLYINGBLUE", "SQ_KRISFLYER", "QR_PRIVILEGE", "EK_SKYWARDS", "MAR_BONVOY", "HH_HONORS", "WOH_HYATT", "IHG_ONE", "WYN_REWARDS", "CHOICE_PRIV", "ACCOR_ALL", "BW_REWARDS", "AMEX_MR", "CHASE_UR", "C1_MILES", "CITI_TYP", "BILT_POINTS", "WF_REWARDS", "BOA_POINTS", "USB_REWARDS", "RAKUTEN", "TOPCASHBACK"]) expect(codes).toContain(c);
    expect(PROGRAM_RULES.every((r) => r.verified === false)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
  });
  it("maps a sender domain or its subdomain to a program; unrelated domains to none", () => {
    expect(programForDomain("e.marriott.com")?.programCode).toBe("MAR_BONVOY");
    expect(programForDomain("mail.hilton.com")?.programCode).toBe("HH_HONORS");
    expect(programForDomain("WWW.United.com")?.programCode).toBe("UA_MILEAGEPLUS");
    expect(programForDomain("notmarriott.com")).toBeNull();
    expect(programForDomain("example.org")).toBeNull();
    expect(programByCode("DL_SKYMILES")?.name).toBe("Delta SkyMiles");
    expect(programByCode("NOPE")).toBeNull();
    expect(loyaltySenderDomains()).toEqual(expect.arrayContaining(["marriott.com", "aa.com", "rakuten.com"]));
    expect(new Set(loyaltySenderDomains()).size).toBe(loyaltySenderDomains().length);
  });
  it("without a program nothing is parsed", () => {
    expect(parseLoyaltyEmail("example.org", "Your balance is 5,000 points", "balance is 5,000 points", AT)).toMatchObject({ kind: "NONE", observations: [] });
    expect(parseLoyaltyText(null, "x", "y", AT).observations).toEqual([]);
  });
});

describe("TC-MAIL: balances and status (synthetic emails)", () => {
  const marriott = `Hello Member,\nYour current points balance is 85,400. Pending points: 1,200.\nYour Platinum Elite status is valid through February 28, 2027.\nMember number ending 4821.`;
  it("reads balance, pending, status with its deadline, and the account digits", () => {
    const r = parseLoyaltyEmail("e.marriott.com", "Your Bonvoy account summary", marriott, AT);
    expect(r.program?.programCode).toBe("MAR_BONVOY");
    expect(get(r, "balance")).toMatchObject({ value: 85_400, rule: "balance.label", entity: "ACCOUNT" });
    expect(get(r, "pendingBalance")?.value).toBe(1_200);
    expect(get(r, "statusLevel")?.value).toBe("Platinum Elite");
    expect(get(r, "statusDeadline")?.value).toEqual(day("2027-02-28"));
    expect(r.observations.find((o) => o.entity === "STATUS")?.value).toEqual({ level: "Platinum Elite", expiresAt: day("2027-02-28") });
    expect(r.memberDigits).toBe("4821");
    expect(r.rules).toEqual(expect.arrayContaining(["balance.label", "balance.pending", "status.intro"]));
    expect(r.parserVersion).toBe("loyalty-email/1");
    expect(r.observations.every((o) => o.observedAt === AT)).toBe(true);
  });
  it("other balance wordings", () => {
    expect(get(parseLoyaltyEmail("chase.com", "Rewards", "Your Ultimate Rewards balance is 120,500 points", AT), "balance")?.value).toBe(120_500);
    expect(get(parseLoyaltyEmail("delta.com", "SkyMiles", "You have 45,000 miles in your account.", AT), "balance")).toMatchObject({ value: 45_000, rule: "balance.have" });
    expect(get(parseLoyaltyEmail("aa.com", "x", "12,000 miles are now available", AT), "balance")).toMatchObject({ value: 12_000, rule: "balance.available" });
    expect(get(parseLoyaltyEmail("hilton.com", "x", "Lifetime points: 1,250,000", AT), "lifetimePoints")?.value).toBe(1_250_000);
  });
  it("status wordings: congratulations, welcome to; the longest tier wins; a tier without an intro is ignored", () => {
    const up = parseLoyaltyEmail("delta.com", "Congrats", "Congratulations, you have reached Gold Medallion status through the 2027 membership year.", AT);
    expect(get(up, "statusLevel")?.value).toBe("Gold Medallion");
    expect(get(parseLoyaltyEmail("aa.com", "x", "Congratulations! You have achieved Executive Platinum.", AT), "statusLevel")?.value).toBe("Executive Platinum");
    expect(get(parseLoyaltyEmail("hyatt.com", "x", "Welcome to Globalist.", AT), "statusLevel")?.value).toBe("Globalist");
    expect(get(parseLoyaltyEmail("aa.com", "Gold deals", "Save on Gold fares this week.", AT), "statusLevel")).toBeUndefined();
    expect(parseLoyaltyEmail("chase.com", "x", "Your status is Platinum", AT).observations.filter((o) => o.field === "statusLevel")).toEqual([]); // bank programs have no tiers
  });
});

describe("TC-MAIL: expiry, activity and certificates", () => {
  it("an expiry notice yields the date and the points at risk", () => {
    const r = parseLoyaltyEmail("aa.com", "Your miles are about to expire", "25,000 miles will expire on 01/15/2027 unless you have account activity.", AT);
    expect(r.kind).toBe("EXPIRY");
    expect(get(r, "expiresAt")?.value).toEqual(day("2027-01-15"));
    expect(get(r, "expiringPoints")?.value).toBe(25_000);
    const alt = parseLoyaltyEmail("hilton.com", "x", "Points expiring on March 1, 2027: 10,000 points.", AT);
    expect(get(alt, "expiresAt")?.value).toEqual(day("2027-03-01"));
    expect(get(alt, "expiringPoints")?.value).toBe(10_000);
    const dateOnly = parseLoyaltyEmail("ihg.com", "x", "Your points expire on 2027-05-01.", AT);
    expect(get(dateOnly, "expiresAt")).toMatchObject({ value: day("2027-05-01"), rule: "expiry.date" });
    expect(get(dateOnly, "expiringPoints")).toBeUndefined();
  });
  it("activity: earned, redeemed, expired, transferred", () => {
    const r = parseLoyaltyEmail("delta.com", "Activity", "You earned 5,000 miles on your flight. You redeemed 20,000 miles for a ticket. 1,000 miles expired. You transferred 10,000 points to your account.", AT);
    const kinds = r.observations.filter((o) => o.field === "activity").map((o) => (o.value as { kind: string; points: number }).kind + ":" + (o.value as { points: number }).points);
    expect(kinds).toEqual(["EARN:5000", "REDEEM:20000", "EXPIRE:1000", "TRANSFER_IN:10000"]);
    expect(r.kind).toBe("ACTIVITY");
    expect(parseLoyaltyEmail("delta.com", "x", "You earned 5,000 miles. Your current balance is 50,000.", AT).kind).toBe("SUMMARY");
  });
  it("a free night award yields a certificate with its expiry and point cap", () => {
    const r = parseLoyaltyEmail("hilton.com", "Your reward", "You've earned a Free Night Reward! Valid for stays up to 40,000 points per night. Expires on March 31, 2027.", AT);
    expect(r.kind).toBe("CERTIFICATE");
    const c = get(r, "certificate")!;
    expect(c.entity).toBe("CERTIFICATE");
    expect(c.value).toMatchObject({ category: "FREE_NIGHT", expiresAt: day("2027-03-31"), pointCap: 40_000, quantity: 1 });
    expect((c.value as { name: string }).name).toMatch(/^Hilton Free night/i);
    expect((c.value as { conditionsText: string }).conditionsText).toMatch(/up to 40,000 points/);
    expect(c.ruleConfidence).toBe(80);
  });
  it("companion and upgrade awards; marketing mentions are not certificates", () => {
    const comp = get(parseLoyaltyEmail("delta.com", "x", "You have 2 companion certificates available. Use by 12/31/2026.", AT), "certificate")!;
    expect(comp.value).toMatchObject({ category: "COMPANION", quantity: 2, expiresAt: day("2026-12-31") });
    const up = get(parseLoyaltyEmail("united.com", "x", "Your regional upgrade award was added to your account. Valid through 06/30/2027.", AT), "certificate")!;
    expect(up.value).toMatchObject({ category: "UPGRADE", expiresAt: day("2027-06-30") });
    expect(get(parseLoyaltyEmail("hilton.com", "Sale", "Book now and ask about a free night at select hotels.", AT), "certificate")).toBeUndefined();
    const noDate = get(parseLoyaltyEmail("hyatt.com", "x", "A free night award was credited to your account.", AT), "certificate")!;
    expect(noDate.ruleConfidence).toBe(60);
    expect((noDate.value as { expiresAt: Date | null }).expiresAt).toBeNull();
  });
  it("irrelevant mail from a program produces nothing, not a guess", () => {
    const r = parseLoyaltyEmail("marriott.com", "Spring sale", "Book your summer escape and save big.", AT);
    expect(r).toMatchObject({ kind: "NONE", observations: [], rules: [], memberDigits: null });
  });
  it("ignores huge bodies beyond the cap and non-breaking spaces", () => {
    const r = parseLoyaltyEmail("marriott.com", "x", `${"x ".repeat(30_000)} balance is 99,999`, AT);
    expect(get(r, "balance")).toBeUndefined();
    expect(get(parseLoyaltyEmail("marriott.com", "x", "Your balance is 7,500", AT), "balance")?.value).toBe(7_500);
  });
});
