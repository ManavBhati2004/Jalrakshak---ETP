/* ============================================================
   Monitoring-Body Logbook — pure, Firebase-free, unit-testable.

   The regulator's Excel-like sheet: one row per day of a month for one unit, every reading the
   unit submitted, correctable by the Monitoring Body. A correction is applied to the unit's whole
   entry list so its effects carry exactly as the operator's own form would carry them:
   - a corrected Final is the same meter reading as the next submitted day's Initial, so that
     Initial follows it (when it was carried) and both days' totals are recomputed;
   - a corrected Sludge & Salt figure carries its closing forward (`relinkLedgers`), keeping any
     opening that was set by hand.
   Every derived figure goes through the same code Save/Submit uses (`deriveWaterFigures`,
   `toMeterReading`, `closingBalance`), so a corrected day can never disagree with a filed one.
   ============================================================ */

import type { Approval, CorrectionChange, EntryCorrection, EtpEntry, HwLedger, Industry, MeterReading } from "@/lib/types";
import { ENERGY_METERS, WATER_METERS } from "@/lib/constants";
import {
  baselineAwareInitial,
  closingBalance,
  deriveWaterFigures,
  dispatchNeedsManifest,
  isFiledEntry,
  isOptionalWaterMeter,
  meterKeyOf,
  parseDailyValue,
  round2,
  toMeterReading,
  type MeterBaseline,
  type NumericError,
} from "@/lib/data/etp-calc";
import { MAX_BALANCE, relinkLedgers, type LedgerName } from "@/lib/data/ledger-amend";
import { entryRevision } from "@/lib/data/approval-decisions";

export type MeterKind = "water" | "energy" | "custom";
export const LEDGER_FIELDS = ["opening", "generation", "dispatch", "dateOfDisposal", "manifestNo", "remark"] as const;
export type LedgerField = (typeof LEDGER_FIELDS)[number];
const NUMERIC_LEDGER_FIELDS: readonly LedgerField[] = ["opening", "generation", "dispatch"];
const LEDGERS: readonly LedgerName[] = ["sludge", "salt"];

/** Cells the Monitoring Body typed into: `cellKey(date, field)` → the raw text. */
export type LogbookEdits = Readonly<Record<string, string>>;
export const cellKey = (date: string, field: string) => `${date}|${field}`;
export const meterField = (kind: MeterKind, code: string, part: "initial" | "final") => `${kind}.${code}.${part}`;
export const ledgerField = (ledger: LedgerName, field: LedgerField | "closing") => `${ledger}.${field}`;
const splitKey = (key: string): [string, string] => {
  const i = key.indexOf("|");
  return [key.slice(0, i), key.slice(i + 1)];
};

/**
 * Direct correction records kept per entry - bounded like the other audit trails. A day that only
 * moved because an earlier correction carried into it keeps ONE compact marker (the latest), so a
 * correction early in a long chain cannot flood every later day's record.
 */
export const MAX_CORRECTION_RECORDS = 30;

/**
 * The days the Monitoring Body may correct: filed, i.e. not a draft and not rejected - the same
 * definition the monthly return and the carry-forward rule use (`isFiledEntry`).
 */
export function isFiled(e: EtpEntry): boolean {
  return isFiledEntry(e);
}

/** A stock balance as typed: like the daily standard, but a running balance may exceed 7 digits. */
function parseBalance(raw: string): { value: number | null; error?: NumericError } {
  const t = raw.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === "." ) return { value: null, error: "NOT_NUMERIC" };
  const [int = "", dec = ""] = t.split(".");
  if (dec.length > 2) return { value: null, error: "TOO_MANY_DECIMALS" };
  const v = Number(t);
  if (!Number.isFinite(v) || int.length > 10 || v > MAX_BALANCE) return { value: null, error: "VALUE_OUT_OF_RANGE" };
  return { value: round2(v) };
}

export interface LogbookContext {
  industry: Pick<Industry, "roStage3" | "roStage4" | "customColumns">;
  baselines: readonly MeterBaseline[];
}

export interface CellError {
  date: string;
  field: string;
  message: string;
}

export interface CorrectionOutcome {
  /** Every entry (all units), original order, with the corrections applied. */
  entries: EtpEntry[];
  /** Field-level changes per corrected entry id (only entries that actually changed). */
  changes: Map<string, CorrectionChange[]>;
  /** Corrected entries that changed only because a corrected value carried into them. */
  carriedOnly: Set<string>;
  errors: CellError[];
  /**
   * Initial cells the sheet may offer for editing: where a meter's sequence starts (its first
   * reading, or a Monitoring-Body reset/resume), or where the stored Initial already differs from the
   * previous Final. Everywhere else the Initial follows the previous Final and is not typed.
   */
  editableInitials: Set<string>;
}

const NUMERIC_MESSAGE: Record<NumericError, string> = {
  NOT_NUMERIC: "Not a number.",
  NEGATIVE: "Cannot be negative.",
  TOO_MANY_DECIMALS: "At most 2 decimal places.",
  VALUE_OUT_OF_RANGE: "Above the allowed maximum.",
};

const byDate = (a: EtpEntry, b: EtpEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

function isRealDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function readingOf(e: EtpEntry | undefined, kind: MeterKind, code: string): MeterReading | undefined {
  if (!e) return undefined;
  if (kind === "water") return e.water?.[code];
  if (kind === "energy") return e.energy?.[code];
  return e.customMeters?.[code];
}

function withReading(e: EtpEntry, kind: MeterKind, code: string, r: MeterReading | null): EtpEntry {
  if (kind === "custom") {
    const customMeters = { ...(e.customMeters ?? {}) };
    if (r) customMeters[code] = r;
    else delete customMeters[code];
    // The custom scalar is the derived daily total, exactly as Save/Submit stores it.
    return { ...e, customMeters, custom: { ...(e.custom ?? {}), [code]: r ? r.total : null } };
  }
  const map = { ...((kind === "water" ? e.water : e.energy) ?? {}) };
  if (r) map[code] = r;
  else delete map[code];
  return kind === "water" ? { ...e, water: map } : { ...e, energy: map };
}

/** Every meter of the unit, by stable code: 12 water, 3 energy, then its custom columns. */
export function logbookMeters(industry: LogbookContext["industry"]): { kind: MeterKind; code: string; optional: boolean }[] {
  return [
    ...WATER_METERS.map((m) => ({ kind: "water" as const, code: m.code, optional: isOptionalWaterMeter(m.code, industry) })),
    ...ENERGY_METERS.map((m) => ({ kind: "energy" as const, code: m.code, optional: false })),
    ...[...(industry.customColumns ?? [])].sort((a, b) => a.order - b.order).map((c) => ({ kind: "custom" as const, code: c.id, optional: true })),
  ];
}

/**
 * Apply the Monitoring Body's edits to the unit's entries - the live preview the sheet renders and,
 * inside the saving transaction, the change itself. Pure: `all` is never mutated.
 */
export function computeCorrections(all: readonly EtpEntry[], industryId: string, edits: LogbookEdits, ctx: LogbookContext): CorrectionOutcome {
  const errors: CellError[] = [];
  const editableInitials = new Set<string>();
  const direct = new Set<string>();
  const next = new Map<string, EtpEntry>();
  const unitAll = all.filter((e) => e.industryId === industryId).sort(byDate);
  const filed = unitAll.filter(isFiled);
  const filedIds = new Set(filed.map((e) => e.id));
  const filedByDate = new Map(filed.map((e) => [e.date, e]));
  const current = (e: EtpEntry) => next.get(e.id) ?? e;
  const err = (date: string, field: string, message: string) => errors.push({ date, field, message });

  // ---- 0. parse every edited cell; a cell on a day with no submitted entry is refused
  const parsed = new Map<string, { raw: string; num: number | null }>();
  for (const [key, raw] of Object.entries(edits)) {
    const [date, field] = splitKey(key);
    const e = filedByDate.get(date);
    if (!e) {
      err(date, field, "This day has no submitted entry to correct.");
      continue;
    }
    direct.add(e.id);
    const t = raw.trim();
    if (/\.(dateOfDisposal|manifestNo|remark)$/.test(field)) {
      parsed.set(key, { raw, num: null });
      continue;
    }
    if (t === "") {
      parsed.set(key, { raw, num: null });
      continue;
    }
    const p = /^(sludge|salt)\.opening$/.test(field) ? parseBalance(t) : parseDailyValue(t);
    if (p.error || p.value == null) {
      err(date, field, NUMERIC_MESSAGE[p.error ?? "NOT_NUMERIC"]);
      continue;
    }
    parsed.set(key, { raw, num: p.value });
  }
  const editOf = (date: string, field: string) => parsed.get(cellKey(date, field));

  // ---- 1. meters: walk each meter's submitted days in date order
  const meterChanges = new Map<string, CorrectionChange[]>();
  const noteMeter = (id: string, c: CorrectionChange) => meterChanges.set(id, [...(meterChanges.get(id) ?? []), c]);
  for (const { kind, code, optional } of logbookMeters(ctx.industry)) {
    const key = meterKeyOf(kind, code);
    let prevOld: number | undefined; // the previous day's Final before the corrections
    let prevNew: number | undefined; // ...and after them
    let prevDate: string | undefined;
    // The chain the entry form carries along: for water and energy, every earlier entry in any
    // status (so a corrected Final also reaches a following draft or rejected day, whose Initial
    // would otherwise be left locked on the old figure); for custom columns, filed days only.
    const chain = kind === "custom" ? filed : unitAll;
    for (const e0 of chain) {
      const isFiledDay = filedIds.has(e0.id);
      const orig = readingOf(e0, kind, code);
      const fInit = meterField(kind, code, "initial");
      const fFinal = meterField(kind, code, "final");
      const eInit = editOf(e0.date, fInit);
      const eFinal = editOf(e0.date, fFinal);

      // Where this day's Initial comes from: the previous Final, or a Monitoring-Body baseline.
      const carry = prevNew !== undefined && prevDate ? { value: prevNew, fromDate: prevDate } : null;
      const derived = baselineAwareInitial(ctx.baselines, key, e0.date, carry);
      const isStart = !derived || derived.source === "baseline";
      const wasCarried = !isStart && !!orig && prevOld !== undefined && round2(orig.initial) === round2(prevOld);
      if (isFiledDay && (isStart || (orig && !wasCarried))) editableInitials.add(cellKey(e0.date, fInit));

      if (!orig && !eFinal) {
        if (eInit) err(e0.date, fInit, "Enter the Final reading for this meter too.");
        continue; // no reading that day, and none added
      }

      // Initial
      let initial: number | undefined;
      if (eInit) {
        if (!editableInitials.has(cellKey(e0.date, fInit))) err(e0.date, fInit, "This Initial follows the previous day's Final - correct that Final instead.");
        if (eInit.num == null) err(e0.date, fInit, "Enter the Initial reading.");
        else initial = eInit.num;
      } else if (orig) {
        initial = wasCarried ? prevNew : orig.initial;
      } else {
        // a reading added to a day that had none
        initial = isStart ? (derived?.source === "baseline" ? derived.value : undefined) : prevNew;
      }

      // Final (null = remove the reading)
      const final = eFinal ? eFinal.num : orig?.final;
      if (final == null) {
        if (!optional) {
          err(e0.date, fFinal, "A reading is required for this meter.");
          continue;
        }
        if (orig) {
          next.set(e0.id, withReading(current(e0), kind, code, null));
          noteMeter(e0.id, { field: fInit, from: orig.initial, to: null });
          noteMeter(e0.id, { field: fFinal, from: orig.final, to: null });
          prevOld = orig.final;
        }
        continue;
      }
      if (initial === undefined) {
        err(e0.date, fInit, "Enter the Initial reading.");
        continue;
      }
      // Checked on filed days only. A draft or rejected day is the operator's to fix: a corrected
      // reading carried into it may leave its Final below its new Initial, which the operator's own
      // form then flags - refusing the officer's save over a day the sheet cannot edit would strand it.
      if (final < initial && isFiledDay) err(e0.date, fFinal, `Final is below the Initial (${initial}).`);

      const reading = toMeterReading(initial, final);
      if (!orig || orig.initial !== reading.initial || orig.final !== reading.final) {
        next.set(e0.id, withReading(current(e0), kind, code, reading));
        if (!orig || orig.initial !== reading.initial) noteMeter(e0.id, { field: fInit, from: orig?.initial ?? null, to: reading.initial });
        if (!orig || orig.final !== reading.final) noteMeter(e0.id, { field: fFinal, from: orig?.final ?? null, to: reading.final });
      }
      if (orig) prevOld = orig.final;
      prevNew = reading.final;
      prevDate = e0.date;
    }
  }

  // ---- 2. Sludge & Salt: apply the typed inputs, then carry the balances forward
  const pinned = new Set<string>();
  for (const e0 of filed) {
    for (const l of LEDGERS) {
      const edited = LEDGER_FIELDS.filter((f) => parsed.has(cellKey(e0.date, ledgerField(l, f))));
      if (!edited.length) continue;
      const base = current(e0);
      const led: HwLedger = { ...(base[l] ?? { opening: 0, generation: 0, dateOfDisposal: "", dispatch: 0, manifestNo: "", closing: 0, remark: "" }) };
      for (const f of edited) {
        const p = parsed.get(cellKey(e0.date, ledgerField(l, f)))!;
        if (NUMERIC_LEDGER_FIELDS.includes(f)) {
          if (p.num == null) err(e0.date, ledgerField(l, f), "Enter a number (0 if none).");
          else (led[f as "opening" | "generation" | "dispatch"] = p.num);
        } else if (f === "dateOfDisposal") {
          const v = p.raw.trim();
          if (v && !isRealDate(v)) err(e0.date, ledgerField(l, f), "Use a real date (YYYY-MM-DD).");
          else led.dateOfDisposal = v;
        } else {
          led[f as "manifestNo" | "remark"] = p.raw.trim();
        }
      }
      if (edited.includes("opening")) {
        // A typed opening is an actual stock count: an anchor later corrections do not move.
        pinned.add(`${e0.id}:${l}`);
        led.openingManual = true;
      }
      led.closing = closingBalance(led.opening, led.generation, led.dispatch);
      if (dispatchNeedsManifest(led.dispatch, led.manifestNo, led.dateOfDisposal)) {
        err(e0.date, ledgerField(l, "manifestNo"), "A dispatch needs a Manifest No. and a Date of disposal.");
      }
      // Stock and closing are checked once the whole chain has settled (relinkLedgers): an earlier
      // correction in the same save may raise this day's opening.
      next.set(e0.id, { ...current(e0), [l]: led });
    }
  }
  const afterLedgers = all.map((e) => next.get(e.id) ?? e);
  const linked = relinkLedgers(all, afterLedgers, industryId, pinned);
  if (!linked.ok) err(linked.date, ledgerField(linked.ledger, linked.kind === "overStock" ? "dispatch" : "opening"), linked.error);
  const settled = linked.ok ? linked.entries : afterLedgers;

  // ---- 3. collect the field changes and recompute every derived figure on changed days
  const original = new Map(all.map((e) => [e.id, e]));
  const changes = new Map<string, CorrectionChange[]>();
  const out = settled.map((e) => {
    const o = original.get(e.id)!;
    if (e === o) return e;
    const list = [...(meterChanges.get(e.id) ?? [])];
    for (const l of LEDGERS) {
      for (const f of [...LEDGER_FIELDS, "closing"] as const) {
        const from = o[l]?.[f] ?? null;
        const to = e[l]?.[f] ?? null;
        if (from !== to) list.push({ field: ledgerField(l, f), from, to });
      }
    }
    if (!list.length) return o;
    changes.set(e.id, list);
    // Legacy entries filed before the meter model have no `water` map - their scalars stay as filed.
    return e.water ? { ...e, ...deriveWaterFigures(e.water) } : e;
  });
  const carriedOnly = new Set([...changes.keys()].filter((id) => !direct.has(id)));
  return { entries: out, changes, carriedOnly, errors, editableInitials };
}

export type ApplyResult = { ok: true; etpEntries: EtpEntry[]; approvals: Approval[]; corrected: number } | { ok: false; error: string };

/**
 * Apply corrections to a unit's slice - the server's copy, read inside the saving transaction.
 *
 * Refused when any cell is invalid, or when any entry the corrections touch is no longer the
 * version the sheet was opened on (`expected`: entry id → `entryRevision`), so an ETP's edit made
 * meanwhile is never overwritten unseen. Each corrected day gets a correction record - who, when,
 * which values changed from what - and keeps its status: the Monitoring Body approves separately.
 */
export function applyCorrections(
  slice: { etpEntries: EtpEntry[]; approvals: Approval[] },
  industryId: string,
  edits: LogbookEdits,
  ctx: LogbookContext,
  audit: { expected: Readonly<Record<string, string>>; byUid: string; byEmail?: string; at: string },
): ApplyResult {
  const res = computeCorrections(slice.etpEntries, industryId, edits, ctx);
  if (res.errors.length) {
    const first = res.errors[0];
    return { ok: false, error: `${res.errors.length} cell${res.errors.length === 1 ? "" : "s"} need fixing - ${first.date}: ${first.message}` };
  }
  if (res.changes.size === 0) return { ok: true, etpEntries: slice.etpEntries, approvals: slice.approvals, corrected: 0 };

  const byId = new Map(slice.etpEntries.map((e) => [e.id, e]));
  // Every day the officer confirmed AND every day the server-side recompute touches: a confirmed
  // day the ETP changed meanwhile must refuse the save, not silently drop out of it.
  for (const id of new Set([...Object.keys(audit.expected), ...res.changes.keys()])) {
    const o = byId.get(id);
    if (!o || audit.expected[id] !== entryRevision(o)) {
      return {
        ok: false,
        error: "This unit's readings changed while you were correcting them (the ETP may have filed or edited a day). Discard your changes and make the corrections again on the latest figures.",
      };
    }
  }

  const approvalOf = new Map(slice.approvals.map((a) => [a.readingId, a]));
  const etpEntries = res.entries.map((e) => {
    const changes = res.changes.get(e.id);
    if (!changes) return e;
    const a = approvalOf.get(e.id);
    const stamp = {
      at: audit.at,
      byUid: audit.byUid,
      ...(audit.byEmail ? { byEmail: audit.byEmail } : {}),
      ...(a ? { approvalId: a.id, approvalStage: a.stage } : {}),
    };
    const history = e.corrections ?? [];
    if (res.carriedOnly.has(e.id)) {
      // A day that only moved because an earlier correction carried into it: one compact marker,
      // replacing any earlier one - its figures are explained by the corrected days' records.
      const record: EntryCorrection = { ...stamp, carried: true, changes: [] };
      return { ...e, corrections: [...history.filter((c) => !c.carried), record] };
    }
    const record: EntryCorrection = { ...stamp, changes };
    const direct = [...history.filter((c) => !c.carried), record].slice(-MAX_CORRECTION_RECORDS);
    const carried = history.filter((c) => c.carried).slice(-1);
    return { ...e, corrections: [...direct, ...carried].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)) };
  });
  // The approval card's figure is the day's total intake - keep it in step with the corrected day.
  const corrected = new Map(etpEntries.filter((e) => res.changes.has(e.id)).map((e) => [e.id, e]));
  const approvals = slice.approvals.map((a) => {
    const e = corrected.get(a.readingId);
    return e && a.difference !== e.totalWaterIntake ? { ...a, difference: e.totalWaterIntake } : a;
  });
  return { ok: true, etpEntries, approvals, corrected: res.changes.size };
}

/** The revisions the sheet was opened on, for every entry its corrections would touch. */
export function expectedRevisions(entries: readonly EtpEntry[], outcome: Pick<CorrectionOutcome, "changes">): Record<string, string> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return Object.fromEntries([...outcome.changes.keys()].map((id) => [id, entryRevision(byId.get(id)!)]));
}

const LEDGER_LABEL: Record<string, string> = {
  opening: "Opening balance",
  generation: "Generation",
  dispatch: "Dispatch",
  dateOfDisposal: "Date of disposal",
  manifestNo: "Manifest No.",
  remark: "Remark",
  closing: "Closing balance",
};

/** "Raw Fresh Water / Fresh Water Input — Final", "Sludge — Opening balance": a correction's field in words. */
export function describeCorrectionField(field: string, customColumns?: readonly { id: string; name: string }[]): string {
  const [kind, code, part] = field.split(".");
  if (kind === "sludge" || kind === "salt") return `${kind === "sludge" ? "Sludge" : "Salt"} — ${LEDGER_LABEL[code] ?? code}`;
  const label =
    kind === "water"
      ? WATER_METERS.find((m) => m.code === code)?.label
      : kind === "energy"
        ? ENERGY_METERS.find((m) => m.code === code)?.label
        : customColumns?.find((c) => c.id === code)?.name;
  return `${label ?? code} — ${part === "initial" ? "Initial" : "Final"}`;
}

/** The revision of every entry of a unit - the snapshot a correction session is checked against. */
export function unitRevisions(entries: readonly EtpEntry[], industryId: string): Record<string, string> {
  return Object.fromEntries(entries.filter((e) => e.industryId === industryId).map((e) => [e.id, entryRevision(e)]));
}
