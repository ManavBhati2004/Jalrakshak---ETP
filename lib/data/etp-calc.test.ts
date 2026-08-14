import { describe, it, expect } from "vitest";
import {
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
