import { CONFLICT_BAND, decideUpdate, FieldState, isMaterial, isStale, refreshConfidence, reliabilityOf, settle, SOURCE_RELIABILITY, staleDaysFor } from "../../../src/domain/loyalty-provenance";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");
const st = (value: unknown, sourceType: FieldState["sourceType"], observedAt = "2026-11-20"): FieldState => ({ value, sourceType, reliability: SOURCE_RELIABILITY[sourceType], observedAt: d(observedAt) });
const inc = (value: unknown, sourceType: FieldState["sourceType"], observedAt = "2026-11-24") => ({ value, sourceType, observedAt: d(observedAt) });

describe("TC-PROV: source scale", () => {
  it("official 100, aggregator 90, email 80, statement 75, extension 70, AI 50, manual 25", () => {
    expect(SOURCE_RELIABILITY).toEqual({ OFFICIAL_API: 100, AGGREGATOR: 90, EMAIL: 80, STATEMENT: 75, EXTENSION: 70, AI_DETECTED: 50, MANUAL: 25 });
    expect(reliabilityOf("EMAIL")).toBe(80);
  });
});

describe("TC-PROV: materiality and staleness", () => {
  it("numbers differ by 1% (at least 1); text ignores case and spacing; dates compare by day", () => {
    expect(isMaterial(100_000, 100_500)).toBe(false);
    expect(isMaterial(100_000, 102_000)).toBe(true);
    expect(isMaterial(5, 5)).toBe(false);
    expect(isMaterial(5, 6)).toBe(true);
    expect(isMaterial(0, 0)).toBe(false);
    expect(isMaterial(" Gold  Elite ", "gold elite")).toBe(false);
    expect(isMaterial("Gold", "Platinum")).toBe(true);
    expect(isMaterial(d("2026-12-01"), new Date("2026-12-01T01:00:00Z"))).toBe(false);
    expect(isMaterial(d("2026-12-01"), d("2026-12-02"))).toBe(true);
    expect(isMaterial(null, null)).toBe(false);
    expect(isMaterial(null, 5)).toBe(true);
    expect(isMaterial({ a: 1 }, { a: 1 })).toBe(false);
    expect(isMaterial({ a: 1 }, { a: 2 })).toBe(true);
  });
  it("freshness windows by field, with a default", () => {
    expect(staleDaysFor("balance")).toBe(45);
    expect(staleDaysFor("expiresAt")).toBe(180);
    expect(staleDaysFor("somethingElse")).toBe(60);
    expect(isStale(st(1, "EMAIL", "2026-09-01"), "balance", NOW)).toBe(true);
    expect(isStale(st(1, "EMAIL", "2026-11-01"), "balance", NOW)).toBe(false);
  });
  it("refresh confidence decays with age and never drops below a fifth", () => {
    expect(refreshConfidence(80, NOW, NOW)).toBe(80);
    expect(refreshConfidence(80, d("2026-08-27"), NOW)).toBe(40); // 90 days
    expect(refreshConfidence(100, d("2020-01-01"), NOW)).toBe(20);
    expect(refreshConfidence(80, null, NOW)).toBe(0);
    expect(refreshConfidence(80, d("2027-01-01"), NOW)).toBe(80); // future dates do not inflate
  });
});

describe("TC-CONF: decisions", () => {
  it("the first value is accepted", () => {
    const r = decideUpdate("balance", null, inc(120_000, "MANUAL"), NOW);
    expect(r).toMatchObject({ action: "ACCEPT", next: { value: 120_000, sourceType: "MANUAL", reliability: 25 } });
  });
  it("a higher-reliability observation replaces a lower one", () => {
    const r = decideUpdate("balance", st(100_000, "MANUAL"), inc(120_000, "EMAIL"), NOW);
    expect(r.action).toBe("ACCEPT");
    expect(r.next).toMatchObject({ value: 120_000, sourceType: "EMAIL", reliability: 80 });
    expect(r.reason).toMatch(/Higher reliability \(80 > 25\)/);
  });
  it("a lower-reliability observation NEVER overwrites a higher one", () => {
    for (const low of ["MANUAL", "AI_DETECTED", "EXTENSION"] as const) {
      const r = decideUpdate("balance", st(120_000, "OFFICIAL_API"), inc(90_000, low), NOW);
      expect(r.action).toBe("KEEP");
      expect(r.next!.value).toBe(120_000);
      expect(r.next!.sourceType).toBe("OFFICIAL_API");
    }
  });
  it("equal reliability: the newer observation wins", () => {
    const r = decideUpdate("balance", st(100_000, "EMAIL"), inc(110_000, "EMAIL"), NOW);
    expect(r).toMatchObject({ action: "ACCEPT", reason: "Newer observation of equal reliability." });
    expect(r.next!.value).toBe(110_000);
  });
  it("the same value from another source cross-confirms and keeps the higher reliability", () => {
    const r = decideUpdate("balance", st(120_000, "EMAIL"), inc(120_200, "STATEMENT"), NOW);
    expect(r).toMatchObject({ action: "CONFIRM", verification: "CROSS_CONFIRMED" });
    expect(r.next).toMatchObject({ sourceType: "EMAIL", reliability: 80, value: 120_000 });
    const up = decideUpdate("balance", st(120_000, "MANUAL"), inc(120_000, "EMAIL"), NOW);
    expect(up.next).toMatchObject({ sourceType: "EMAIL", reliability: 80 });
    const same = decideUpdate("balance", st(120_000, "EMAIL"), inc(120_000, "EMAIL"), NOW);
    expect(same).toMatchObject({ action: "CONFIRM", verification: "UNVERIFIED", reason: "Same value observed again." });
  });
  it("different values from sources within 10 points are a conflict and change nothing", () => {
    expect(CONFLICT_BAND).toBe(10);
    const r = decideUpdate("balance", st(120_000, "EMAIL"), inc(90_000, "STATEMENT"), NOW); // 80 vs 75
    expect(r.action).toBe("CONFLICT");
    expect(r.next!.value).toBe(120_000);
    expect(r.reason).toMatch(/Sources disagree/);
    expect(decideUpdate("balance", st(120_000, "STATEMENT"), inc(90_000, "EXTENSION"), NOW).action).toBe("CONFLICT"); // 75 vs 70
  });
  it("a stale high-confidence value is flagged and the newer lower observation waits as pending", () => {
    const old = st(120_000, "OFFICIAL_API", "2026-08-01");
    const r = decideUpdate("balance", old, inc(90_000, "MANUAL"), NOW);
    expect(r).toMatchObject({ action: "PENDING", currentStale: true });
    expect(r.next!.value).toBe(120_000);
    expect(r.reason).toMatch(/stale \(older than 45 days\)/);
    // not stale → plain keep
    expect(decideUpdate("balance", st(120_000, "OFFICIAL_API", "2026-11-10"), inc(90_000, "MANUAL"), NOW)).toMatchObject({ action: "KEEP", currentStale: false });
  });
  it("an observation older than the stored value is history only, whatever its reliability", () => {
    const r = decideUpdate("balance", st(120_000, "MANUAL", "2026-11-20"), inc(100_000, "OFFICIAL_API", "2026-11-01"), NOW);
    expect(r.action).toBe("KEEP");
    expect(r.reason).toMatch(/Older than the stored value/);
    expect(r.next!.value).toBe(120_000);
  });
  it("observations within a second of the stored one count as simultaneous (message dates have second precision)", () => {
    const cur: FieldState = { value: 100_000, sourceType: "EMAIL", reliability: 80, observedAt: new Date("2026-11-24T12:00:00.800Z") };
    const r = decideUpdate("balance", cur, { value: 110_000, sourceType: "EMAIL", observedAt: new Date("2026-11-24T12:00:00.000Z") }, NOW);
    expect(r.action).toBe("ACCEPT");
    const older = decideUpdate("balance", cur, { value: 110_000, sourceType: "EMAIL", observedAt: new Date("2026-11-24T11:59:58.000Z") }, NOW);
    expect(older.action).toBe("KEEP");
  });
  it("a higher-reliability observation of a stale lower value is accepted and the stale flag is reported", () => {
    const r = decideUpdate("balance", st(100_000, "MANUAL", "2026-08-01"), inc(120_000, "EMAIL"), NOW);
    expect(r).toMatchObject({ action: "ACCEPT", currentStale: true });
  });
  it("an explicit reliability overrides the source default", () => {
    const r = decideUpdate("balance", st(1, "MANUAL"), { value: 2, sourceType: "EMAIL", reliability: 60, observedAt: d("2026-11-24") }, NOW);
    expect(r.next!.reliability).toBe(60);
  });
});

describe("TC-CONF: settling a batch", () => {
  it("applies oldest first so the final state does not depend on arrival order", () => {
    const items = [
      { field: "balance", ...inc(90_000, "STATEMENT", "2026-10-01") },
      { field: "balance", ...inc(130_000, "EMAIL", "2026-11-22") },
      { field: "balance", ...inc(100_000, "MANUAL", "2026-11-10") },
      { field: "statusLevel", ...inc("Gold", "EMAIL", "2026-11-05") },
    ];
    const a = settle({}, items, NOW);
    const b = settle({}, [...items].reverse(), NOW);
    expect(a.state.balance).toMatchObject({ value: 130_000, sourceType: "EMAIL" });
    expect(a.state).toEqual(b.state);
    expect(a.outcomes.map((o) => [o.field, o.action])).toEqual([["balance", "ACCEPT"], ["statusLevel", "ACCEPT"], ["balance", "PENDING"], ["balance", "ACCEPT"]]);
    // the manual value (25) could not displace the 75 statement (it is stale, so it waits as pending); the later email replaced it
    expect(a.outcomes[2].incoming.value).toBe(100_000);
  });
  it("starting state is respected and not mutated", () => {
    const start = { balance: st(50_000, "EMAIL", "2026-11-20") };
    const r = settle(start, [{ field: "balance", ...inc(40_000, "MANUAL") }], NOW);
    expect(r.state.balance!.value).toBe(50_000);
    expect(start.balance.value).toBe(50_000);
    expect(r.outcomes[0].action).toBe("KEEP");
  });
});
