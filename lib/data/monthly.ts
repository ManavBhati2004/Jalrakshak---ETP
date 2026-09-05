/* ============================================================
   JalRakshak — monthly aggregation for the RSPCB Compliance Report
   Pure functions over the daily EtpEntry rows. Only SUBMITTED (non-draft,
   non-rejected) entries feed monthly totals & authorisation usage (master §13).
   ============================================================ */

import type { EtpEntry } from "@/lib/types";
import { round1 } from "@/lib/data/etp-calc";

/** "YYYY-MM" key for a date-only string. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** Current month "YYYY-MM" from a Date (caller supplies it — no ambient clock in pure code). */
export function toMonthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Number of calendar days in a "YYYY-MM" month. */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** All submitted (non-draft, non-rejected) entries for a unit in a month, ascending by date. */
export function monthEntries(entries: EtpEntry[], industryId: string, month: string): EtpEntry[] {
  return entries
    .filter((e) => e.industryId === industryId && monthKey(e.date) === month && e.entryStatus !== "DRAFT" && e.status !== "rejected")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Σ of daily Total values for one water meter code across the month (master §13.2/§13.3). */
export function monthlyWaterTotal(monthly: EtpEntry[], code: string): number {
  return round1(monthly.reduce((s, e) => s + Number(e.water?.[code]?.total ?? 0), 0));
}

/**
 * The four meters that make up TRADE EFFLUENT RECYCLED (and RECYCLE WATER — the client
 * confirmed they are the same measure): ETP Direct Reuse + RO Permeate (1st & 2nd Stage)
 * + RO Permeate (3rd & 4th Stage) + MEE Condensate Water. Keyed by stable meter CODE, never
 * by visible label, so relabelling a meter can never silently change the formula.
 */
export const TRADE_EFFLUENT_RECYCLED_CODES = ["ETP_DIRECT_REUSE", "RO_PERMEATE_COMMON", "RO_PERMEATE_3_4", "MEE_CONDENSATE"] as const;

/** Sigma of daily Totals across several water meters. Rounded once at the end - components are never pre-rounded. */
export function monthlyWaterTotalOf(monthly: EtpEntry[], codes: readonly string[]): number {
  return round1(monthly.reduce((s, e) => s + codes.reduce((t, c) => t + Number(e.water?.[c]?.total ?? 0), 0), 0));
}

export interface LedgerRollup {
  openingKg: number; // opening balance on the first entry of the month
  generationKg: number; // Σ generation
  disposalKg: number; // Σ dispatch
  closingKg: number; // closing balance on the last entry of the month
}

/** Month rollup for a hazardous-waste ledger (kg): opening(1st) / Σgen / Σdisposal / closing(last). */
export function ledgerRollup(monthly: EtpEntry[], ledger: "sludge" | "salt"): LedgerRollup {
  if (monthly.length === 0) return { openingKg: 0, generationKg: 0, disposalKg: 0, closingKg: 0 };
  const first = monthly[0][ledger];
  const last = monthly[monthly.length - 1][ledger];
  return {
    openingKg: round1(first?.opening ?? 0),
    generationKg: round1(monthly.reduce((s, e) => s + Number(e[ledger]?.generation ?? 0), 0)),
    disposalKg: round1(monthly.reduce((s, e) => s + Number(e[ledger]?.dispatch ?? 0), 0)),
    closingKg: round1(last?.closing ?? 0),
  };
}

/** Manifest rows for the month (one per dispatch), for the Compliance manifest table. */
export interface ManifestRow {
  date: string;
  manifestNo: string;
  wasteType: string;
  quantityKg: number;
}
export function manifestRows(monthly: EtpEntry[]): ManifestRow[] {
  const rows: ManifestRow[] = [];
  for (const e of monthly) {
    if ((e.sludge?.dispatch ?? 0) > 0) rows.push({ date: e.sludge!.dateOfDisposal || e.date, manifestNo: e.sludge!.manifestNo, wasteType: "ETP SLUDGE", quantityKg: round1(e.sludge!.dispatch) });
    if ((e.salt?.dispatch ?? 0) > 0) rows.push({ date: e.salt!.dateOfDisposal || e.date, manifestNo: e.salt!.manifestNo, wasteType: "ATFD SALT (MEE)", quantityKg: round1(e.salt!.dispatch) });
  }
  return rows;
}

export interface MonthlyCompliance {
  month: string;
  daysReported: number;
  daysInMonth: number;
  clothsProductionMeters: number;
  rawFreshWaterM3: number; // Σ RAW_FRESH_WATER daily totals
  rawInfluentM3: number; // Σ ETP_INLET_ALL_STREAMS daily totals
  /** Σ "ETP Inlet Section - Total of All Stream" for the month (one field label, NOT a subtraction). */
  tradeEffluentGenerationM3: number;
  /** ETP Direct Reuse + RO Permeate 1&2 + RO Permeate 3&4 + MEE Condensate. */
  tradeEffluentRecycledM3: number;
  /** RECYCLE WATER — same measure as tradeEffluentRecycledM3 (client-confirmed equivalence). */
  recycleWaterM3: number;
  meeFeedM3: number;
  meeCondensateM3: number;
  meeRejectM3: number;
  sludge: LedgerRollup;
  salt: LedgerRollup;
  manifests: ManifestRow[];
}

/** Full monthly compliance summary for a unit (master §13). */
export function buildMonthlyCompliance(entries: EtpEntry[], industryId: string, month: string, clothsProductionMeters: number): MonthlyCompliance {
  const monthly = monthEntries(entries, industryId, month);
  // "ETP Inlet Section - Total of All Stream" is ONE field label, not a subtraction. Trade Effluent
  // Generation is its monthly sum, which is the same figure as rawInfluentM3 - computed once, reused.
  const etpInletTotalM3 = monthlyWaterTotal(monthly, "ETP_INLET_ALL_STREAMS");
  const recycledM3 = monthlyWaterTotalOf(monthly, TRADE_EFFLUENT_RECYCLED_CODES);
  return {
    month,
    daysReported: monthly.length,
    daysInMonth: daysInMonth(month),
    clothsProductionMeters,
    rawFreshWaterM3: monthlyWaterTotal(monthly, "RAW_FRESH_WATER"),
    rawInfluentM3: etpInletTotalM3,
    tradeEffluentGenerationM3: etpInletTotalM3,
    tradeEffluentRecycledM3: recycledM3,
    recycleWaterM3: recycledM3,
    meeFeedM3: monthlyWaterTotal(monthly, "MEE_FEED"),
    meeCondensateM3: monthlyWaterTotal(monthly, "MEE_CONDENSATE"),
    meeRejectM3: monthlyWaterTotal(monthly, "MEE_REJECT"),
    sludge: ledgerRollup(monthly, "sludge"),
    salt: ledgerRollup(monthly, "salt"),
    manifests: manifestRows(monthly),
  };
}
