/* ============================================================
   JalRakshak — RSPCB prescribed-return pure calculation core
   All functions are pure & unit-tested (see etp-calc.test.ts). Structure follows the
   client Excel; behaviour follows the master prompt (FE/CR/JALRAKSHAK/001 R2).
   ============================================================ */

import { DEFAULT_CUSTOM_COLUMN_UNIT, type EtpEntry, type MeterIssue, type MeterReading, type HwLedger } from "@/lib/types";
import {
  WATER_METERS,
  RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON,
  DAILY_MAX_VALUE,
  AUTHORISED_QUANTITY_WARNING_PERCENT,
} from "@/lib/constants";

/** Round to two decimal places - the daily numeric standard. Coerces to Number and guards
 *  non-finite input (a stringy or NaN value returns 0 rather than propagating garbage), with
 *  symmetric FP-drift nudge. */
export function round2(n: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round((x + (x < 0 ? -Number.EPSILON : Number.EPSILON)) * 100) / 100;
}

/** kg → MT at 3-dp (whole-kg resolution) — the single source of truth for all MT rendering. */
export function kgToMt(kg: number): number {
  return Math.round(Number(kg) || 0) / 1000;
}

/** Meter daily total = Final − Initial, one decimal. */
export function meterTotal(initial: number, final: number): number {
  return round2(final - initial);
}

/** Build a MeterReading from raw initial/final numbers (all rounded to 1 dp). */
export function toMeterReading(initial: number, final: number): MeterReading {
  return { initial: round2(initial), final: round2(final), total: meterTotal(initial, final) };
}

/** Row status for the entry UI: total + the two blocking conditions. */
export function meterRowStatus(initialStr: string, finalStr: string) {
  const hasInitial = initialStr.trim() !== "";
  const hasFinal = finalStr.trim() !== "";
  const initial = Number(initialStr) || 0;
  const final = Number(finalStr) || 0;
  const total = hasInitial && hasFinal ? meterTotal(initial, final) : 0;
  return {
    total,
    incomplete: hasInitial && !hasFinal, // an Initial without its Final blocks submit
    belowInitial: hasInitial && hasFinal && final < initial,
  };
}

/** Per-group water grand totals ({daily, ro, mee}); RO honours the Excel exclusion quirk. */
export function groupGrandTotals(water: Record<string, MeterReading>): Record<string, number> {
  const totals: Record<string, number> = { daily: 0, ro: 0, mee: 0 };
  for (const def of WATER_METERS) {
    if (RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON && def.code === "RO_PERMEATE_COMMON") continue;
    totals[def.group] = round2(totals[def.group] + Number(water[def.code]?.total ?? 0));
  }
  return totals;
}

/** Sum of every water meter total (master §5.5 — NOT a dedup KPI). */
export function computeGrandTotal(water: Record<string, MeterReading>): number {
  return round2(Object.values(water).reduce((s, m) => s + Number(m?.total ?? 0), 0));
}

/** Hazardous-waste closing balance = Opening + Generation − Dispatch (one decimal). */
export function closingBalance(opening: number, generation: number, dispatch: number): number {
  return round2(opening + generation - dispatch);
}

/** Build an HwLedger from raw inputs (server-authoritative closing). */
export function toLedger(input: {
  opening: number;
  generation: number;
  dateOfDisposal: string;
  dispatch: number;
  manifestNo: string;
  remark: string;
}): HwLedger {
  return {
    opening: round2(input.opening),
    generation: round2(input.generation),
    dateOfDisposal: input.dateOfDisposal,
    dispatch: round2(input.dispatch),
    manifestNo: input.manifestNo,
    closing: closingBalance(input.opening, input.generation, input.dispatch),
    remark: input.remark,
  };
}

/** Dispatch > 0 requires BOTH a (trimmed) Manifest No. and a Date of disposal. */
export function dispatchNeedsManifest(dispatch: number, manifestNo: string, dateOfDisposal: string): boolean {
  return dispatch > 0 && (manifestNo.trim() === "" || dateOfDisposal.trim() === "");
}

/** Dispatch must never exceed available stock (Opening + Generation). */
export function dispatchExceedsStock(opening: number, generation: number, dispatch: number): boolean {
  return round2(dispatch) > round2(opening + generation);
}

/* ---------------- Date helpers (date-only, local calendar) ---------------- */

/** ISO date string for the calendar day immediately before `date` (YYYY-MM-DD). */
export function previousCalendarDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/** validity-from must not be later than validity-to (both YYYY-MM-DD). */
export function dateRangeValid(from: string, to: string): boolean {
  if (!from || !to) return true; // let required-field checks handle emptiness
  return from <= to;
}

/** True when `date` is within [from,to] inclusive (empty bound = open). */
export function withinRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/* ---------------- Entry-date validation ---------------- */

/**
 * Floor for a reading date. Purely a typo guard: `0202-09-30` is a structurally valid date, and
 * nothing else in the app would reject it. Any genuine historical record sits well after this.
 */
export const MIN_ENTRY_DATE = "2000-01-01";

export type EntryDateError = "REQUIRED" | "MALFORMED" | "NOT_A_REAL_DATE" | "FUTURE" | "TOO_OLD";

/**
 * Validate the day a reading belongs to. Any past date is allowed - a missed day may be filled in
 * and a filed day corrected - but a date in the future is not a reading yet.
 *
 * `today` is INJECTED rather than read from a clock, so this stays pure and testable. Comparisons
 * are plain string comparisons, which are chronological for `YYYY-MM-DD` and therefore immune to
 * the timezone shifts that Date parsing introduces.
 */
export function validateEntryDate(date: string, today: string): { ok: true } | { ok: false; error: EntryDateError; message: string } {
  const s = (date ?? "").trim();
  if (s === "") return { ok: false, error: "REQUIRED", message: "Choose the date this reading belongs to." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, error: "MALFORMED", message: "Enter the date as YYYY-MM-DD." };

  // Round-trip through UTC to reject a well-formed but non-existent day such as 2026-02-30.
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: "NOT_A_REAL_DATE", message: `${s} is not a real calendar date.` };
  }

  if (today && s > today) return { ok: false, error: "FUTURE", message: "A reading cannot be dated in the future." };
  if (s < MIN_ENTRY_DATE) return { ok: false, error: "TOO_OLD", message: `Dates before ${MIN_ENTRY_DATE} are not accepted.` };
  return { ok: true };
}

/** Today's date as a local `YYYY-MM-DD`. Local getters only, so the calendar day never shifts. */
export function localDateString(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * One meter's stored daily total for an entry, or null when that meter was never recorded.
 * Null matters: entries filed before a meter existed must render blank, not a fabricated 0.
 * MEE meters carry no `legacyKey`, so they are only reachable this way - never via a legacy
 * scalar like `etpInlet`.
 */
export function entryMeterTotal(entry: EtpEntry, code: string): number | null {
  const v = entry.water?.[code]?.total;
  return v == null ? null : round2(Number(v));
}

/** As above, for an energy meter (Kwh). */
export function entryEnergyTotal(entry: EtpEntry, code: string): number | null {
  const v = entry.energy?.[code]?.total;
  return v == null ? null : round2(Number(v));
}

/* ---------------- Custom columns (operator-defined meters) ---------------- */

/** Unit for a custom column. Definitions predating units fall back to the water sections' M3. */
export function customColumnUnit(col: { unit?: string }): string {
  const u = (col.unit ?? "").trim();
  return u === "" ? DEFAULT_CUSTOM_COLUMN_UNIT : u;
}

/**
 * A custom column's daily total. Prefers the meter reading; falls back to the legacy scalar
 * filed before custom columns became meters, so historical values never disappear from a
 * report. Null — never 0 — when the column was not recorded that day.
 */
export function entryCustomTotal(entry: EtpEntry, columnId: string): number | null {
  const m = entry.customMeters?.[columnId]?.total;
  if (m != null) return round2(Number(m));
  const legacy = entry.custom?.[columnId];
  return legacy == null ? null : round2(Number(legacy));
}

/** A custom column's stored Initial/Final for a day, or null when it holds no meter reading. */
export function entryCustomReading(entry: EtpEntry, columnId: string): MeterReading | null {
  return entry.customMeters?.[columnId] ?? null;
}

/**
 * The Final to carry into today's Initial for one custom column, or null when there is none.
 *
 * Deliberately NOT `mostRecentPrior`: that helper keeps drafts and rejected entries, so a
 * draft's Final could become tomorrow's LOCKED Initial. It also scans per column rather than
 * per entry, because a column left blank files no reading at all — gaps are normal, and the
 * baseline is the last day that actually recorded this meter.
 *
 * A legacy scalar is never a carry source: it is a daily quantity, not a meter position, so
 * reading it as one would fabricate a baseline.
 */
export function carriedCustomFinal(entries: EtpEntry[], industryId: string, date: string, columnId: string): number | null {
  return carriedCustomSource(entries, industryId, date, columnId)?.value ?? null;
}

/** As `carriedCustomFinal`, but also says which day the value came from (needed for baselines). */
export function carriedCustomSource(entries: EtpEntry[], industryId: string, date: string, columnId: string): { value: number; fromDate: string } | null {
  const prior = entries
    .filter(
      (e) =>
        e.industryId === industryId &&
        e.date < date &&
        e.entryStatus !== "DRAFT" &&
        e.status !== "rejected" &&
        e.customMeters?.[columnId]?.final != null,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const v = prior?.customMeters?.[columnId]?.final;
  return v == null || !prior ? null : { value: round2(Number(v)), fromDate: prior.date };
}

/* ---------------- Meter baselines (reset / resume by the Monitoring Body) ----------------
   A meter reset or replacement starts a NEW reading sequence. The old readings are history and
   stay exactly as filed; the first reading of the new sequence takes its Initial from the
   Monitoring Body's baseline instead of the previous day's Final. Usage is still Final − Initial
   within one sequence, so it is never computed ACROSS a reset (15480 then a reset to 0 then 120 is
   120, not −15360), and the baseline itself is never counted as consumption. */

/** The parts of a resolved meter issue that sequencing needs. */
export interface MeterBaseline {
  meterKey: string;
  newBaseline: number;
  /** The old meter's last reading when the reset was made (null if none) - shown, never used in the maths. */
  previousReading: number | null;
  /** The last date that already held a reading for this meter when the reset was made ("" if none). */
  afterDate: string;
  /** The plant date the reset took effect, from the server's clock. */
  effectiveDate: string;
  /** The issue's number for this meter: a later resolution always has a higher one. */
  order: number;
}

/** `water:CODE` / `energy:CODE` / `custom:CC-...` - a stable id, never a label or a position. */
export function meterKeyOf(kind: "water" | "energy" | "custom", code: string): string {
  return `${kind}:${code}`;
}

/**
 * Document id of a meter's n-th issue: `water.RAW_FRESH_WATER.3`. The ':' becomes '.' because in the
 * last segment of a REST path a colon reads as a custom method. firestore.rules rebuilds this id from
 * the document's own fields (`issueIdOf`), so the two must stay in step.
 */
export function issueDocId(meterKey: string, seq: number): string {
  return `${meterKey.replace(":", ".")}.${seq}`;
}

/** The highest issue number raised for a meter so far, or 0 if none. */
export function lastIssueSeq(issues: readonly { meterKey: string; seq: number }[], meterKey: string): number {
  return issues.reduce((m, i) => (i.meterKey === meterKey && Number.isInteger(i.seq) && i.seq > m ? i.seq : m), 0);
}

/** The meter's unresolved issue, if it has one (the rules allow at most one per meter). */
export function openIssueFor<T extends { meterKey: string; status: string }>(issues: readonly T[], meterKey: string): T | undefined {
  return issues.find((i) => i.meterKey === meterKey && i.status === "OPEN");
}

/**
 * The plant's calendar date for an instant: India Standard Time, UTC+5:30, no daylight saving. Fixed
 * rather than the viewer's own zone, so the operator and every officer place a server-stamped reset on
 * the same day - and therefore sequence the readings identically.
 */
export function istDateString(at: string | number | Date): string {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolved issues as the baselines the entry form sequences readings by. An issue missing anything
 * sequencing depends on is DROPPED, never defaulted: an empty effective date would compare below every
 * real date and silently pull the meter's whole history into a new sequence.
 */
export function baselinesFrom(issues: readonly MeterIssue[]): MeterBaseline[] {
  const out: MeterBaseline[] = [];
  for (const i of issues) {
    if (i.status !== "RESOLVED") continue;
    const effectiveDate = i.resolvedAt ? istDateString(i.resolvedAt) : "";
    if (
      typeof i.meterKey !== "string" ||
      !i.meterKey ||
      typeof i.newBaseline !== "number" ||
      !Number.isFinite(i.newBaseline) ||
      i.newBaseline < 0 ||
      typeof i.afterDate !== "string" ||
      (i.afterDate !== "" && !ISO_DATE.test(i.afterDate)) ||
      !ISO_DATE.test(effectiveDate) ||
      !Number.isInteger(i.seq) ||
      i.seq < 1
    ) {
      continue;
    }
    out.push({
      meterKey: i.meterKey,
      newBaseline: round2(i.newBaseline),
      previousReading: typeof i.previousReading === "number" ? i.previousReading : null,
      afterDate: i.afterDate,
      effectiveDate,
      order: i.seq,
    });
  }
  return out;
}

/** The stored reading for a meter key on one entry, if that entry recorded it. */
function readingFor(e: EtpEntry, meterKey: string): MeterReading | undefined {
  const i = meterKey.indexOf(":");
  const kind = meterKey.slice(0, i);
  const code = meterKey.slice(i + 1);
  if (kind === "water") return e.water?.[code];
  if (kind === "energy") return e.energy?.[code];
  if (kind === "custom") return e.customMeters?.[code];
  return undefined;
}

/**
 * The meter's latest saved reading in ANY status - drafts and pending entries included, because a
 * reading already saved is an observation of the OLD meter whatever its review state. Used both for
 * the reading shown when an issue is reported and, from the server copy, to fix where the old
 * sequence ends when it is resolved.
 */
export function latestMeterReading(entries: readonly EtpEntry[], industryId: string, meterKey: string): { value: number; date: string } | null {
  let best: { value: number; date: string } | null = null;
  for (const e of entries) {
    if (e.industryId !== industryId) continue;
    const r = readingFor(e, meterKey);
    if (r?.final == null) continue;
    if (!best || e.date > best.date) best = { value: round2(Number(r.final)), date: e.date };
  }
  return best;
}

/**
 * Whether `date` falls in the new sequence a baseline started. Strictly after the last day that
 * already held a reading - so an existing entry for the reset day, even a pending draft, stays in
 * the old sequence - and never before the day the reset was made, so backfilling a missed day from
 * BEFORE the reset still belongs to the old meter.
 */
export function inBaselineSequence(b: MeterBaseline, date: string): boolean {
  return date > b.afterDate && date >= b.effectiveDate;
}

/** The latest baseline whose sequence contains `date`, if any (a meter may be reset twice). */
export function activeBaseline(baselines: readonly MeterBaseline[], meterKey: string, date: string): MeterBaseline | undefined {
  let best: MeterBaseline | undefined;
  for (const b of baselines) {
    if (b.meterKey !== meterKey || !inBaselineSequence(b, date)) continue;
    // Issue numbers order resolutions exactly; no device clock is involved.
    if (!best || b.order > best.order) best = b;
  }
  return best;
}

/**
 * The Initial for a meter on `date`, given the ordinary carry (the prior day's Final and the date it
 * came from). Inside a baseline's sequence the Initial is the baseline - unless the carry itself
 * already comes from inside that sequence, in which case normal carry-forward resumes.
 *
 * Returns null when there is nothing to derive from at all (a meter's very first reading).
 */
export function baselineAwareInitial(
  baselines: readonly MeterBaseline[],
  meterKey: string,
  date: string,
  carry: { value: number; fromDate: string } | null,
): { value: number; source: "carry" | "baseline"; baseline?: MeterBaseline } | null {
  const b = activeBaseline(baselines, meterKey, date);
  if (b && !(carry && inBaselineSequence(b, carry.fromDate))) {
    return { value: round2(b.newBaseline), source: "baseline", baseline: b };
  }
  return carry ? { value: carry.value, source: "carry" } : null;
}

/* ---------------- Carry-forward (master §5.3 / §9) ---------------- */

export interface CarryForward {
  /** The entry on the immediately-previous calendar day, if any (carry source). */
  priorDay?: EtpEntry;
  /** No entry exists on any earlier date → this is a first-ever/baseline entry. */
  isFirstEver: boolean;
  /** Earlier entries exist but the immediately-previous day is missing → block submit. */
  missingPriorDay: boolean;
}

/**
 * Resolve carry-forward for a unit/date. Carries ONLY from the immediately-previous
 * calendar day (never silently from an older non-consecutive day).
 */
export function resolveCarryForward(entries: EtpEntry[], industryId: string, date: string): CarryForward {
  // Only SUBMITTED/approved (non-draft, non-rejected) entries count as valid priors.
  const valid = entries.filter((e) => e.industryId === industryId && e.entryStatus !== "DRAFT" && e.status !== "rejected");
  const mine = valid.filter((e) => e.date < date);
  const priorDate = previousCalendarDay(date);
  const priorDay = valid.find((e) => e.date === priorDate);
  return {
    priorDay,
    isFirstEver: mine.length === 0,
    missingPriorDay: mine.length > 0 && !priorDay,
  };
}

/* ---------------- Authorisation usage (master §7.4) ---------------- */

/**
 * Cumulative dispatch (kg) for a ledger over the authorisation-validity window. Counts only
 * SUBMITTED/APPROVED entries (never drafts). `from`/`to` default to all-time when absent.
 */
export function cumulativeDispatch(
  entries: EtpEntry[],
  industryId: string,
  ledger: "sludge" | "salt",
  from?: string,
  to?: string,
): number {
  return round2(
    entries
      .filter(
        (e) =>
          e.industryId === industryId &&
          e.entryStatus !== "DRAFT" &&
          e.status !== "rejected" &&
          withinRange(e.date, from, to),
      )
      .reduce((s, e) => s + Number(e[ledger]?.dispatch ?? 0), 0),
  );
}

export type WarnLevel = "none" | "approaching" | "exceeded";

/** Warning level for cumulative dispatch vs the authorised quantity (kg). */
export function authorisedQuantityWarning(
  cumulativeKg: number,
  authorisedKg?: number,
  thresholdPercent: number = AUTHORISED_QUANTITY_WARNING_PERCENT,
): WarnLevel {
  if (!authorisedKg || authorisedKg <= 0) return "none";
  const pct = (cumulativeKg / authorisedKg) * 100;
  if (pct >= 100) return "exceeded";
  if (pct >= thresholdPercent) return "approaching";
  return "none";
}

/** Usage breakdown for the UI (used / authorised / remaining / percent). */
export function authorisationUsage(cumulativeKg: number, authorisedKg?: number) {
  if (!authorisedKg || authorisedKg <= 0) {
    return { configured: false, usedKg: round2(cumulativeKg), authorisedKg: 0, remainingKg: 0, percent: 0 };
  }
  return {
    configured: true,
    usedKg: round2(cumulativeKg),
    authorisedKg: round2(authorisedKg),
    remainingKg: round2(authorisedKg - cumulativeKg),
    percent: round2((cumulativeKg / authorisedKg) * 100),
  };
}

/* ---------------- Quantity conversion (master §3.3) ---------------- */

/** kg = MT × 1000, one decimal. */
export function mtToKg(mt: number): number {
  return round2(mt * 1000);
}

/** Convert a source quantity in KG or MT to canonical kg (never double-converts). */
export function toCanonicalKg(quantity: number, unit: "KG" | "MT"): number {
  return unit === "MT" ? mtToKg(quantity) : round2(quantity);
}

/* ---------------- Numeric standard (master §4) ---------------- */

export type NumericError = "NOT_NUMERIC" | "NEGATIVE" | "TOO_MANY_DECIMALS" | "VALUE_OUT_OF_RANGE";

/**
 * Validate & normalise a daily numeric input: ≤7 integer digits, ≤2 decimals, nonnegative,
 * ≤ 9999999.99, no scientific notation. Empty string is allowed while typing (value = null).
 */
export function parseDailyValue(raw: string): { value: number | null; error?: NumericError } {
  const s = raw.trim();
  if (s === "") return { value: null };
  if (!/^\d{0,7}(\.\d+)?$/.test(s)) {
    if (/e/i.test(s) || /[^\d.]/.test(s) || s.startsWith("-")) return { value: null, error: "NOT_NUMERIC" };
  }
  if (/e/i.test(s)) return { value: null, error: "NOT_NUMERIC" };
  if (!/^\d*(\.\d*)?$/.test(s)) return { value: null, error: "NOT_NUMERIC" };
  const [intPart = "", decPart = ""] = s.split(".");
  if (intPart.length > 7) return { value: null, error: "VALUE_OUT_OF_RANGE" };
  if (decPart.length > 2) return { value: null, error: "TOO_MANY_DECIMALS" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { value: null, error: "NOT_NUMERIC" };
  if (value < 0) return { value: null, error: "NEGATIVE" };
  if (value > DAILY_MAX_VALUE) return { value: null, error: "VALUE_OUT_OF_RANGE" };
  return { value: round2(value) };
}
