import { describe, it, expect } from "vitest";
import { monthEntries, monthlyWaterTotal, ledgerRollup, buildMonthlyCompliance, daysInMonth } from "./monthly";
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
