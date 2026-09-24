import { describe, it, expect } from "vitest";
import {
  round1,
  kgToMt,
  meterTotal,
  groupGrandTotals,
  closingBalance,
  dispatchNeedsManifest,
  dispatchExceedsStock,
  resolveCarryForward,
  cumulativeDispatch,
  authorisedQuantityWarning,
  authorisationUsage,
  mtToKg,
  toCanonicalKg,
  parseDailyValue,
  previousCalendarDay,
  dateRangeValid,
  entryMeterTotal,
  entryEnergyTotal,
  entryCustomTotal,
  entryCustomReading,
  carriedCustomFinal,
  customColumnUnit,
  meterRowStatus,
  toMeterReading,
} from "./etp-calc";
import type { EtpEntry } from "@/lib/types";

/* ---------------- Numeric validation (master §19.1) ---------------- */
describe("parseDailyValue — numeric standard (≤7 int, ≤1 decimal)", () => {
  it("accepts 0, 0.0, 9999999.9", () => {
    expect(parseDailyValue("0").value).toBe(0);
    expect(parseDailyValue("0.0").value).toBe(0);
    expect(parseDailyValue("9999999.9").value).toBe(9999999.9);
  });
  it("rejects 10000000.0 (>7 integer digits / over max)", () => {
    expect(parseDailyValue("10000000.0").error).toBeDefined();
  });
  it("rejects more than one decimal (12.34)", () => {
    expect(parseDailyValue("12.34").error).toBe("TOO_MANY_DECIMALS");
  });
  it("rejects negatives (-1.0)", () => {
    expect(parseDailyValue("-1.0").error).toBeDefined();
  });
  it("rejects scientific notation (1e5)", () => {
    expect(parseDailyValue("1e5").error).toBe("NOT_NUMERIC");
  });
  it("allows an empty intermediate value while typing", () => {
    expect(parseDailyValue("").value).toBeNull();
    expect(parseDailyValue("").error).toBeUndefined();
  });
});

/* ---------------- Water / energy calculation ---------------- */
describe("meterTotal — Final − Initial", () => {
  it("100.0 → 125.5 = 25.5", () => expect(meterTotal(100, 125.5)).toBe(25.5));
  it("equal readings → 0.0", () => expect(meterTotal(125.5, 125.5)).toBe(0));
  it("carry example: prev Final 125.4, new Final 130.2 → 4.8", () => expect(meterTotal(125.4, 130.2)).toBe(4.8));
});

describe("groupGrandTotals — per-sheet, RO excludes the common permeate meter", () => {
  const water = {
    RAW_FRESH_WATER: { initial: 0, final: 10, total: 10 },
    ETP_INLET_ALL_STREAMS: { initial: 0, final: 20, total: 20 },
    TERTIARY_TREATED: { initial: 0, final: 5, total: 5 },
    ETP_DIRECT_REUSE: { initial: 0, final: 5, total: 5 },
    RO_FEED_1_2: { initial: 0, final: 8, total: 8 },
    RO_PERMEATE_COMMON: { initial: 0, final: 6, total: 6 }, // excluded from RO grand total
    RO_REJECT_1_2: { initial: 0, final: 2, total: 2 },
    RO_PERMEATE_3_4: { initial: 0, final: 3, total: 3 },
    RO_REJECT_3_4: { initial: 0, final: 1, total: 1 },
    MEE_FEED: { initial: 0, final: 4, total: 4 },
    MEE_CONDENSATE: { initial: 0, final: 3, total: 3 },
    MEE_REJECT: { initial: 0, final: 1, total: 1 },
  };
  it("daily = 10+20+5+5 = 40", () => expect(groupGrandTotals(water).daily).toBe(40));
  it("ro = 8+2+3+1 = 14 (permeate common 6 excluded)", () => expect(groupGrandTotals(water).ro).toBe(14));
  it("mee = 4+3+1 = 8", () => expect(groupGrandTotals(water).mee).toBe(8));
});

/* ---------------- Sludge / salt ledger ---------------- */
describe("closingBalance = Opening + Generation − Dispatch", () => {
  it("1920 + 1885 − 960 = 2845", () => expect(closingBalance(1920, 1885, 960)).toBe(2845));
  it("100.0 + 20.5 − 5.0 = 115.5", () => expect(closingBalance(100, 20.5, 5)).toBe(115.5));
});

describe("dispatch validation", () => {
  it("dispatch>0 without manifest blocks", () => expect(dispatchNeedsManifest(10, "", "2026-08-14")).toBe(true));
  it("dispatch>0 without disposal date blocks", () => expect(dispatchNeedsManifest(10, "MF-1", "")).toBe(true));
  it("whitespace manifest does not satisfy", () => expect(dispatchNeedsManifest(10, "   ", "2026-08-14")).toBe(true));
  it("dispatch 0 without manifest/date is valid", () => expect(dispatchNeedsManifest(0, "", "")).toBe(false));
  it("dispatch beyond stock blocks", () => expect(dispatchExceedsStock(100, 20, 130)).toBe(true));
  it("dispatch within stock ok", () => expect(dispatchExceedsStock(100, 20, 120)).toBe(false));
});

/* ---------------- Quantity conversion ---------------- */
describe("MT → kg conversion (no double-convert)", () => {
  it("1 MT → 1000 kg", () => expect(mtToKg(1)).toBe(1000));
  it("1.25 MT → 1250 kg", () => expect(mtToKg(1.25)).toBe(1250));
  it("500 kg stays 500 kg", () => expect(toCanonicalKg(500, "KG")).toBe(500));
  it("15.42 MT → 15420 kg", () => expect(toCanonicalKg(15.42, "MT")).toBe(15420));
});

/* ---------------- Carry-forward + continuity ---------------- */
const mkEntry = (industryId: string, date: string, sludgeDispatch = 0, status: EtpEntry["status"] = "approved", entryStatus: EtpEntry["entryStatus"] = "SUBMITTED"): EtpEntry => ({
  id: `E-${date}`,
  industryId,
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
  status,
  submittedAt: `${date}T09:00:00.000Z`,
  water: { RAW_FRESH_WATER: { initial: 100, final: 125, total: 25 } },
  sludge: { opening: 0, generation: 0, dateOfDisposal: "", dispatch: sludgeDispatch, manifestNo: "", closing: 0, remark: "" },
  entryStatus,
});

describe("resolveCarryForward — immediately-previous day only", () => {
  it("first-ever entry (no priors) is a baseline", () => {
    const cf = resolveCarryForward([], "IND-1", "2026-08-14");
    expect(cf.isFirstEver).toBe(true);
    expect(cf.missingPriorDay).toBe(false);
  });
  it("consecutive day carries from yesterday", () => {
    const cf = resolveCarryForward([mkEntry("IND-1", "2026-08-13")], "IND-1", "2026-08-14");
    expect(cf.priorDay?.date).toBe("2026-08-13");
    expect(cf.missingPriorDay).toBe(false);
  });
  it("gap (prior entries exist but not yesterday) → missingPriorDay", () => {
    const cf = resolveCarryForward([mkEntry("IND-1", "2026-08-01")], "IND-1", "2026-08-14");
    expect(cf.priorDay).toBeUndefined();
    expect(cf.missingPriorDay).toBe(true);
  });
  it("crosses a month boundary", () => {
    const cf = resolveCarryForward([mkEntry("IND-1", "2026-07-31")], "IND-1", "2026-08-01");
    expect(cf.priorDay?.date).toBe("2026-07-31");
  });
  it("previousCalendarDay handles year boundary", () => {
    expect(previousCalendarDay("2026-01-01")).toBe("2025-12-31");
  });
});

/* ---------------- Authorisation usage ---------------- */
describe("cumulativeDispatch + warning", () => {
  const entries = [
    mkEntry("IND-1", "2026-08-10", 5000),
    mkEntry("IND-1", "2026-08-11", 7000),
    mkEntry("IND-1", "2026-08-12", 2000, "approved", "DRAFT"), // draft excluded
    mkEntry("IND-2", "2026-08-11", 9999), // other tenant excluded
  ];
  it("sums submitted/approved dispatch for the unit, excluding drafts & other tenants", () => {
    expect(cumulativeDispatch(entries, "IND-1", "sludge")).toBe(12000);
  });
  it("respects the validity window", () => {
    expect(cumulativeDispatch(entries, "IND-1", "sludge", "2026-08-11", "2026-08-31")).toBe(7000);
  });
  it("warning: none below threshold, approaching ≥80%, exceeded ≥100%", () => {
    expect(authorisedQuantityWarning(1000, 15420)).toBe("none");
    expect(authorisedQuantityWarning(12400, 15420)).toBe("approaching"); // ~80.4%
    expect(authorisedQuantityWarning(15420, 15420)).toBe("exceeded");
  });
  it("no warning when authorisation is not configured", () => {
    expect(authorisedQuantityWarning(9999, undefined)).toBe("none");
    expect(authorisationUsage(9999, undefined).configured).toBe(false);
  });
});

describe("dateRangeValid", () => {
  it("from ≤ to is valid", () => expect(dateRangeValid("2026-01-01", "2026-12-31")).toBe(true));
  it("from > to is invalid", () => expect(dateRangeValid("2026-12-31", "2026-01-01")).toBe(false));
});

/* ---------------- Hardening: coercion, guards, MT, draft-exclusion ---------------- */
describe("round1 — coerces & guards non-finite (no garbage propagation)", () => {
  it("coerces numeric strings", () => expect(round1("125.44" as unknown as number)).toBe(125.4));
  it("NaN → 0", () => expect(round1(NaN)).toBe(0));
  it("Infinity → 0", () => expect(round1(Infinity)).toBe(0));
  it("non-numeric string → 0", () => expect(round1("abc" as unknown as number)).toBe(0));
});

describe("kgToMt — single source of truth (3-dp MT)", () => {
  it("15420 kg → 15.42 MT", () => expect(kgToMt(15420)).toBe(15.42));
  it("1234.5 kg → 1.235 MT", () => expect(kgToMt(1234.5)).toBe(1.235));
  it("0 / garbage → 0", () => expect(kgToMt(NaN)).toBe(0));
});

describe("reduces coerce stringy totals instead of concatenating", () => {
  it("groupGrandTotals sums string totals numerically (500+20=520, not '050020')", () => {
    const water = {
      RAW_FRESH_WATER: { initial: 0, final: 500, total: "500" as unknown as number },
      ETP_INLET_ALL_STREAMS: { initial: 0, final: 20, total: "20" as unknown as number },
    };
    expect(groupGrandTotals(water).daily).toBe(520);
  });
  it("cumulativeDispatch sums string dispatch numerically", () => {
    const e: EtpEntry = {
      id: "E-1", industryId: "IND-1", industryName: "X", date: "2026-08-10",
      freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
      sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "approved", submittedAt: "x",
      sludge: { opening: 0, generation: 0, dateOfDisposal: "", dispatch: "600" as unknown as number, manifestNo: "", closing: 0, remark: "" },
      entryStatus: "SUBMITTED",
    };
    expect(cumulativeDispatch([e, { ...e, id: "E-2", sludge: { ...e.sludge!, dispatch: "700" as unknown as number } }], "IND-1", "sludge")).toBe(1300);
  });
});

describe("resolveCarryForward — drafts/rejected are NOT valid priors", () => {
  const draft = (date: string): EtpEntry => ({
    id: `E-${date}`, industryId: "IND-1", industryName: "X", date,
    freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
    sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "pending", submittedAt: "x",
    water: { RAW_FRESH_WATER: { initial: 0, final: 5, total: 5 } }, entryStatus: "DRAFT",
  });
  it("a DRAFT yesterday does not satisfy continuity and is treated as no prior", () => {
    const cf = resolveCarryForward([draft("2026-08-13")], "IND-1", "2026-08-14");
    expect(cf.priorDay).toBeUndefined();
    expect(cf.isFirstEver).toBe(true); // the only entry is a draft → still a baseline
    expect(cf.missingPriorDay).toBe(false);
  });
  it("a SUBMITTED yesterday still carries", () => {
    const cf = resolveCarryForward([{ ...draft("2026-08-13"), entryStatus: "SUBMITTED", status: "approved" }], "IND-1", "2026-08-14");
    expect(cf.priorDay?.date).toBe("2026-08-13");
  });
});

/* ============================================================================
   MEE parameters as first-class monitored values. They carry no `legacyKey`, so
   they are reachable ONLY via entry.water[code] — never a legacy scalar.
   ========================================================================== */
describe("entryMeterTotal / entryEnergyTotal — MEE and energy accessors", () => {
  const base = (): EtpEntry => ({
    id: "E-1", industryId: "IND-1", industryName: "X", date: "2026-07-01",
    freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
    sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "approved", submittedAt: "x", entryStatus: "SUBMITTED",
  });

  it("reads each MEE meter's daily total", () => {
    const e: EtpEntry = { ...base(), water: {
      MEE_FEED: { initial: 10, final: 15, total: 5 },
      MEE_CONDENSATE: { initial: 3, final: 6.5, total: 3.5 },
      MEE_REJECT: { initial: 0, final: 1.2, total: 1.2 },
    } };
    expect(entryMeterTotal(e, "MEE_FEED")).toBe(5);
    expect(entryMeterTotal(e, "MEE_CONDENSATE")).toBe(3.5);
    expect(entryMeterTotal(e, "MEE_REJECT")).toBe(1.2);
  });

  it("returns null — NOT 0 — for a meter the entry never recorded", () => {
    // Older entries predate these meters; reporting a fabricated 0 would be a false reading.
    const e: EtpEntry = { ...base(), water: { RAW_FRESH_WATER: { initial: 0, final: 1, total: 1 } } };
    expect(entryMeterTotal(e, "MEE_FEED")).toBeNull();
    expect(entryMeterTotal(e, "MEE_CONDENSATE")).toBeNull();
  });

  it("returns null when the entry has no water block at all (legacy record)", () => {
    expect(entryMeterTotal(base(), "MEE_FEED")).toBeNull();
    expect(entryEnergyTotal(base(), "ETP_POWER")).toBeNull();
  });

  it("distinguishes a genuine zero reading from a missing one", () => {
    const e: EtpEntry = { ...base(), water: { MEE_REJECT: { initial: 4, final: 4, total: 0 } } };
    expect(entryMeterTotal(e, "MEE_REJECT")).toBe(0);
    expect(entryMeterTotal(e, "MEE_FEED")).toBeNull();
  });

  it("reads energy meters and rounds to the daily standard", () => {
    const e: EtpEntry = { ...base(), energy: { ETP_POWER: { initial: 100, final: 251.55, total: 151.55 } } };
    expect(entryEnergyTotal(e, "ETP_POWER")).toBe(151.6);
  });
});

/* ============================================================================
   Custom columns as operator-defined METERS. Two eras coexist forever: entries
   filed before the change hold only a scalar daily total, newer ones hold a full
   Initial/Final/Total. Nothing may fabricate an Initial for the older ones, and
   nothing may report an unrecorded column as a measured 0.
   ========================================================================== */
describe("custom columns — meter accessors across both storage eras", () => {
  const base = (over: Partial<EtpEntry> = {}): EtpEntry => ({
    id: "E-1", industryId: "IND-1", industryName: "X", date: "2026-07-10",
    freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
    sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "approved", submittedAt: "x", entryStatus: "SUBMITTED",
    ...over,
  });

  it("reads the meter total when the column was filed as a meter", () => {
    const e = base({ customMeters: { "CC-A": { initial: 120, final: 145.5, total: 25.5 } }, custom: { "CC-A": 25.5 } });
    expect(entryCustomTotal(e, "CC-A")).toBe(25.5);
    expect(entryCustomReading(e, "CC-A")).toEqual({ initial: 120, final: 145.5, total: 25.5 });
  });

  it("falls back to the legacy scalar so already-filed values never vanish", () => {
    // The pre-change shape: one typed number, no Initial/Final. This is live production data.
    const e = base({ custom: { "CC-A": 42 } });
    expect(entryCustomTotal(e, "CC-A")).toBe(42);
    // ...but it exposes NO meter reading: those positions were never measured.
    expect(entryCustomReading(e, "CC-A")).toBeNull();
  });

  it("prefers the meter total over a stale scalar", () => {
    const e = base({ customMeters: { "CC-A": { initial: 10, final: 30, total: 20 } }, custom: { "CC-A": 999 } });
    expect(entryCustomTotal(e, "CC-A")).toBe(20);
  });

  it("returns null — NOT 0 — for a column the day never recorded", () => {
    expect(entryCustomTotal(base(), "CC-A")).toBeNull();
    expect(entryCustomTotal(base({ custom: { "CC-A": null } }), "CC-A")).toBeNull();
    expect(entryCustomTotal(base({ customMeters: {} }), "CC-A")).toBeNull();
    expect(entryCustomTotal(base({ custom: { "CC-B": 5 } }), "CC-A")).toBeNull();
  });

  it("distinguishes a genuine zero reading from a missing one", () => {
    const e = base({ customMeters: { "CC-A": { initial: 4, final: 4, total: 0 } }, custom: { "CC-A": 0 } });
    expect(entryCustomTotal(e, "CC-A")).toBe(0);
    expect(entryCustomTotal(e, "CC-B")).toBeNull();
  });

  it("rounds to the one-decimal daily standard", () => {
    expect(entryCustomTotal(base({ custom: { "CC-A": 151.55 } }), "CC-A")).toBe(151.6);
  });
});

describe("carriedCustomFinal — per-column carry-forward baseline", () => {
  const day = (date: string, over: Partial<EtpEntry> = {}): EtpEntry => ({
    id: `E-${date}`, industryId: "IND-1", industryName: "X", date,
    freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
    sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "approved", submittedAt: "x", entryStatus: "SUBMITTED",
    ...over,
  });
  const withMeter = (date: string, final: number, over: Partial<EtpEntry> = {}) =>
    day(date, { customMeters: { "CC-A": { initial: 0, final, total: final } }, ...over });

  it("carries the previous day's Final", () => {
    const entries = [withMeter("2026-07-09", 145.5)];
    expect(carriedCustomFinal(entries, "IND-1", "2026-07-10", "CC-A")).toBe(145.5);
  });

  it("skips days that recorded nothing for THIS column", () => {
    // A blank column files no reading, so gaps are normal - the baseline is the last real one.
    const entries = [withMeter("2026-07-05", 100), day("2026-07-08"), day("2026-07-09")];
    expect(carriedCustomFinal(entries, "IND-1", "2026-07-10", "CC-A")).toBe(100);
  });

  it("never carries from a legacy scalar — that is a daily quantity, not a meter position", () => {
    const entries = [day("2026-07-09", { custom: { "CC-A": 42 } })];
    expect(carriedCustomFinal(entries, "IND-1", "2026-07-10", "CC-A")).toBeNull();
  });

  it("ignores drafts and rejected entries", () => {
    expect(carriedCustomFinal([withMeter("2026-07-09", 80, { entryStatus: "DRAFT" })], "IND-1", "2026-07-10", "CC-A")).toBeNull();
    expect(carriedCustomFinal([withMeter("2026-07-09", 80, { status: "rejected" })], "IND-1", "2026-07-10", "CC-A")).toBeNull();
  });

  it("never reads another unit's entries, or today's, or the future", () => {
    expect(carriedCustomFinal([withMeter("2026-07-09", 80, { industryId: "IND-2" })], "IND-1", "2026-07-10", "CC-A")).toBeNull();
    expect(carriedCustomFinal([withMeter("2026-07-10", 80)], "IND-1", "2026-07-10", "CC-A")).toBeNull();
    expect(carriedCustomFinal([withMeter("2026-07-11", 80)], "IND-1", "2026-07-10", "CC-A")).toBeNull();
  });

  it("returns null for the first-ever entry and for an unknown column", () => {
    expect(carriedCustomFinal([], "IND-1", "2026-07-10", "CC-A")).toBeNull();
    expect(carriedCustomFinal([withMeter("2026-07-09", 80)], "IND-1", "2026-07-10", "CC-ZZZ")).toBeNull();
  });

  it("a genuine 0 Final is still a valid baseline", () => {
    expect(carriedCustomFinal([withMeter("2026-07-09", 0)], "IND-1", "2026-07-10", "CC-A")).toBe(0);
  });
});

describe("custom columns share the meter row rules and unit defaulting", () => {
  it("Total = Final − Initial, via the same builder the water meters use", () => {
    expect(toMeterReading(120, 145.5)).toEqual({ initial: 120, final: 145.5, total: 25.5 });
  });

  it("a carried Initial with a blank Final is incomplete, not an error", () => {
    // Custom columns are deliberately excluded from the submit-blocking `incomplete` gate:
    // the Initial is auto-carried, so this is the state of every untouched column.
    expect(meterRowStatus("120", "")).toMatchObject({ incomplete: true, belowInitial: false });
  });

  it("a Final below the Initial is a real error", () => {
    expect(meterRowStatus("120", "119")).toMatchObject({ belowInitial: true });
  });

  it("both blank is neither", () => {
    expect(meterRowStatus("", "")).toMatchObject({ incomplete: false, belowInitial: false, total: 0 });
  });

  it("defaults the unit for columns defined before units existed", () => {
    expect(customColumnUnit({})).toBe("M3");
    expect(customColumnUnit({ unit: "" })).toBe("M3");
    expect(customColumnUnit({ unit: "  " })).toBe("M3");
    expect(customColumnUnit({ unit: "Kwh" })).toBe("Kwh");
  });
});
