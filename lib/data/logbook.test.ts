import { describe, it, expect } from "vitest";
import {
  applyCorrections,
  cellKey,
  computeCorrections,
  deleteLogbookPeriod,
  describeLogbookPeriod,
  expectedRevisions,
  inLogbookPeriod,
  isFiled,
  logbookPeriodSummary,
  relinkMeters,
  type LogbookContext,
} from "./logbook";
import type { Alert, Approval, EtpEntry, HwLedger, Industry } from "@/lib/types";
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

  it("keeps the manifest check; stock is no longer checked", () => {
    const noManifest = computeCorrections(chain(), "IND-1", { [cellKey("2026-10-02", "sludge.dispatch")]: "10" }, ctx());
    expect(noManifest.errors[0]).toMatchObject({ field: "sludge.manifestNo" });
    const overStock = computeCorrections(
      chain(),
      "IND-1",
      { [cellKey("2026-10-02", "sludge.dispatch")]: "99999", [cellKey("2026-10-02", "sludge.manifestNo")]: "M", [cellKey("2026-10-02", "sludge.dateOfDisposal")]: "2026-10-02" },
      ctx(),
    );
    expect(overStock.errors).toEqual([]);
    expect(by(overStock, "2026-10-02").sludge).toMatchObject({ opening: 1100, dispatch: 99999, closing: -98849 });
  });

  it("a correction that leaves a later day disposing beyond its stock is saved, that day's closing below zero", () => {
    const es = [day("2026-10-01", 100, 110, { sludge: led(1000, 100) }), day("2026-10-02", 110, 120, { sludge: led(1100, 0, 1050, { dateOfDisposal: "2026-10-02", manifestNo: "M" }) })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "sludge.generation")]: "0" }, ctx());
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").sludge).toMatchObject({ opening: 1000, dispatch: 1050, closing: -50 });
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

  it("an earlier correction and a later dispatch in the same save settle together", () => {
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

describe("computeCorrections — the chain runs through every status", () => {
  const cc = (i: number, f: number) => ({ customMeters: { "CC-A": { initial: i, final: f, total: f - i } }, custom: { "CC-A": f - i } });
  const withColumn = ctx({ industry: { roStage3: 0, roStage4: 0, customColumns: [{ id: "CC-A", name: "Softener", order: 1 }] } });

  it("a corrected custom Final reaches a following draft, as water does", () => {
    const es = [day("2026-10-01", 100, 110, cc(100, 150)), day("2026-10-02", 110, 120, { ...cc(150, 180), entryStatus: "DRAFT", status: "pending" })];
    const r = computeCorrections(es, "IND-1", { [cellKey("2026-10-01", "custom.CC-A.final")]: "155" }, withColumn);
    expect(r.errors).toEqual([]);
    expect(by(r, "2026-10-02").customMeters!["CC-A"]).toEqual({ initial: 155, final: 180, total: 25 });
    expect(by(r, "2026-10-02").custom!["CC-A"]).toBe(25);
  });

  it("a blank saved by an old draft is passed over, and the Initial it misled can be corrected", () => {
    const es = [
      day("2026-10-01", 100, 110),
      day("2026-10-02", 110, 0, { entryStatus: "DRAFT", status: "pending" }),
      day("2026-10-03", 0, 130), // inherited the false 0
    ];
    const r = computeCorrections(es, "IND-1", {}, ctx());
    expect(r.editableInitials.has(cellKey("2026-10-03", RFW_I))).toBe(true);
    const fixed = computeCorrections(es, "IND-1", { [cellKey("2026-10-03", RFW_I)]: "110" }, ctx());
    expect(fixed.errors).toEqual([]);
    expect(by(fixed, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 110, final: 130, total: 20 });
  });
});

describe("relinkMeters — the next day follows a saved day", () => {
  const setFinal = (es: EtpEntry[], date: string, final: number) =>
    es.map((e) => (e.date === date ? { ...e, water: { ...e.water, RAW_FRESH_WATER: { ...e.water!.RAW_FRESH_WATER, final, total: final - e.water!.RAW_FRESH_WATER.initial } } } : e));
  const relink = (before: EtpEntry[], after: EtpEntry[], date: string, c = ctx()) => {
    const r = relinkMeters(before, after, "IND-1", date, c);
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("a corrected Final moves the next day's Initial and total, and nothing past it", () => {
    const r = relink(chain(), setFinal(chain(), "2026-10-01", 112), "2026-10-01");
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER).toEqual({ initial: 112, final: 125, total: 13 });
    expect(by(r, "2026-10-02").totalWaterIntake).toBe(13);
    expect(by(r, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 125, final: 130, total: 5 });
    expect([...r.moved.entries()]).toEqual([["E-2026-10-02", [{ field: RFW_I, from: 110, to: 112 }]]]);
  });

  it("an unchanged Final moves nothing", () => {
    const r = relink(chain(), chain(), "2026-10-01");
    expect(r.moved.size).toBe(0);
    expect(r.entries).toEqual(chain());
  });

  it("a gap already on record is left alone", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 111, 125)];
    expect(relink(es, setFinal(es, "2026-10-01", 112), "2026-10-01").moved.size).toBe(0);
  });

  it("a backfilled day leads: the day after it follows", () => {
    const before = [day("2026-10-01", 100, 110), day("2026-10-03", 110, 130)];
    const r = relink(before, [day("2026-10-02", 110, 120), ...before], "2026-10-02");
    expect(by(r, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 120, final: 130, total: 10 });
  });

  it("a meter reset stops the link: the first day of the new sequence keeps its baseline", () => {
    const b: MeterBaseline = { meterKey: "water:RAW_FRESH_WATER", newBaseline: 0, previousReading: 110, afterDate: "2026-10-01", effectiveDate: "2026-10-02", order: 1 };
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 0, 50)];
    expect(relink(es, setFinal(es, "2026-10-01", 112), "2026-10-01", ctx({ baselines: [b] })).moved.size).toBe(0);
  });

  it("backfilling inside a new sequence moves the next day off the baseline", () => {
    const b: MeterBaseline = { meterKey: "water:RAW_FRESH_WATER", newBaseline: 0, previousReading: 110, afterDate: "2026-10-14", effectiveDate: "2026-10-15", order: 1 };
    const before = [day("2026-10-14", 100, 110), day("2026-10-17", 0, 50)];
    const r = relink(before, [day("2026-10-16", 0, 30), ...before], "2026-10-16", ctx({ baselines: [b] }));
    expect(by(r, "2026-10-17").water!.RAW_FRESH_WATER).toEqual({ initial: 30, final: 50, total: 20 });
  });

  it("a reading removed on re-save falls back to the one before it", () => {
    const after = chain().map((e) => (e.date === "2026-10-02" ? { ...e, water: {} } : e));
    const r = relink(chain(), after, "2026-10-02");
    expect(by(r, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 110, final: 130, total: 20 });
  });

  it("a first reading with nothing left to carry from keeps its stored Initial", () => {
    const before = [day("2026-10-01", 100, 150, { entryStatus: "DRAFT", status: "pending" }), day("2026-10-02", 150, 180)];
    const after = [{ ...before[0], water: {} }, before[1]];
    const r = relink(before, after, "2026-10-01");
    expect(r.moved.size).toBe(0);
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER).toEqual({ initial: 150, final: 180, total: 30 });
  });

  it("refuses when a later FILED day's Final would fall below its new Initial, naming the day and meter", () => {
    const r = relinkMeters(chain(), setFinal(chain(), "2026-10-01", 126), "IND-1", "2026-10-01", ctx());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("2026-10-02");
    expect(r.error).toContain("Raw Fresh Water");
  });

  it("a later draft just follows, even past its own Final", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 120, { entryStatus: "DRAFT", status: "pending" })];
    const r = relink(es, setFinal(es, "2026-10-01", 130), "2026-10-01");
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER).toEqual({ initial: 130, final: 120, total: -10 });
  });

  it("custom columns and electricity follow too; the custom daily figure with them", () => {
    const column = ctx({ industry: { roStage3: 0, roStage4: 0, customColumns: [{ id: "CC-A", name: "Softener", order: 1 }] } });
    const d = (date: string, i: number, f: number) =>
      day(date, 100, 100, { customMeters: { "CC-A": { initial: i, final: f, total: f - i } }, custom: { "CC-A": f - i }, energy: { ETP_POWER: { initial: i, final: f, total: f - i } } });
    const before = [d("2026-10-01", 100, 150), d("2026-10-02", 150, 180)];
    const after = [d("2026-10-01", 100, 160), before[1]];
    const r = relink(before, after, "2026-10-01", column);
    expect(by(r, "2026-10-02").customMeters!["CC-A"]).toEqual({ initial: 160, final: 180, total: 20 });
    expect(by(r, "2026-10-02").custom!["CC-A"]).toBe(20);
    expect(by(r, "2026-10-02").energy!.ETP_POWER).toEqual({ initial: 160, final: 180, total: 20 });
  });

  it("passes over a blank saved by an old draft to reach the real next reading", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 0, { entryStatus: "DRAFT", status: "pending" }), day("2026-10-03", 110, 130)];
    const r = relink(es, setFinal(es, "2026-10-01", 112), "2026-10-01");
    expect(by(r, "2026-10-03").water!.RAW_FRESH_WATER).toEqual({ initial: 112, final: 130, total: 18 });
  });

  it("leaves other units and days with no meter readings alone", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 125, { industryId: "IND-2" }), day("2026-10-03", 110, 130, { water: undefined })];
    const r = relink(es, setFinal(es, "2026-10-01", 112), "2026-10-01");
    expect(r.moved.size).toBe(0);
    expect(by(r, "2026-10-02").water!.RAW_FRESH_WATER.initial).toBe(110);
  });
});

describe("inLogbookPeriod — a period is exact", () => {
  it("matches a whole year, month or day", () => {
    expect(inLogbookPeriod("2026-10-05", "2026")).toBe(true);
    expect(inLogbookPeriod("2026-10-05", "2026-10")).toBe(true);
    expect(inLogbookPeriod("2026-10-05", "2026-10-05")).toBe(true);
    expect(inLogbookPeriod("2026-10-05", "2025")).toBe(false);
    expect(inLogbookPeriod("2026-10-05", "2026-09")).toBe(false);
    expect(inLogbookPeriod("2026-10-05", "2026-10-06")).toBe(false);
  });

  it("a partial or empty period matches nothing - never another month, never every record", () => {
    for (const bad of ["", "2026-1", "202", "2026-10-0", "2026-", "2026-10-", "abcd"]) {
      expect(inLogbookPeriod("2026-10-05", bad)).toBe(false);
    }
  });

  it("names a period in words", () => {
    expect(describeLogbookPeriod("2026")).toBe("2026");
    expect(describeLogbookPeriod("2026-08")).toBe("August 2026");
    expect(describeLogbookPeriod("2026-08-05")).toBe("5 August 2026");
  });
});

describe("deleteLogbookPeriod — removing a period's records", () => {
  const AT = "2026-11-05T10:00:00.000Z";
  const approval = (readingId: string) => ({ id: `AP-${readingId}`, readingId, industryId: "IND-1", stage: "approved", difference: 10 }) as Approval;
  const alert = (id: string, relatedReadingId: string | null, status: Alert["status"] = "active") =>
    ({ id, type: "high-flow", severity: "low", industryId: "IND-1", industryName: "X", cetpId: null, title: "t", message: "m", createdAt: AT, status, relatedReadingId }) as Alert;
  const slice = (entries = chain()) => ({
    industry: { id: "IND-1", name: "X", lastReadingAt: "2026-10-03T09:00:00.000Z", alertsCount: 3, cetpId: null } as unknown as Industry,
    readings: [],
    etpEntries: entries,
    approvals: entries.map((e) => approval(e.id)),
    alerts: [alert("AL-1", "E-2026-10-02"), alert("AL-2", null), alert("AL-3", "E-2026-10-03")],
    compliance: null,
  });
  const run = (period: string, sl = slice()) =>
    deleteLogbookPeriod(sl, "IND-1", period, { expected: logbookPeriodSummary(sl.etpEntries, "IND-1", period).expected, alertId: "AL-DEL", at: AT, byUid: "mb", byEmail: "mb@x.in" });
  const ok = (r: ReturnType<typeof run>) => {
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("removes the period's days with their approvals and alerts, and keeps the rest", () => {
    const r = ok(run("2026-10-02"));
    expect(r.slice.etpEntries.map((e) => e.date)).toEqual(["2026-10-01", "2026-10-03"]);
    expect(r.slice.approvals.map((a) => a.readingId)).toEqual(["E-2026-10-01", "E-2026-10-03"]);
    expect(r.slice.alerts.map((a) => a.id)).toEqual(["AL-DEL", "AL-2", "AL-3"]);
    expect(r.removed).toBe(1);
  });

  it("covers every status in the period, for a month or a year", () => {
    const es = [
      day("2026-09-30", 90, 100),
      day("2026-10-01", 100, 110),
      day("2026-10-02", 110, 120, { entryStatus: "DRAFT", status: "pending" }),
      day("2026-10-03", 120, 130, { status: "rejected" }),
    ];
    expect(ok(run("2026-10", slice(es))).slice.etpEntries.map((e) => e.date)).toEqual(["2026-09-30"]);
    expect(ok(run("2026", slice(es))).slice.etpEntries).toEqual([]);
  });

  it("later meter Initials stay as stored; later Sludge & Salt balances recalculate", () => {
    const es = [day("2026-10-01", 100, 110, { sludge: led(1000, 100) }), day("2026-10-02", 110, 125, { sludge: led(1100, 50) }), day("2026-10-03", 125, 130, { sludge: led(1150, 10) })];
    const r = ok(run("2026-10-02", slice(es)));
    const d3 = r.slice.etpEntries.find((e) => e.date === "2026-10-03")!;
    expect(d3.water!.RAW_FRESH_WATER).toEqual({ initial: 125, final: 130, total: 5 });
    expect(d3.sludge).toMatchObject({ opening: 1100, closing: 1110 });
    expect(r.recalculated).toBe(1);
    expect(d3.ledgerEdits!.at(-1)).toMatchObject({ kind: "carried", sourceDate: "2026-10-02" });
  });

  it("deleting the first days leaves the later balances where they are", () => {
    const r = ok(run("2026-10-01"));
    expect(r.recalculated).toBe(0);
    expect(r.slice.etpEntries[0].sludge).toMatchObject({ opening: 1100, closing: 1150 });
  });

  it("a stock count set by hand is kept when a day before it goes", () => {
    const r = ok(run("2026-10-02"));
    expect(r.slice.etpEntries.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ opening: 2000, openingManual: true });
  });

  it("tells the unit in one notice, counts included, with the officer on record but not in the text", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 120, { entryStatus: "DRAFT", status: "pending" }), day("2026-10-03", 120, 130, { status: "pending" })];
    const notice = ok(run("2026-10", slice(es))).slice.alerts[0];
    expect(notice).toMatchObject({ id: "AL-DEL", type: "disciplinary", severity: "medium", industryId: "IND-1", status: "active", createdAt: AT, byUid: "mb", byEmail: "mb@x.in" });
    expect(notice.title).toContain("October 2026");
    expect(notice.message).toContain("3 days");
    expect(notice.message).toContain("1 approved, 1 pending, 1 draft");
    expect(notice.message).not.toContain("mb@x.in");
  });

  it("recomputes the last reading and the alert count", () => {
    const r = ok(run("2026-10-03"));
    expect(r.slice.industry!.lastReadingAt).toBe("2026-10-02T09:00:00.000Z");
    expect(r.slice.industry!.alertsCount).toBe(3); // the notice, AL-1, AL-2
    expect(ok(run("2026")).slice.industry!.lastReadingAt).toBeNull();
  });

  it("never touches another unit's records", () => {
    const other = day("2026-10-02", 1, 2, { id: "E-OTHER", industryId: "IND-2" });
    const r = ok(run("2026-10", slice([...chain(), other])));
    expect(r.slice.etpEntries).toEqual([other]);
  });

  it("refuses a day filed after the confirmation", () => {
    const sl = slice();
    const { expected } = logbookPeriodSummary(sl.etpEntries.slice(0, 2), "IND-1", "2026-10");
    const r = deleteLogbookPeriod(sl, "IND-1", "2026-10", { expected, alertId: "A", at: AT, byUid: "mb" });
    expect(r).toMatchObject({ ok: false });
  });

  it("refuses a day changed, or approved, after the confirmation", () => {
    const sl = slice();
    const { expected } = logbookPeriodSummary(sl.etpEntries, "IND-1", "2026-10-02");
    const edited = { ...sl, etpEntries: sl.etpEntries.map((e) => (e.date === "2026-10-02" ? { ...e, waterRemark: "changed" } : e)) };
    const decided = { ...sl, etpEntries: sl.etpEntries.map((e) => (e.date === "2026-10-02" ? { ...e, status: "rejected" as const } : e)) };
    for (const s2 of [edited, decided]) {
      expect(deleteLogbookPeriod(s2, "IND-1", "2026-10-02", { expected, alertId: "A", at: AT, byUid: "mb" })).toMatchObject({ ok: false });
    }
  });

  it("refuses a loose period or an empty one, deleting nothing", () => {
    expect(deleteLogbookPeriod(slice(), "IND-1", "2026-1", { expected: {}, alertId: "A", at: AT, byUid: "mb" })).toMatchObject({ ok: false });
    expect(deleteLogbookPeriod(slice(), "IND-1", "", { expected: {}, alertId: "A", at: AT, byUid: "mb" })).toMatchObject({ ok: false });
    expect(deleteLogbookPeriod(slice(), "IND-1", "2025", { expected: {}, alertId: "A", at: AT, byUid: "mb" })).toMatchObject({ ok: false });
  });

  it("the summary counts by status and previews the recalculation", () => {
    const es = [day("2026-10-01", 100, 110), day("2026-10-02", 110, 120, { status: "pending", sludge: led(1100, 50) }), day("2026-10-03", 120, 130, { sludge: led(1150, 0) })];
    const s2 = logbookPeriodSummary(es, "IND-1", "2026-10-02");
    expect(s2.counts).toEqual({ approved: 0, pending: 1, draft: 0, rejected: 0 });
    expect(s2.recalculated).toBe(1);
    expect(logbookPeriodSummary(es, "IND-1", "").rows).toEqual([]);
  });
});
