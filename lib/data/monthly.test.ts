import { describe, it, expect } from "vitest";
import { monthEntries, monthlyWaterTotal, monthlyWaterTotalOf, TRADE_EFFLUENT_RECYCLED_CODES, ledgerRollup, buildMonthlyCompliance, daysInMonth } from "./monthly";
import type { EtpEntry } from "@/lib/types";

const mk = (
  date: string,
  opts: { fresh?: number; inlet?: number; sludgeGen?: number; sludgeOpen?: number; sludgeDispatch?: number; entryStatus?: EtpEntry["entryStatus"]; status?: EtpEntry["status"] } = {},
): EtpEntry => ({
  id: `E-${date}`,
  industryId: "IND-1",
  industryName: "X",
  date,
  freshWaterConsumption: 0,
  etpInlet: 0,
  etpOutlet: 0,
  etpReuse: 0,
  roInlet: 0,
  roReject: 0,
  roPermeate: 0,
  sludgeToTSDF: 0,
  totalWaterIntake: 0,
  unit: "KL",
  status: opts.status ?? "approved",
  submittedAt: `${date}T09:00:00.000Z`,
  water: {
    RAW_FRESH_WATER: { initial: 0, final: opts.fresh ?? 0, total: opts.fresh ?? 0 },
    ETP_INLET_ALL_STREAMS: { initial: 0, final: opts.inlet ?? 0, total: opts.inlet ?? 0 },
  },
  energy: { ETP_POWER: { initial: 0, final: 100, total: 100 } },
  sludge: { opening: opts.sludgeOpen ?? 0, generation: opts.sludgeGen ?? 0, dateOfDisposal: opts.sludgeDispatch ? date : "", dispatch: opts.sludgeDispatch ?? 0, manifestNo: opts.sludgeDispatch ? "MF" : "", closing: (opts.sludgeOpen ?? 0) + (opts.sludgeGen ?? 0) - (opts.sludgeDispatch ?? 0), remark: "" },
  entryStatus: opts.entryStatus ?? "SUBMITTED",
});

describe("monthEntries — submitted, in-month, sorted ascending", () => {
  const entries = [
    mk("2026-07-03", { fresh: 30 }),
    mk("2026-07-01", { fresh: 10 }),
    mk("2026-07-02", { fresh: 20, entryStatus: "DRAFT" }), // draft excluded
    mk("2026-06-30", { fresh: 99 }), // other month excluded
    mk("2026-07-05", { fresh: 40, status: "rejected" }), // rejected excluded
  ];
  it("keeps only submitted, in-month, sorted", () => {
    const m = monthEntries(entries, "IND-1", "2026-07");
    expect(m.map((e) => e.date)).toEqual(["2026-07-01", "2026-07-03"]);
  });
  it("Raw Fresh Water auto-sum = Σ daily RAW_FRESH_WATER totals (10+30)", () => {
    expect(monthlyWaterTotal(monthEntries(entries, "IND-1", "2026-07"), "RAW_FRESH_WATER")).toBe(40);
  });
});

describe("ledgerRollup — opening(1st) / Σgen / Σdispatch / closing(last)", () => {
  const entries = [
    mk("2026-07-01", { sludgeOpen: 1000, sludgeGen: 200 }),
    mk("2026-07-02", { sludgeOpen: 1200, sludgeGen: 300, sludgeDispatch: 500 }),
    mk("2026-07-03", { sludgeOpen: 1000, sludgeGen: 150 }),
  ];
  it("rolls up correctly", () => {
    const r = ledgerRollup(monthEntries(entries, "IND-1", "2026-07"), "sludge");
    expect(r.openingKg).toBe(1000);
    expect(r.generationKg).toBe(650);
    expect(r.disposalKg).toBe(500);
    expect(r.closingKg).toBe(1150);
  });
  it("empty month → all zero", () => {
    expect(ledgerRollup([], "sludge")).toEqual({ openingKg: 0, generationKg: 0, disposalKg: 0, closingKg: 0 });
  });
});

describe("buildMonthlyCompliance + daysInMonth", () => {
  it("assembles the summary with manifests + auto-sums", () => {
    const c = buildMonthlyCompliance([mk("2026-07-02", { fresh: 15, inlet: 25, sludgeGen: 100, sludgeDispatch: 60 })], "IND-1", "2026-07", 1047593);
    expect(c.rawFreshWaterM3).toBe(15);
    expect(c.rawInfluentM3).toBe(25);
    expect(c.clothsProductionMeters).toBe(1047593);
    expect(c.manifests).toHaveLength(1);
    expect(c.manifests[0].quantityKg).toBe(60);
  });
  it("daysInMonth handles leap February", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-04")).toBe(30);
  });
});

/* ============================================================================
   Trade Effluent Generation / Recycled — the deterministic fixtures required by
   the client's change request. Values are fixture-only; nothing is hardcoded in
   production code.
   ========================================================================== */

/** An entry carrying arbitrary per-meter daily totals. */
const mkw = (
  date: string,
  water: Record<string, number>,
  opts: { industryId?: string; entryStatus?: EtpEntry["entryStatus"]; status?: EtpEntry["status"] } = {},
): EtpEntry => ({
  ...mk(date),
  industryId: opts.industryId ?? "IND-1",
  status: opts.status ?? "approved",
  entryStatus: opts.entryStatus ?? "SUBMITTED",
  water: Object.fromEntries(Object.entries(water).map(([k, v]) => [k, { initial: 0, final: v, total: v }])),
});

const RECYCLED_DAY = {
  ETP_DIRECT_REUSE: 10,
  RO_PERMEATE_COMMON: 20,
  RO_PERMEATE_3_4: 30,
  MEE_CONDENSATE: 40,
};

describe("Trade Effluent Generation — Σ 'ETP Inlet Section - Total of All Stream'", () => {
  const entries = [
    mkw("2026-07-01", { ETP_INLET_ALL_STREAMS: 100 }),
    mkw("2026-07-31", { ETP_INLET_ALL_STREAMS: 125.5 }),
  ];

  it("sums the month to 225.5 (100 + 125.5), including first and last day", () => {
    const s = buildMonthlyCompliance(entries, "IND-1", "2026-07", 0);
    expect(s.tradeEffluentGenerationM3).toBe(225.5);
  });

  it("is the water meter, NOT energy — an ETP_POWER reading never contributes", () => {
    const withPower = [...entries, mkw("2026-07-15", { ETP_INLET_ALL_STREAMS: 0 })];
    withPower[2].energy = { ETP_POWER: { initial: 0, final: 9999, total: 9999 } };
    expect(buildMonthlyCompliance(withPower, "IND-1", "2026-07", 0).tradeEffluentGenerationM3).toBe(225.5);
  });

  it("is a single field label, not a subtraction of two fields", () => {
    // A day whose inlet is 100 contributes +100 — it is never combined with any other meter.
    const one = buildMonthlyCompliance([mkw("2026-07-02", { ETP_INLET_ALL_STREAMS: 100, TERTIARY_TREATED: 60 })], "IND-1", "2026-07", 0);
    expect(one.tradeEffluentGenerationM3).toBe(100);
  });

  it("excludes another unit, other months, drafts and rejected entries", () => {
    const noisy = [
      ...entries,
      mkw("2026-07-10", { ETP_INLET_ALL_STREAMS: 500 }, { industryId: "IND-2" }),
      mkw("2026-08-01", { ETP_INLET_ALL_STREAMS: 700 }),
      mkw("2026-07-11", { ETP_INLET_ALL_STREAMS: 800 }, { entryStatus: "DRAFT" }),
      mkw("2026-07-12", { ETP_INLET_ALL_STREAMS: 900 }, { status: "rejected" }),
    ];
    expect(buildMonthlyCompliance(noisy, "IND-1", "2026-07", 0).tradeEffluentGenerationM3).toBe(225.5);
  });

  it("mirrors rawInfluentM3 exactly — one computation, no double counting", () => {
    const s = buildMonthlyCompliance(entries, "IND-1", "2026-07", 0);
    expect(s.tradeEffluentGenerationM3).toBe(s.rawInfluentM3);
  });
});

describe("Trade Effluent Recycled — Direct Reuse + RO Permeate 1&2 + RO Permeate 3&4 + MEE Condensate", () => {
  it("derives 100 for a single day (10 + 20 + 30 + 40)", () => {
    expect(monthlyWaterTotalOf([mkw("2026-07-01", RECYCLED_DAY)], TRADE_EFFLUENT_RECYCLED_CODES)).toBe(100);
  });

  it("aggregates two days to 200", () => {
    const s = buildMonthlyCompliance([mkw("2026-07-01", RECYCLED_DAY), mkw("2026-07-02", RECYCLED_DAY)], "IND-1", "2026-07", 0);
    expect(s.tradeEffluentRecycledM3).toBe(200);
  });

  it("uses all four components — dropping any one changes the result", () => {
    for (const code of TRADE_EFFLUENT_RECYCLED_CODES) {
      const partial = { ...RECYCLED_DAY } as Record<string, number>;
      delete partial[code];
      expect(monthlyWaterTotalOf([mkw("2026-07-01", partial)], TRADE_EFFLUENT_RECYCLED_CODES)).not.toBe(100);
    }
  });

  it("treats a missing component as absent, not NaN", () => {
    const v = monthlyWaterTotalOf([mkw("2026-07-01", { ETP_DIRECT_REUSE: 10 })], TRADE_EFFLUENT_RECYCLED_CODES);
    expect(v).toBe(10);
    expect(Number.isNaN(v)).toBe(false);
  });

  it("handles decimals without floating-point drift", () => {
    const day = { ETP_DIRECT_REUSE: 0.1, RO_PERMEATE_COMMON: 0.2, RO_PERMEATE_3_4: 0.3, MEE_CONDENSATE: 0.4 };
    expect(monthlyWaterTotalOf([mkw("2026-07-01", day)], TRADE_EFFLUENT_RECYCLED_CODES)).toBe(1);
  });

  it("respects month boundaries and unit scope", () => {
    const noisy = [
      mkw("2026-07-01", RECYCLED_DAY),
      mkw("2026-08-01", RECYCLED_DAY),
      mkw("2026-07-02", RECYCLED_DAY, { industryId: "IND-2" }),
      mkw("2026-07-03", RECYCLED_DAY, { entryStatus: "DRAFT" }),
    ];
    expect(buildMonthlyCompliance(noisy, "IND-1", "2026-07", 0).tradeEffluentRecycledM3).toBe(100);
  });

  it("RECYCLE WATER mirrors it (client-confirmed same measure)", () => {
    const s = buildMonthlyCompliance([mkw("2026-07-01", RECYCLED_DAY)], "IND-1", "2026-07", 0);
    expect(s.recycleWaterM3).toBe(s.tradeEffluentRecycledM3);
  });

  it("stays distinct from Trade Effluent Generation", () => {
    const s = buildMonthlyCompliance([mkw("2026-07-01", { ...RECYCLED_DAY, ETP_INLET_ALL_STREAMS: 999 })], "IND-1", "2026-07", 0);
    expect(s.tradeEffluentRecycledM3).toBe(100);
    expect(s.tradeEffluentGenerationM3).toBe(999);
  });
});

describe("Dashboard MEE metrics — per-meter monthly sums", () => {
  it("reports Feed / Condensate / Reject independently", () => {
    const s = buildMonthlyCompliance(
      [mkw("2026-07-01", { MEE_FEED: 5, MEE_CONDENSATE: 3, MEE_REJECT: 2 }), mkw("2026-07-02", { MEE_FEED: 5, MEE_CONDENSATE: 3, MEE_REJECT: 2 })],
      "IND-1",
      "2026-07",
      0,
    );
    expect([s.meeFeedM3, s.meeCondensateM3, s.meeRejectM3]).toEqual([10, 6, 4]);
  });
});
