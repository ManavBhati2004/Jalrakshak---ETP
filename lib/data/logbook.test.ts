import { describe, it, expect } from "vitest";
import { applyCorrections, cellKey, computeCorrections, expectedRevisions, isFiled, type LogbookContext } from "./logbook";
import type { Approval, EtpEntry, HwLedger } from "@/lib/types";
import type { MeterBaseline } from "./etp-calc";

const led = (opening: number, generation: number, dispatch = 0, extra: Partial<HwLedger> = {}): HwLedger => ({
  opening, generation, dispatch,
  dateOfDisposal: dispatch > 0 ? "2026-10-01" : "",
  manifestNo: dispatch > 0 ? "MF-1" : "",
  closing: Math.round((opening + generation - dispatch) * 100) / 100,
  remark: "",
  ...extra,
});

/** A submitted, approved day with Raw Fresh Water i->f, ETP power, and both ledgers. */
const day = (date: string, i: number, f: number, over: Partial<EtpEntry> = {}): EtpEntry => ({
  id: `E-${date}`, industryId: "IND-1", industryName: "X", date,
  freshWaterConsumption: f - i, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
  sludgeToTSDF: 0, totalWaterIntake: f - i, unit: "KL", status: "approved", submittedAt: `${date}T09:00:00.000Z`,
  entryStatus: "SUBMITTED",
  water: { RAW_FRESH_WATER: { initial: i, final: f, total: f - i } },
  energy: { ETP_POWER: { initial: 0, final: 5, total: 5 } },
  sludge: led(1000, 100),
  salt: led(10, 1),
  ...over,
});

/** 1 -> 3 Oct: RFW 100->110->125->130, sludge 1000 -> 1100 -> 1150, then a hand-set opening 2000 (a stock count). */
const chain = () => [
  day("2026-10-01", 100, 110, { sludge: led(1000, 100) }),
  day("2026-10-02", 110, 125, { sludge: led(1100, 50) }),
  day("2026-10-03", 125, 130, { sludge: { ...led(2000, 0), openingManual: true } }),
];
const ctx = (over: Partial<LogbookContext> = {}): LogbookContext => ({ industry: { roStage3: 0, roStage4: 0, customColumns: [] }, baselines: [], ...over });
const RFW_I = "water.RAW_FRESH_WATER.initial";
const RFW_F = "water.RAW_FRESH_WATER.final";
const by = (r: { entries: EtpEntry[] }, date: string) => r.entries.find((e) => e.date === date)!;

describe("computeCorrections — meters", () => {
  it("a corrected Final carries into the next day's Initial; both days' totals are recomputed", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-01", RFW_F)]: "112" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-01").water!.RAW_FRESH_WATER).toEqual({ initial: 100, final: 112, total: 12 });
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER).toEqual({ initial: 112, final: 125, total: 13 });
    expect(by(r, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 125, final: 130, total: 5 }); // untouched
    // derived figures recomputed through the same code Submit uses
    expect(by(r, "2026-10-01").freshWaterConsumption).toBe(12);
    expect(by(r, "2026-10-02").totalWaterIntake).toBe(13);
    expect(r.carriedOnly).toEqual(new Set(["E-2026-10-02"])); // the 2nd moved only by carrying
  });

  it("a Monitoring-Body baseline between the days stops the carry", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 0, 120)];
    const b: MeterBaseline = { meterKey: "water:RAW_FRESH_WATER", newBaseline: 0, previousReading: 110, afterDate: "2026-10-01", effectiveDate: "2026-10-02", order: 1 };
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "111" }, ctx({ baselines: [b] }));
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER.initial).toBe(0);
    expect(r.editableInitials.has(cellKey("2026-10-02", RFW_I))).toBe(true); // a sequence start
  });

  it("an Initial that already differed from the previous Final is kept, and offered for editing", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 999, 1005)];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "112" }, ctx());
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER.initial).toBe(999);
    expect(r.editableInitials.has(cellKey("2026-10-02", RFW_I))).toBe(true);
    expect(r.editableInitials.has(cellKey("2026-10-01", RFW_I))).toBe(true); // first reading
  });

  it("a carried Initial cannot be typed - correct the previous Final instead", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", RFW_I)]: "111" }, ctx());
    expect(r.errors[0]).toMatchObject({ date: "2026-10-02", field: RFW_I });
  });

  it("refuses a Final below its Initial, at that cell", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", RFW_F)]: "90" }, ctx());
    expect(r.errors).toEqual([expect.objectContaining({ date: "2026-10-02", field: RFW_F })]);
  });

  it("refuses bad numbers with the numeric standard's reasons", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-01", RFW_F)]: "1.234", [cellKey("2026-10-02", RFW_F)]: "abc" }, ctx());
    expect(r.errors.map((e) => e.message)).toEqual(["At most 2 decimal places.", "Not a number."]);
  });

  it("a required meter cannot be blanked; an optional RO 3rd & 4th stage meter can", () => {
    const es = [day("2026-10-01", 100, 110, { water: { RAW_FRESH_WATER: { initial: 100, final: 110, total: 10 }, RO_PERMEATE_3_4: { initial: 5, final: 7, total: 2 } } })];
    const blankRfw = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "" }, ctx());
    expect(blankRfw.errors[0]).toMatchObject({ field: RFW_F, message: "A reading is required for this meter." });
    const cleared = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "water.RO_PERMEATE_3_4.final")]: "" }, ctx());
    expect(cleared.errors).toEqual([]);
    expect(by(cleared, "2026-10-01").water!.RO_PERMEATE_3_4).toBeUndefined();
    // with RO Stage III/IV capacity registered the separate meter is mandatory
    const mandatory = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "water.RO_PERMEATE_3_4.final")]: "" }, ctx({ industry: { roStage3: 50, roStage4: 0 } }));
    expect(mandatory.errors).toHaveLength(1);
  });

  it("a custom column can be cleared and its daily total becomes blank, never 0", () => {
    const es = [day("2026-10-01", 100, 110, { customMeters: { "CC-A": { initial: 1, final: 4, total: 3 } }, custom: { "CC-A": 3 } })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "custom.CC-A.final")]: "" }, ctx({ industry: { customColumns: [{ id: "CC-A", name: "Boiler", order: 0 }] } }));
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-01").customMeters?.["CC-A"]).toBeUndefined();
    expect(by(r, "2026-10-01").custom?.["CC-A"]).toBeNull();
  });

  it("drafts and rejected days are not correctable", () => {
    const es = [day("2026-10-01", 100, 110, { entryStatus: "DRAFT", status: "pending" }), day("2026-10-02", 110, 120, { status: "rejected" })];
    expect(es.filter(isFiled)).toHaveLength(0);
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "111", [cellKey("2026-10-02", RFW_F)]: "121" }, ctx());
    expect(r.errors.map((e) => e.message)).toEqual(["This day has no submitted entry to correct.", "This day has no submitted entry to correct."]);
    expect(r.changes.size).toBe(0);
  });

  it("never touches another unit", () => {
    const es = [...chain(), day("2026-10-01", 1, 2, { id: "E-OTHER", industryId: "IND-2" })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "112" }, ctx());
    expect(r.entries.find((e) => e.id === "E-OTHER")).toBe(es[3]);
  });
});

describe("computeCorrections — Sludge & Salt", () => {
  it("a generation correction carries forward until an opening that was set by hand", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-01", "sludge.generation")]: "120" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-01").sludge).toMatchObject({ opening: 1000, generation: 120, closing: 1120 });
    expect(by(r, "2026-10-02").sludge).toMatchObject({ opening: 1120, closing: 1170 }); // was carried: follows
    expect(by(r, "2026-10-03").sludge).toMatchObject({ opening: 2000, closing: 2000 }); // set by hand: kept
  });

  it("a corrected opening is kept and carries on from there", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", "sludge.opening")]: "1500" }, ctx());
    expect(by(r, "2026-10-02").sludge).toMatchObject({ opening: 1500, closing: 1550 });
    expect(by(r, "2026-10-03").sludge!.opening).toBe(2000);
  });

  it("keeps the existing ledger checks", () => {
    const noManifest = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", "sludge.dispatch")]: "10" }, ctx());
    expect(noManifest.errors[0]).toMatchObject({ field: "sludge.manifestNo" });
    const overStock = computeCorrections(
      chain(),
      "IND-1",
      { [cellKey("2026-10-02", "sludge.dispatch")]: "99999", [cellKey("2026-10-02", "sludge.manifestNo")]: "M", [cellKey("2026-10-02", "sludge.dateOfDisposal")]: "2026-10-02" },
      ctx(),
    );
    expect(overStock.errors.some((e) => e.field === "sludge.dispatch")).toBe(true);
  });

  it("refuses a correction that would break a later day, naming it", () => {
    const es = [day("2026-10-01", 100, 110, { sludge: led(1000, 100) }), day("2026-10-02", 110, 120, { sludge: led(1100, 0, 1050, { dateOfDisposal: "2026-10-02", manifestNo: "M" }) })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "sludge.generation")]: "0" }, ctx());
    expect(r.errors[0].message).toContain("2026-10-02");
  });
});

describe("applyCorrections — the saving step", () => {
  const approval = (id: string, readingId: string): Approval => ({
    id, readingId, industryId: "IND-1", industryName: "X", cetpId: null, meterPoint: "ETP Water Balance",
    difference: 10, unit: "KL", hasPhoto: true, remarks: "", stage: "approved",
    submittedAt: "2026-10-01T09:00:00.000Z", reviewedAt: "2026-10-01T10:00:00.000Z", reviewer: "Monitoring Body", alerts: [], timeline: [],
  });
  const AT = "2026-10-21T10:00:00.000Z";

  it("records who changed what, keeps the status, and updates the approval's figure", () => {
    const es = chain();
    const edits = { [cellKey("2026-10-01", RFW_F)]: "112" };
    const preview = computeCorrections(es, "IND-1", edits, ctx());
    const res = applyCorrections({ etpEntries: es, approvals: [approval("A-1", "E-2026-10-01")] }, "IND-1", edits, ctx(), {
      expected: expectedRevisions(es, preview), byUid: "mb", byEmail: "mb@x.in", at: AT,
    });
    if (!res.ok) throw new Error(res.error);
    const d1 = res.etpEntries.find((e) => e.date === "2026-10-01")!;
    const d2 = res.etpEntries.find((e) => e.date === "2026-10-02")!;
    expect(d1.status).toBe("approved");
    expect(d1.corrections).toEqual([
      {
        at: AT, byUid: "mb", byEmail: "mb@x.in", approvalId: "A-1", approvalStage: "approved",
        changes: [{ field: RFW_F, from: 110, to: 112 }],
      },
    ]);
    expect(d2.corrections?.[0]).toMatchObject({ carried: true, changes: [] }); // compact: explained by the 1st's record
    expect(res.approvals[0].difference).toBe(12);
    expect(res.corrected).toBe(2);
  });

  it("refuses when an affected day changed after the sheet was opened", () => {
    const es = chain();
    const edits = { [cellKey("2026-10-01", RFW_F)]: "112" };
    const expected = expectedRevisions(es, computeCorrections(es, "IND-1", edits, ctx()));
    // the ETP re-files the 2nd meanwhile
    const moved = es.map((e) => (e.date === "2026-10-02" ? { ...e, waterRemark: "re-filed" } : e));
    const res = applyCorrections({ etpEntries: moved, approvals: [] }, "IND-1", edits, ctx(), { expected, byUid: "mb", at: AT });
    expect(res.ok).toBe(false);
  });

  it("refuses invalid cells, and saving nothing changes nothing", () => {
    const es = chain();
    const bad = applyCorrections({ etpEntries: es, approvals: [] }, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "-1" }, ctx(), { expected: {}, byUid: "mb", at: AT });
    expect(bad.ok).toBe(false);
    const same = applyCorrections({ etpEntries: es, approvals: [] }, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "110" }, ctx(), { expected: {}, byUid: "mb", at: AT });
    expect(same).toMatchObject({ ok: true, corrected: 0 });
  });
});

describe("review fixes", () => {
  it("a corrected Final also reaches a following DRAFT, so its locked Initial never strands the operator", () => {
    const es = [day("2026-10-01", 1000, 1500), day("2026-10-02", 1500, 1500, { entryStatus: "DRAFT", status: "pending" })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "1050" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER.initial).toBe(1050);
    expect(r.carriedOnly.has("E-2026-10-02")).toBe(true);
    expect(r.editableInitials.has(cellKey("2026-10-02", RFW_I))).toBe(false); // drafts are not edited here
  });

  it("a correction that overtakes a following draft's Final is not refused - the operator fixes their draft", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 111, { entryStatus: "DRAFT", status: "pending" })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "112" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER).toMatchObject({ initial: 112, final: 111 });
    // ...but on a FILED following day the officer is told, at that day's Final
    const filed = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 111)];
    expect(computeCorrections(filed, "IND-1", { [cellKey("2026-10-01", RFW_F)]: "112" }, ctx()).errors[0]).toMatchObject({ date: "2026-10-02", field: RFW_F });
  });

  it("checks stock only after the chain settles: a raised opening can cover a bigger dispatch", () => {
    const r = computeCorrections(
      chain(),
      "IND-1",
      {
        [cellKey("2026-10-01", "sludge.generation")]: "300", // the 2nd's opening becomes 1300
        [cellKey("2026-10-02", "sludge.dispatch")]: "1200",
        [cellKey("2026-10-02", "sludge.manifestNo")]: "M-1",
        [cellKey("2026-10-02", "sludge.dateOfDisposal")]: "2026-10-02",
      },
      ctx(),
    );
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").sludge).toMatchObject({ opening: 1300, dispatch: 1200, closing: 150 });
  });

  it("a typed opening is marked as hand-set, and may exceed the 7-digit daily ceiling", () => {
    const r = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", "sludge.opening")]: "12345678.25" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").sludge).toMatchObject({ opening: 12345678.25, openingManual: true });
  });

  it("entries filed before drafts existed (no entryStatus) are correctable", () => {
    const legacy = day("2026-10-01", 100, 110);
    delete (legacy as Partial<EtpEntry>).entryStatus;
    const r = computeCorrections([legacy], "IND-1", { [cellKey("2026-10-01", RFW_F)]: "111" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-01").water!.RAW_FRESH_WATER.final).toBe(111);
  });
});

describe("applyCorrections — review fixes", () => {
  const AT2 = "2026-10-21T12:00:00.000Z";
  it("a confirmed day the ETP changed meanwhile refuses the save even when it would no longer be touched", () => {
    const es = chain();
    const edits = { [cellKey("2026-10-01", RFW_F)]: "112" };
    const expected = expectedRevisions(es, computeCorrections(es, "IND-1", edits, ctx()));
    // the ETP re-files the 2nd with its own Initial: the correction would no longer carry into it
    const moved = es.map((e) => (e.date === "2026-10-02" ? { ...e, water: { RAW_FRESH_WATER: { initial: 111, final: 125, total: 14 } } } : e));
    const res = applyCorrections({ etpEntries: moved, approvals: [] }, "IND-1", edits, ctx(), { expected, byUid: "mb", at: AT2 });
    expect(res.ok).toBe(false);
  });

  it("a day that only moved keeps a single compact marker, however many corrections reach it", () => {
    let es = chain();
    for (const v of ["112", "113", "114"]) {
      const edits = { [cellKey("2026-10-01", RFW_F)]: v };
      const res = applyCorrections({ etpEntries: es, approvals: [] }, "IND-1", edits, ctx(), {
        expected: expectedRevisions(es, computeCorrections(es, "IND-1", edits, ctx())),
        byUid: "mb",
        at: AT2,
      });
      if (!res.ok) throw new Error(res.error);
      es = res.etpEntries;
    }
    expect(es.find((e) => e.date === "2026-10-01")!.corrections).toHaveLength(3); // every direct correction kept
    expect(es.find((e) => e.date === "2026-10-02")!.corrections).toHaveLength(1); // one marker
    expect(es.find((e) => e.date === "2026-10-02")!.water!.RAW_FRESH_WATER.initial).toBe(114);
  });
});
