import { describe, it, expect } from "vitest";
import type { EtpEntry, Industry } from "@/lib/types";
import type { StoreData } from "@/lib/data/firestore-storage";
import { shardByIndustry, mergeSlices } from "@/lib/data/firestore-storage";

/**
 * Proves the RSPCB prescribed-return fields survive the exact Firestore write path.
 * `firestoreStorage.setItem` shards the store into per-industry slices and
 * `writeSlice` persists `JSON.stringify(slice)` to `industries/{id}`; on load the
 * slices are `JSON.parse`d and merged back. This test round-trips a new-shape entry
 * and an expanded industry through shard → JSON → merge and asserts nothing is lost.
 */

const industry: Industry = {
  id: "IND-777",
  name: "Round Trip Textiles",
  ownerName: "Owner",
  area: "Zone",
  address: "Addr",
  contactPerson: "Owner",
  mobile: "9999999999",
  email: "a@b.in",
  consentNumber: "2021-2022/TCD/7154",
  permittedKLD: 600,
  status: "pending",
  cetpId: null,
  isIndividualETP: true,
  complianceScore: 75,
  etpCapacity: 600,
  roCapacity: 200,
  meeCapacity: 100,
  maxEffluentGeneration: 600,
  roStage1: 200,
  roStage2: 150,
  roStage3: 100,
  roStage4: 50,
  // Fateh prescribed-return registration fields:
  misId: "72765",
  tehsil: "Balotra",
  district: "Barmer",
  consentOrderNo: "2021-2022/TCD/7154",
  consentOrderDate: "2021-04-09",
  consentValidFrom: "2021-04-09",
  consentValidTo: "2026-04-08",
  hwmAuthNo: "RPCB/HWM/2022-2023/TCD/HSW/14",
  hwmAuthDate: "2022-05-01",
  hwmValidFrom: "2022-05-01",
  hwmValidTo: "2027-04-30",
  authorisedQuantityKg: 1250,
  tsdfName: "TSDF Facility",
  tsdfAddress: "TSDF Address",
  signatoryName: "Signatory",
  signatoryDesignation: "Prop.",
  lastReadingAt: null,
  alertsCount: 0,
  registeredAt: "2026-08-05T00:00:00.000Z",
};

const entry: EtpEntry = {
  id: "E-RT1",
  industryId: "IND-777",
  industryName: "Round Trip Textiles",
  date: "2026-08-05",
  freshWaterConsumption: 555,
  etpInlet: 500,
  etpOutlet: 0,
  etpReuse: 80,
  roInlet: 420,
  roReject: 160,
  roPermeate: 260,
  sludgeToTSDF: 0,
  totalWaterIntake: 895,
  unit: "KL",
  status: "pending",
  submittedAt: "2026-08-05T09:00:00.000Z",
  water: {
    freshWaterConsumption: { initial: 32956, final: 33511, total: 555 },
    roPermeate: { initial: 10000, final: 10260, total: 260 },
    meeReject: { initial: 500, final: 540, total: 40 },
  },
  waterGrandTotal: 855,
  waterRemark: "no production on line 2",
  energy: {
    etpInletEnergy: { initial: 120000, final: 121200, total: 1200 },
    meeRejectEnergy: { initial: 50000, final: 51800, total: 1800 },
  },
  energyRemark: "power failure 2h",
  sludge: { opening: 2845.5, generation: 1885.0, dateOfDisposal: "2026-08-05", dispatch: 960.0, manifestNo: "MF-1", closing: 3770.5, remark: "dispatched" },
  salt: { opening: 100.0, generation: 20.5, dateOfDisposal: "", dispatch: 0, manifestNo: "", closing: 120.5, remark: "" },
};

describe("Firestore persistence round-trip (backend connection)", () => {
  it("preserves the structured entry + Fateh industry fields through shard → JSON → merge", () => {
    const data: Partial<StoreData> = { industries: [industry], readings: [], etpEntries: [entry], approvals: [], alerts: [], compliance: [] };

    // Shard exactly as firestoreStorage.setItem does, then serialize each slice to
    // JSON (what writeSlice persists) and parse back (what loadOneIndustry reads).
    const sharded = shardByIndustry(data);
    const slice = sharded.get("IND-777");
    expect(slice).toBeTruthy();
    const persisted = JSON.parse(JSON.stringify(slice!));
    const merged = mergeSlices([persisted]);

    // Industry Fateh fields survived.
    const ind = merged.industries.find((i) => i.id === "IND-777");
    expect(ind?.misId).toBe("72765");
    expect(ind?.authorisedQuantityKg).toBe(1250);
    expect(ind?.hwmAuthNo).toBe("RPCB/HWM/2022-2023/TCD/HSW/14");
    expect(ind?.tsdfName).toBe("TSDF Facility");
    expect(ind?.signatoryDesignation).toBe("Prop.");

    // Structured entry survived intact.
    const e = merged.etpEntries.find((x) => x.id === "E-RT1");
    expect(e?.water?.freshWaterConsumption).toEqual({ initial: 32956, final: 33511, total: 555 });
    expect(e?.waterGrandTotal).toBe(855);
    expect(e?.waterRemark).toBe("no production on line 2");
    expect(e?.energy?.meeRejectEnergy?.total).toBe(1800);
    expect(e?.energyRemark).toBe("power failure 2h");
    expect(e?.sludge?.closing).toBe(3770.5);
    expect(e?.sludge?.manifestNo).toBe("MF-1");
    expect(e?.salt?.closing).toBe(120.5);
  });
});
