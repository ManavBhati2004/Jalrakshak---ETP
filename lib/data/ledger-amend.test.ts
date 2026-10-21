import { describe, it, expect } from "vitest";
import { amendLedgers, relinkLedgers, MAX_CARRIED_RECORDS, MAX_EDIT_RECORDS, type LedgerExpectation, type LedgerInputs } from "./ledger-amend";
import type { Approval, EtpEntry, HwLedger, LedgerEdit } from "@/lib/types";

const ledger = (opening: number, generation: number, dispatch: number, extra: Partial<HwLedger> = {}): HwLedger => ({
  opening, generation, dispatch,
  dateOfDisposal: dispatch > 0 ? "2026-10-01" : "",
  manifestNo: dispatch > 0 ? "MF-1" : "",
  closing: Math.round((opening + generation - dispatch) * 100) / 100,
  remark: "",
  ...extra,
});

const day = (date: string, sludge: HwLedger, salt: HwLedger, over: Partial<EtpEntry> = {}): EtpEntry => ({
  id: `E-${date}`, industryId: "IND-1", industryName: "X", date,
  freshWaterConsumption: 0, etpInlet: 0, etpOutlet: 0, etpReuse: 0, roInlet: 0, roReject: 0, roPermeate: 0,
  sludgeToTSDF: 0, totalWaterIntake: 0, unit: "KL", status: "approved", submittedAt: `${date}T09:00:00.000Z`,
  entryStatus: "SUBMITTED",
  water: { RAW_FRESH_WATER: { initial: 0, final: 10, total: 10 } },
  sludge, salt,
  ...over,
});

const inputs = (l: HwLedger): LedgerInputs => ({ generation: l.generation, dispatch: l.dispatch, dateOfDisposal: l.dateOfDisposal, manifestNo: l.manifestNo, remark: l.remark });

/** Three consecutive days whose balances carry correctly: 100 -> 150 -> 180. */
const chain = () => [
  day("2026-10-01", ledger(0, 100, 0), ledger(0, 10, 0)),
  day("2026-10-02", ledger(100, 50, 0), ledger(10, 5, 0)),
  day("2026-10-03", ledger(150, 30, 0), ledger(15, 0, 0)),
];
const AT = "2026-10-15T10:00:00.000Z";

describe("amendLedgers — edit a filed day's Sludge & Salt", () => {
  it("changes only the ledger inputs and keeps everything else", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), generation: 40 }, salt: inputs(es[2].salt!) }, "op", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d3 = r.entries.find((e) => e.date === "2026-10-03")!;
    expect(d3.sludge).toMatchObject({ opening: 150, generation: 40, closing: 190 });
    expect(d3.status).toBe("approved"); // status untouched - your decision
    expect(d3.entryStatus).toBe("SUBMITTED");
    expect(d3.water).toEqual(es[2].water); // unrelated fields untouched
  });

  it("works on an approved day, which the old flow could only change by re-submitting everything", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), remark: "corrected weighbridge slip" }, salt: inputs(es[1].salt!) }, "op", AT);
    expect(r.ok && r.changed).toBe(true);
  });

  it("carries a changed closing forward through every later day", () => {
    const es = chain();
    // Day 1 generation 100 -> 120: closing +20, so day 2 and day 3 openings/closings move by 20.
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = (d: string) => r.entries.find((e) => e.date === d)!.sludge!;
    expect(by("2026-10-01")).toMatchObject({ opening: 0, closing: 120 });
    expect(by("2026-10-02")).toMatchObject({ opening: 120, closing: 170 });
    expect(by("2026-10-03")).toMatchObject({ opening: 170, closing: 200 });
    // salt was not changed, so it does not move
    expect(r.entries.find((e) => e.date === "2026-10-03")!.salt).toMatchObject({ opening: 15, closing: 15 });
    expect(r.editedDates).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("repeated saves of the same values do not double-count and record nothing", () => {
    const es = chain();
    const change = { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) };
    const once = amendLedgers(es, "IND-1", "2026-10-01", change, "op", AT);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = amendLedgers(once.entries, "IND-1", "2026-10-01", change, "op", "2026-10-15T11:00:00.000Z");
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.changed).toBe(false);
    expect(twice.entries.find((e) => e.date === "2026-10-03")!.sludge!.closing).toBe(200); // not 220
    expect(twice.entries.find((e) => e.date === "2026-10-01")!.ledgerEdits).toHaveLength(1);
  });

  it("persists a genuine zero", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), generation: 0 }, salt: inputs(es[2].salt!) }, "op", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ generation: 0, closing: 150 });
  });

  it("refuses a change that would make a LATER day's dispatch exceed its stock, naming the day", () => {
    const es = [
      day("2026-10-01", ledger(0, 100, 0), ledger(0, 0, 0)),
      day("2026-10-02", ledger(100, 0, 90), ledger(0, 0, 0)), // dispatches 90 of the 100 carried in
    ];
    // Cutting day 1 generation to 50 would leave only 50 in stock on day 2 against a 90 dispatch.
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 50 }, salt: inputs(es[0].salt!) }, "op", AT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("2026-10-02");
  });

  it("keeps the existing validation: dispatch needs a manifest and a disposal date", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), dispatch: 10, manifestNo: "", dateOfDisposal: "" }, salt: inputs(es[2].salt!) }, "op", AT);
    expect(r.ok).toBe(false);
  });

  it("keeps the existing validation: dispatch cannot exceed opening + generation", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), dispatch: 999, manifestNo: "MF", dateOfDisposal: "2026-10-03" }, salt: inputs(es[2].salt!) }, "op", AT);
    expect(r.ok).toBe(false);
  });

  it("rejects negative, non-finite and over-precise quantities", () => {
    const es = chain();
    const bad = (generation: number) => amendLedgers(es, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), generation }, salt: inputs(es[2].salt!) }, "op", AT).ok;
    expect(bad(-1)).toBe(false);
    expect(bad(Number.NaN)).toBe(false);
    expect(bad(Number.POSITIVE_INFINITY)).toBe(false);
    expect(bad(1.234)).toBe(false);
    expect(bad(1.23)).toBe(true);
  });

  it("refuses when the day has no entry, rather than inventing one", () => {
    const r = amendLedgers(chain(), "IND-1", "2026-10-09", { sludge: inputs(ledger(0, 1, 0)), salt: inputs(ledger(0, 0, 0)) }, "op", AT);
    expect(r.ok).toBe(false);
  });

  it("never touches another unit's chain", () => {
    const es = [...chain(), day("2026-10-02", ledger(0, 5, 0), ledger(0, 0, 0), { id: "E-OTHER", industryId: "IND-2" })];
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.find((e) => e.id === "E-OTHER")!.sludge).toMatchObject({ opening: 0, closing: 5 });
  });

  it("records an audit trail: the edit on the day, and a carried note on days that moved", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op-uid", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const edit = r.entries.find((e) => e.date === "2026-10-01")!.ledgerEdits!;
    expect(edit).toEqual([
      { at: AT, byUid: "op-uid", kind: "edit", changes: [{ ledger: "sludge", field: "generation", from: 100, to: 120 }] },
    ]);
    // later days get a compact marker naming the source; the figures are on the source day's record
    const carried = r.entries.find((e) => e.date === "2026-10-02")!.ledgerEdits!;
    expect(carried).toEqual([{ at: AT, byUid: "op-uid", kind: "carried", sourceDate: "2026-10-01" }]);
  });

  it("preserves array order so the slice re-serialises in the same shape", () => {
    const es = chain().reverse(); // stored order need not be date order
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[2].sludge!), generation: 120 }, salt: inputs(es[2].salt!) }, "op", AT);
    expect(r.ok && r.entries.map((e) => e.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01"]);
  });
});

/** What the form loaded for a day: the stored ledgers, untouched. */
const loaded = (e: EtpEntry): LedgerExpectation => ({ entryId: e.id, sludge: e.sludge ?? null, salt: e.salt ?? null });

describe("amendLedgers — no lost updates", () => {
  it("refuses when the stored day changed after the form loaded it", () => {
    const es = chain();
    const seen = loaded(es[1]);
    // another device saved a different generation for the same day in the meantime
    const server = es.map((e) => (e.id === es[1].id ? { ...e, sludge: ledger(100, 60, 0) } : e));
    const r = amendLedgers(server, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), generation: 70 }, salt: inputs(es[1].salt!) }, "op", AT, { expected: seen });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/changed elsewhere/);
  });

  it("refuses when the day's opening moved under it (an earlier day was amended elsewhere)", () => {
    const es = chain();
    const seen = loaded(es[2]);
    const server = es.map((e) => (e.id === es[2].id ? { ...e, sludge: ledger(170, 30, 0) } : e));
    const r = amendLedgers(server, "IND-1", "2026-10-03", { sludge: { ...inputs(es[2].sludge!), generation: 31 }, salt: inputs(es[2].salt!) }, "op", AT, { expected: seen });
    expect(r.ok).toBe(false);
  });

  it("accepts the save when the stored day is exactly what was loaded", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), generation: 70 }, salt: inputs(es[1].salt!) }, "op", AT, { expected: loaded(es[1]) });
    expect(r.ok && r.changed).toBe(true);
  });

  it("re-saving values that are already stored is a no-op, even from an older form", () => {
    const es = chain();
    const stale = loaded(es[1]);
    const first = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), generation: 70 }, salt: inputs(es[1].salt!) }, "op", AT, { expected: stale });
    if (!first.ok) throw new Error(first.error);
    const again = amendLedgers(first.entries, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), generation: 70 }, salt: inputs(es[1].salt!) }, "op", AT, { expected: stale });
    expect(again).toMatchObject({ ok: true, changed: false });
  });
});

describe("amendLedgers — the audit trail stays exact and bounded", () => {
  const approval = (id: string, readingId: string, stage: Approval["stage"]): Approval => ({
    id, readingId, industryId: "IND-1", industryName: "X", cetpId: null, meterPoint: "ETP Water Balance",
    difference: 0, unit: "KL", hasPhoto: true, remarks: "", stage, submittedAt: "2026-10-01T09:00:00.000Z",
    reviewedAt: stage === "approved" ? "2026-10-02T09:00:00.000Z" : null, reviewer: null, alerts: [], timeline: [],
  });

  it("stamps each record with the approval the day was under, so 'after approval' needs no clock", () => {
    const es = chain();
    const approvals = [approval("A-1", "E-2026-10-01", "approved"), approval("A-2", "E-2026-10-02", "submitted")];
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT, { approvals });
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.find((e) => e.date === "2026-10-01")!.ledgerEdits!.at(-1)).toMatchObject({ kind: "edit", approvalId: "A-1", approvalStage: "approved" });
    expect(r.entries.find((e) => e.date === "2026-10-02")!.ledgerEdits!.at(-1)).toMatchObject({ kind: "carried", approvalId: "A-2", approvalStage: "submitted" });
    // a day with no approval (no entry in the queue) is stamped with nothing
    expect(r.entries.find((e) => e.date === "2026-10-03")!.ledgerEdits!.at(-1)).not.toHaveProperty("approvalId");
  });

  it("collapses repeated recalculations from the same source day into one marker", () => {
    let es = chain();
    for (const g of [120, 130, 140]) {
      const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: g }, salt: inputs(es[0].salt!) }, "op", AT);
      if (!r.ok) throw new Error(r.error);
      es = r.entries;
    }
    expect(es.find((e) => e.date === "2026-10-01")!.ledgerEdits).toHaveLength(3); // every real edit is kept
    expect(es.find((e) => e.date === "2026-10-03")!.ledgerEdits).toHaveLength(1); // one marker per source
    expect(es.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ opening: 190, closing: 220 });
  });

  it("caps each kind of record, dropping the oldest first", () => {
    const old = (n: number, kind: LedgerEdit["kind"]): LedgerEdit =>
      kind === "edit" ? { at: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`, byUid: "op", kind, changes: [] } : { at: "2026-01-01T00:00:00.000Z", byUid: "op", kind, sourceDate: `2025-01-${String((n % 28) + 1).padStart(2, "0")}-${n}` };
    const full = [
      ...Array.from({ length: MAX_EDIT_RECORDS }, (_, n) => old(n, "edit")),
      ...Array.from({ length: MAX_CARRIED_RECORDS }, (_, n) => old(n, "carried")),
    ];
    const es = chain().map((e) => (e.date === "2026-10-01" || e.date === "2026-10-02" ? { ...e, ledgerEdits: full } : e));
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    const d1 = r.entries.find((e) => e.date === "2026-10-01")!.ledgerEdits!;
    expect(d1.filter((x) => x.kind === "edit")).toHaveLength(MAX_EDIT_RECORDS);
    expect(d1.at(-1)).toMatchObject({ at: AT, kind: "edit" }); // the newest survives
    expect(d1.some((x) => x.at === "2026-01-01T00:00:00.000Z" && x.kind === "edit")).toBe(false); // the oldest went
    const d2 = r.entries.find((e) => e.date === "2026-10-02")!.ledgerEdits!;
    expect(d2.filter((x) => x.kind === "carried")).toHaveLength(MAX_CARRIED_RECORDS);
    expect(d2.at(-1)).toMatchObject({ kind: "carried", sourceDate: "2026-10-01" });
  });
});

describe("opening balance editable on any day", () => {
  it("an opening typed on a mid-month day is kept, recorded, and later carried days follow it", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), opening: 130 }, salt: inputs(es[1].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    const by = (d: string) => r.entries.find((e) => e.date === d)!.sludge!;
    expect(by("2026-10-02")).toMatchObject({ opening: 130, closing: 180 });
    expect(by("2026-10-03")).toMatchObject({ opening: 180, closing: 210 });
    expect(by("2026-10-01")).toMatchObject({ opening: 0, closing: 100 }); // earlier days never move
    expect(r.entries.find((e) => e.date === "2026-10-02")!.ledgerEdits!.at(-1)!.changes).toEqual([
      { ledger: "sludge", field: "opening", from: 100, to: 130 },
    ]);
  });

  it("an opening that was set by hand on a later day is kept when an earlier day changes", () => {
    const es = chain().map((e) => (e.date === "2026-10-03" ? { ...e, sludge: { ...ledger(500, 30, 0), openingManual: true } } : e)); // a stock count
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.find((e) => e.date === "2026-10-02")!.sludge).toMatchObject({ opening: 120, closing: 170 });
    expect(r.entries.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ opening: 500, closing: 530 });
    expect(r.editedDates).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("refuses an invalid opening", () => {
    const es = chain();
    for (const opening of [-1, 1.234, Number.NaN]) {
      const r = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), opening }, salt: inputs(es[1].salt!) }, "op", AT);
      expect(r.ok).toBe(false);
    }
  });
});

describe("relinkLedgers — a backfilled day joins the chain", () => {
  it("later days that carried from the day before the gap now carry from the new day", () => {
    // 1st and 3rd filed; the 3rd carried the 1st's closing (100). The 2nd is backfilled with 40 more.
    const before = [day("2026-10-01", ledger(0, 100, 0), ledger(0, 0, 0)), day("2026-10-03", ledger(100, 10, 0), ledger(0, 0, 0))];
    const second = day("2026-10-02", ledger(100, 40, 0), ledger(0, 0, 0));
    const r = relinkLedgers(before, [second, ...before], "IND-1", new Set([`${second.id}:sludge`, `${second.id}:salt`]));
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ opening: 140, closing: 150 });
    expect([...r.moved]).toEqual(["E-2026-10-03"]);
  });
});

describe("relinkLedgers — review fixes", () => {
  it("a small difference already on record is kept, and the correction still carries through it", () => {
    // Imported data: the 3rd opens 0.1 kg above the 2nd's closing (150). Not a hand-set anchor.
    const es = chain().map((e) => (e.date === "2026-10-03" ? { ...e, sludge: ledger(150.1, 30, 0) } : e));
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 200 }, salt: inputs(es[0].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    const d3 = r.entries.find((e) => e.date === "2026-10-03")!.sludge!;
    expect(d3.opening).toBe(250.1); // +100 like every other day, the 0.1 kept
    expect(d3.closing).toBe(280.1);
  });

  it("a draft's figures never move a later filed day, though the draft itself follows", () => {
    const before = [
      day("2026-10-01", ledger(0, 100, 0), ledger(0, 0, 0)),
      day("2026-10-03", ledger(100, 10, 0), ledger(0, 0, 0)),
    ];
    const draft = day("2026-10-02", ledger(100, 50, 0), ledger(0, 0, 0), { entryStatus: "DRAFT", status: "pending" });
    const saved = relinkLedgers(before, [draft, ...before], "IND-1", new Set([`${draft.id}:sludge`, `${draft.id}:salt`]));
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.entries.find((e) => e.date === "2026-10-03")!.sludge!.opening).toBe(100); // untouched
    // once the draft is submitted, the 3rd follows it
    const submitted = { ...draft, entryStatus: "SUBMITTED" as const };
    const after = relinkLedgers(saved.entries, saved.entries.map((e) => (e.id === draft.id ? submitted : e)), "IND-1", new Set([`${draft.id}:sludge`, `${draft.id}:salt`]));
    if (!after.ok) throw new Error(after.error);
    expect(after.entries.find((e) => e.date === "2026-10-03")!.sludge).toMatchObject({ opening: 150, closing: 160 });
  });

  it("a later draft follows an earlier correction", () => {
    const es = [...chain().slice(0, 2), day("2026-10-03", ledger(150, 30, 0), ledger(15, 0, 0), { entryStatus: "DRAFT", status: "pending" })];
    const r = amendLedgers(es, "IND-1", "2026-10-01", { sludge: { ...inputs(es[0].sludge!), generation: 120 }, salt: inputs(es[0].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.find((e) => e.date === "2026-10-03")!.sludge!.opening).toBe(170);
  });

  it("marks a typed opening as hand-set, and a large running balance is allowed", () => {
    const es = chain();
    const r = amendLedgers(es, "IND-1", "2026-10-02", { sludge: { ...inputs(es[1].sludge!), opening: 12345678.5, openingManual: true }, salt: inputs(es[1].salt!) }, "op", AT);
    if (!r.ok) throw new Error(r.error);
    expect(r.entries.find((e) => e.date === "2026-10-02")!.sludge).toMatchObject({ opening: 12345678.5, openingManual: true });
  });
});
