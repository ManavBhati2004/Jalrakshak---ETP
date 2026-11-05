import { describe, it, expect, beforeEach } from "vitest";
import { useDataStore, type EtpEntryInput } from "./data";
import { ENERGY_METERS } from "@/lib/constants";
import type { Approval, EtpEntry } from "@/lib/types";

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

describe("submitEtpEntry — the next day follows a corrected Final", () => {
  const CC = "CC-A";
  const filedDay = (date: string, i: number, f: number, over: Partial<EtpEntry> = {}) => {
    const { entry } = useDataStore.getState().submitEtpEntry(
      input({ date, status: "DRAFT", water: { RAW_FRESH_WATER: { initial: i, final: f } }, customMeters: { [CC]: { initial: i, final: f } } }),
    );
    // Fixed ids: two days saved within one millisecond would otherwise share a Date.now() id.
    const filed = { ...entry!, id: `E-${date}`, entryStatus: "SUBMITTED", status: "approved", ...over } as EtpEntry;
    useDataStore.setState((s) => ({ etpEntries: s.etpEntries.map((e) => (e.date === date ? filed : e)) }));
    return filed;
  };
  const approvalOf = (e: EtpEntry) => ({ id: `AP-${e.id}`, readingId: e.id, industryId: "IND-1", stage: "approved", difference: e.totalWaterIntake }) as Approval;
  const entryOn = (date: string) => useDataStore.getState().etpEntries.find((e) => e.date === date)!;

  beforeEach(() => {
    useDataStore.setState({
      industries: [{ id: "IND-1", name: "U", customColumns: [{ id: CC, name: "Softener", order: 1 }] } as never],
      readings: [], etpEntries: [], approvals: [], alerts: [], compliance: [],
    });
  });

  it("an approved next day follows, keeps its status, and its figures and note update", () => {
    filedDay("2026-10-01", 100, 150);
    const d2 = filedDay("2026-10-02", 150, 180);
    useDataStore.setState({ approvals: [approvalOf(d2)] });
    const { followed, error } = useDataStore.getState().submitEtpEntry(
      input({ status: "SUBMITTED", water: { RAW_FRESH_WATER: { initial: 100, final: 160 } }, customMeters: { [CC]: { initial: 100, final: 160 } } }),
    );
    expect(error).toBeUndefined();
    expect(followed).toEqual(["2026-10-02"]);
    const next = entryOn("2026-10-02");
    expect(next.water!.RAW_FRESH_WATER).toEqual({ initial: 160, final: 180, total: 20 });
    expect(next.customMeters![CC]).toEqual({ initial: 160, final: 180, total: 20 });
    expect(next.custom![CC]).toBe(20);
    expect(next.status).toBe("approved");
    const note = next.ledgerEdits!.at(-1)!;
    expect(note).toMatchObject({ kind: "carried", sourceDate: "2026-10-01", approvalId: `AP-${d2.id}`, approvalStage: "approved" });
    expect(note.meterChanges).toEqual([
      { field: "water.RAW_FRESH_WATER.initial", from: 150, to: 160 },
      { field: `custom.${CC}.initial`, from: 150, to: 160 },
    ]);
    expect(useDataStore.getState().approvals.find((a) => a.readingId === d2.id)!.difference).toBe(next.totalWaterIntake);
  });

  it("refuses a Final above the next filed day's Final, and writes nothing", () => {
    filedDay("2026-10-01", 100, 150);
    filedDay("2026-10-02", 150, 180);
    const before = useDataStore.getState().etpEntries;
    const { entry, error } = useDataStore.getState().submitEtpEntry(input({ status: "SUBMITTED", water: { RAW_FRESH_WATER: { initial: 100, final: 190 } }, customMeters: { [CC]: { initial: 100, final: 150 } } }));
    expect(entry).toBeNull();
    expect(error).toContain("2026-10-02");
    expect(useDataStore.getState().etpEntries).toBe(before);
  });

  it("a day saved with nothing changed moves nothing", () => {
    filedDay("2026-10-01", 100, 150);
    filedDay("2026-10-02", 150, 180);
    const { followed } = useDataStore.getState().submitEtpEntry(input({ status: "SUBMITTED", water: { RAW_FRESH_WATER: { initial: 100, final: 150 } }, customMeters: { [CC]: { initial: 100, final: 150 } } }));
    expect(followed).toEqual([]);
    expect(entryOn("2026-10-02").ledgerEdits).toBeUndefined();
  });
});
