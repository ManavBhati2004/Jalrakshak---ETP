import { describe, it, expect } from "vitest";
import type { EtpEntry, MeterReading, HwLedger } from "@/lib/types";
import {
  round1,
  meterTotal,
  meterRowStatus,
  toMeterReading,
  computeGrandTotal,
  closingBalance,
  toLedger,
  mtToKg,
  resolveCarryForward,
  cumulativeDispatch,
  finalBelowInitial,
  dispatchNeedsManifest,
  dateRangeValid,
  authorisedQuantityWarning,
} from "@/lib/data/etp-calc";

// Minimal EtpEntry factory (fills required scalars; overrides merged on top).
function mkEntry(over: Partial<EtpEntry>): EtpEntry {
  return {
    id: "E-x",
    industryId: "IND-001",
    industryName: "Test",
    date: "2026-01-01",
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
    status: "pending",
    submittedAt: "2026-01-01T09:00:00.000Z",
    ...over,
  };
}
const meter = (initial: number, final: number): MeterReading => ({ initial, final, total: meterTotal(initial, final) });
const ledger = (o: Partial<HwLedger>): HwLedger =>
  toLedger({ opening: 0, generation: 0, dateOfDisposal: "", dispatch: 0, manifestNo: "", remark: "", ...o });

describe("water meter calculation (§13 Water)", () => {
  it("Total = Final − Initial: 125.4 → 130.2 = 4.8 (no float noise)", () => {
    expect(meterTotal(125.4, 130.2)).toBe(4.8);
  });

  it("flags Final below Initial", () => {
    expect(finalBelowInitial(125.4, 120.0)).toBe(true);
    expect(finalBelowInitial(125.4, 130.2)).toBe(false);
  });

  it("Grand Total equals the sum of the ten meter totals", () => {
    const water: Record<string, MeterReading> = {};
    let expected = 0;
    for (let i = 0; i < 10; i++) {
      const t = i + 1.1;
      water[`m${i}`] = meter(0, t);
      expected += t;
    }
    expect(computeGrandTotal(water)).toBe(round1(expected));
  });

  it("toMeterReading stores the computed total", () => {
    expect(toMeterReading(100, 112.5)).toEqual({ initial: 100, final: 112.5, total: 12.5 });
  });

  // Regression: a carried-forward Initial with a blank Final must NOT slip through
  // as Final=0 / negative total — it is incomplete and must block save.
  it("blank Final on a carried Initial is incomplete (blocks save), total 0 not negative", () => {
    expect(meterRowStatus("800", "")).toEqual({ total: 0, incomplete: true, belowInitial: false });
  });
  it("Final below Initial is belowInitial (blocks save)", () => {
    expect(meterRowStatus("800", "700")).toEqual({ total: -100, incomplete: false, belowInitial: true });
  });
  it("valid complete row: 125.4 → 130.2 = 4.8, not flagged", () => {
    expect(meterRowStatus("125.4", "130.2")).toEqual({ total: 4.8, incomplete: false, belowInitial: false });
  });
  it("first-entry unused meter (both blank) is valid with 0 total", () => {
    expect(meterRowStatus("", "")).toEqual({ total: 0, incomplete: false, belowInitial: false });
  });
});

describe("carry-forward (§9)", () => {
  const entries: EtpEntry[] = [
    mkEntry({ id: "E-1", industryId: "IND-019", date: "2026-01-01", water: { fresh: meter(0, 100) } }),
    mkEntry({ id: "E-2", industryId: "IND-019", date: "2026-02-15", water: { fresh: meter(100, 130.2) } }), // across month
    mkEntry({ id: "E-3", industryId: "IND-020", date: "2026-03-01", water: { fresh: meter(0, 50) } }),
  ];

  it("returns the most-recent prior entry for the unit (across month boundary)", () => {
    const prior = resolveCarryForward(entries, "IND-019");
    expect(prior?.id).toBe("E-2");
    expect(prior?.water?.fresh.final).toBe(130.2); // next day's Initial
  });

  it("is scoped by unit — never crosses tenants", () => {
    expect(resolveCarryForward(entries, "IND-020")?.id).toBe("E-3");
  });

  it("returns undefined when the unit has no prior entry (no fabrication)", () => {
    expect(resolveCarryForward(entries, "IND-999")).toBeUndefined();
  });
});

describe("sludge / salt ledger (§13 ETP sludge)", () => {
  it("Closing = Opening + Generation − Dispatch: 100.0 + 20.5 − 5.0 = 115.5", () => {
    expect(closingBalance(100.0, 20.5, 5.0)).toBe(115.5);
  });

  it("toLedger computes closing to one decimal", () => {
    expect(ledger({ opening: 2845.5, generation: 1885.0, dispatch: 960.0 }).closing).toBe(3770.5);
  });

  it("dispatch > 0 requires Manifest No. AND Date of disposal", () => {
    expect(dispatchNeedsManifest(5, "", "2026-01-01")).toBe(true); // missing manifest
    expect(dispatchNeedsManifest(5, "MF-1", "")).toBe(true); // missing date
    expect(dispatchNeedsManifest(5, "MF-1", "2026-01-01")).toBe(false); // ok
    expect(dispatchNeedsManifest(0, "", "")).toBe(false); // no dispatch → no requirement
  });

  it("cumulative dispatch sums a ledger across a unit's entries", () => {
    const entries = [
      mkEntry({ industryId: "IND-019", sludge: ledger({ dispatch: 10 }) }),
      mkEntry({ industryId: "IND-019", sludge: ledger({ dispatch: 5.5 }) }),
      mkEntry({ industryId: "IND-020", sludge: ledger({ dispatch: 99 }) }),
    ];
    expect(cumulativeDispatch(entries, "IND-019", "sludge")).toBe(15.5);
  });
});

describe("MT → kg conversion (§13 Registration)", () => {
  it("1.25 MT is stored as 1250 kg", () => {
    expect(mtToKg(1.25, "MT")).toBe(1250);
  });
  it("kg passes through unchanged", () => {
    expect(mtToKg(1250, "kg")).toBe(1250);
  });
});

describe("date-range validation (§3 Consent/HWM)", () => {
  it("valid when to ≥ from", () => {
    expect(dateRangeValid("2026-01-01", "2026-06-30")).toBe(true);
    expect(dateRangeValid("2026-06-30", "2026-06-30")).toBe(true);
  });
  it("invalid when to < from", () => {
    expect(dateRangeValid("2026-06-30", "2026-01-01")).toBe(false);
  });
  it("optional — passes when either bound is empty", () => {
    expect(dateRangeValid("", "2026-06-30")).toBe(true);
    expect(dateRangeValid("2026-01-01", "")).toBe(true);
  });
});

describe("authorised-quantity warning (§7)", () => {
  it("none below the threshold", () => {
    expect(authorisedQuantityWarning(700, 1000)).toBe("none"); // 70% < 80
  });
  it("approaching at/above the threshold", () => {
    expect(authorisedQuantityWarning(800, 1000)).toBe("approaching"); // 80%
    expect(authorisedQuantityWarning(950, 1000)).toBe("approaching");
  });
  it("exceeded at/above 100%", () => {
    expect(authorisedQuantityWarning(1000, 1000)).toBe("exceeded");
    expect(authorisedQuantityWarning(1200, 1000)).toBe("exceeded");
  });
  it("none when no authorised quantity is registered", () => {
    expect(authorisedQuantityWarning(500, undefined)).toBe("none");
    expect(authorisedQuantityWarning(500, 0)).toBe("none");
  });
});
