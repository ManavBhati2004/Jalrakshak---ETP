import { describe, it, expect, beforeEach } from "vitest";
import { useDataStore, type EtpEntryInput } from "./data";
import { ENERGY_METERS } from "@/lib/constants";

const ledger = (over: Partial<EtpEntryInput["sludge"]> = {}): EtpEntryInput["sludge"] => ({
  opening: 0, generation: 0, dispatch: 0, dateOfDisposal: "", manifestNo: "", remark: "", ...over,
});

const input = (over: Partial<EtpEntryInput> = {}): EtpEntryInput => ({
  industryId: "IND-1",
  date: "2026-10-01",
  status: "DRAFT",
  water: { RAW_FRESH_WATER: { initial: 100, final: 110 } },
  waterRemark: "",
  energy: Object.fromEntries(ENERGY_METERS.map((m) => [m.code, { initial: 1000, final: 1010 }])),
  energyRemark: "",
  sludge: ledger(),
  salt: ledger(),
  ...over,
});

describe("submitEtpEntry — CT ratio and disposals", () => {
  beforeEach(() => {
    useDataStore.setState({ industries: [], readings: [], etpEntries: [], approvals: [], alerts: [], compliance: [] });
  });

  it("records the CT ratio per energy meter, to 2 decimals, without touching any total", () => {
    const { entry } = useDataStore.getState().submitEtpEntry(input({ energyCtRatio: { ETP_POWER: 40, RO_POWER: 12.345 } }));
    expect(entry?.energyCtRatio).toEqual({ ETP_POWER: 40, RO_POWER: 12.35 });
    expect(entry?.energy?.ETP_POWER).toEqual({ initial: 1000, final: 1010, total: 10 });
  });

  it("a day with no CT ratio entered stores none", () => {
    const { entry } = useDataStore.getState().submitEtpEntry(input({ energyCtRatio: {} }));
    expect(entry).not.toBeNull();
    expect(entry && "energyCtRatio" in entry).toBe(false);
  });

  it("a disposal larger than the stock on record is saved, its closing below zero", () => {
    const { entry, error } = useDataStore.getState().submitEtpEntry(input({ sludge: ledger({ dispatch: 50, manifestNo: "MF-1", dateOfDisposal: "2026-10-01" }) }));
    expect(error).toBeUndefined();
    expect(entry?.sludge).toMatchObject({ opening: 0, generation: 0, dispatch: 50, closing: -50 });
  });

  it("a negative opening carried from the day before keeps its sign", () => {
    useDataStore.getState().submitEtpEntry(input({ sludge: ledger({ dispatch: 30, manifestNo: "MF-1", dateOfDisposal: "2026-10-01" }) }));
    const { entry } = useDataStore.getState().submitEtpEntry(input({ date: "2026-10-02", sludge: ledger({ opening: -30 }) }));
    expect(entry?.sludge).toMatchObject({ opening: -30, closing: -30 });
  });
});
