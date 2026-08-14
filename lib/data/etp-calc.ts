/* ============================================================
   JalRakshak — RSPCB prescribed-return pure calculation core
   All functions are pure & unit-tested (see etp-calc.test.ts). Structure follows the
   client Excel; behaviour follows the master prompt (FE/CR/JALRAKSHAK/001 R2).
   ============================================================ */

import type { EtpEntry, MeterReading, HwLedger } from "@/lib/types";
import {
  WATER_METERS,
  RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON,
  DAILY_MAX_VALUE,
  AUTHORISED_QUANTITY_WARNING_PERCENT,
} from "@/lib/constants";

/** Round to one decimal place, guarding against binary FP drift (e.g. 0.1+0.2). */
export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/** Meter daily total = Final − Initial, one decimal. */
export function meterTotal(initial: number, final: number): number {
  return round1(final - initial);
}

/** Build a MeterReading from raw initial/final numbers. */
export function toMeterReading(initial: number, final: number): MeterReading {
  return { initial, final, total: meterTotal(initial, final) };
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
    totals[def.group] = round1(totals[def.group] + (water[def.code]?.total ?? 0));
  }
  return totals;
}

/** Sum of every water meter total (master §5.5 — NOT a dedup KPI). */
export function computeGrandTotal(water: Record<string, MeterReading>): number {
  return round1(Object.values(water).reduce((s, m) => s + (m?.total ?? 0), 0));
}

/** Hazardous-waste closing balance = Opening + Generation − Dispatch (one decimal). */
export function closingBalance(opening: number, generation: number, dispatch: number): number {
  return round1(opening + generation - dispatch);
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
    opening: round1(input.opening),
    generation: round1(input.generation),
    dateOfDisposal: input.dateOfDisposal,
    dispatch: round1(input.dispatch),
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
  return round1(dispatch) > round1(opening + generation);
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
  const mine = entries.filter((e) => e.industryId === industryId && e.date < date);
  const priorDate = previousCalendarDay(date);
  const priorDay = entries.find((e) => e.industryId === industryId && e.date === priorDate);
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
  return round1(
    entries
      .filter(
        (e) =>
          e.industryId === industryId &&
          e.entryStatus !== "DRAFT" &&
          e.status !== "rejected" &&
          withinRange(e.date, from, to),
      )
      .reduce((s, e) => s + (e[ledger]?.dispatch ?? 0), 0),
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
    return { configured: false, usedKg: cumulativeKg, authorisedKg: 0, remainingKg: 0, percent: 0 };
  }
  return {
    configured: true,
    usedKg: round1(cumulativeKg),
    authorisedKg: round1(authorisedKg),
    remainingKg: round1(authorisedKg - cumulativeKg),
    percent: round1((cumulativeKg / authorisedKg) * 100),
  };
}

/* ---------------- Quantity conversion (master §3.3) ---------------- */

/** kg = MT × 1000, one decimal. */
export function mtToKg(mt: number): number {
  return round1(mt * 1000);
}

/** Convert a source quantity in KG or MT to canonical kg (never double-converts). */
export function toCanonicalKg(quantity: number, unit: "KG" | "MT"): number {
  return unit === "MT" ? mtToKg(quantity) : round1(quantity);
}

/* ---------------- Numeric standard (master §4) ---------------- */

export type NumericError = "NOT_NUMERIC" | "NEGATIVE" | "TOO_MANY_DECIMALS" | "VALUE_OUT_OF_RANGE";

/**
 * Validate & normalise a daily numeric input: ≤7 integer digits, ≤1 decimal, nonnegative,
 * ≤ 9999999.9, no scientific notation. Empty string is allowed while typing (value = null).
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
  if (decPart.length > 1) return { value: null, error: "TOO_MANY_DECIMALS" };
  const value = Number(s);
  if (!Number.isFinite(value)) return { value: null, error: "NOT_NUMERIC" };
  if (value < 0) return { value: null, error: "NEGATIVE" };
  if (value > DAILY_MAX_VALUE) return { value: null, error: "VALUE_OUT_OF_RANGE" };
  return { value: round1(value) };
}
