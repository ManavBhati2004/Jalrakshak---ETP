/**
 * Pure calculation & validation helpers for the RSPCB prescribed-return daily entry.
 * No store / Firebase / React dependencies, so these are unit-testable directly.
 * All meter/ledger quantities are rounded to ONE decimal place (kg per the brief;
 * water/energy kept to one decimal to match the prescribed sheet's precision).
 */
import type { EtpEntry, MeterReading, HwLedger } from "@/lib/types";
import { AUTHORISED_QUANTITY_WARNING_PERCENT } from "@/lib/constants";

/** Round to one decimal place, guarding binary-float noise (130.2 − 125.4 → 4.8). */
export function round1(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/** Total = Final − Initial (one decimal). Not clamped — negatives are flagged by validation. */
export function meterTotal(initial: number, final: number): number {
  return round1(final - initial);
}

export function toMeterReading(initial: number, final: number): MeterReading {
  return { initial, final, total: meterTotal(initial, final) };
}

/**
 * Validity + display total for a single meter row from its raw string inputs.
 * A meter is INCOMPLETE (blocks save) when it has an Initial (carried or typed)
 * but no Final — this closes the carry-forward hole where a blank Final would
 * otherwise coerce to 0 and yield a negative total. A Final below Initial is
 * belowInitial (also blocks). The display total is 0 while incomplete so a blank
 * Final never shows/persists a negative.
 */
export function meterRowStatus(initialStr: string, finalStr: string): { total: number; incomplete: boolean; belowInitial: boolean } {
  const hasInitial = initialStr !== "";
  const hasFinal = finalStr !== "";
  const initial = Number(initialStr) || 0;
  const final = Number(finalStr) || 0;
  const incomplete = hasInitial && !hasFinal;
  const belowInitial = hasInitial && hasFinal && final < initial;
  return { total: incomplete ? 0 : meterTotal(initial, final), incomplete, belowInitial };
}

/** Auto-sum of the water-meter totals. */
export function computeGrandTotal(water: Record<string, MeterReading> | undefined): number {
  if (!water) return 0;
  return round1(Object.values(water).reduce((s, m) => s + (m?.total ?? 0), 0));
}

/** Closing = Opening + Generation − Dispatch (one decimal). */
export function closingBalance(opening: number, generation: number, dispatch: number): number {
  return round1(opening + generation - dispatch);
}

export function toLedger(input: Omit<HwLedger, "closing">): HwLedger {
  return { ...input, closing: closingBalance(input.opening, input.generation, input.dispatch) };
}

/** Convert an authorised quantity to canonical kg (MT × 1000). */
export function mtToKg(qty: number, unit: "kg" | "MT"): number {
  return round1(unit === "MT" ? qty * 1000 : qty);
}

/**
 * Most-recent prior entry for a unit (by date, then submission time). Source of the
 * carry-forward Initial/Opening values. Scoped by unit; works across month/year
 * boundaries via YYYY-MM-DD comparison. Returns undefined when no prior entry exists
 * (caller must NOT fabricate a value in that case).
 */
export function resolveCarryForward(entries: EtpEntry[], industryId: string): EtpEntry | undefined {
  return entries
    .filter((e) => e.industryId === industryId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.submittedAt.localeCompare(a.submittedAt)))[0];
}

/** Cumulative dispatched quantity (kg) for a ledger across a unit's history. */
export function cumulativeDispatch(entries: EtpEntry[], industryId: string, ledger: "sludge" | "salt"): number {
  return round1(entries.filter((e) => e.industryId === industryId).reduce((s, e) => s + (e[ledger]?.dispatch ?? 0), 0));
}

// ---- validation predicates (true = invalid / should block) ----

export function finalBelowInitial(initial: number, final: number): boolean {
  return final < initial;
}

/** Dispatch > 0 requires both a Manifest No. and a Date of disposal. */
export function dispatchNeedsManifest(dispatch: number, manifestNo: string, dateOfDisposal: string): boolean {
  return dispatch > 0 && (!manifestNo.trim() || !dateOfDisposal.trim());
}

/** Date range is valid when either bound is empty (optional) or `to` ≥ `from`. */
export function dateRangeValid(from: string, to: string): boolean {
  if (!from || !to) return true;
  return to >= from; // YYYY-MM-DD is lexicographically ordered
}

/** Authorised-quantity warning level for a cumulative dispatch (kg). */
export function authorisedQuantityWarning(
  cumulativeKg: number,
  authorisedKg: number | undefined,
  percent: number = AUTHORISED_QUANTITY_WARNING_PERCENT,
): "none" | "approaching" | "exceeded" {
  if (!authorisedKg || authorisedKg <= 0) return "none";
  const ratio = (cumulativeKg / authorisedKg) * 100;
  if (ratio >= 100) return "exceeded";
  if (ratio >= percent) return "approaching";
  return "none";
}
