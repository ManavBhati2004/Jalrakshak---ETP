/* ============================================================
   Sludge & Salt amendments — pure, Firebase-free, unit-testable.

   Lets an operator change the ledger INPUTS of a day that is already filed (in any status),
   then carries the effect forward. Opening and Closing are derived and stay derived:
   Opening = the previous entry's Closing, Closing = Opening + Generation − Dispatch.

   Editing day D changes D's Closing, and every later day's Opening depends on it. Without the
   forward pass, D+1 would keep an Opening computed from D's old Closing, and the regulator's
   ledger sheet and monthly roll-up would stop balancing.
   ============================================================ */

import type { Approval, EtpEntry, HwLedger, LedgerEdit, LedgerFieldChange } from "@/lib/types";
import { DAILY_MAX_VALUE } from "@/lib/constants";
import { closingBalance, dispatchExceedsStock, dispatchNeedsManifest, round2, toLedger } from "@/lib/data/etp-calc";

/** The operator-editable fields of one ledger. Opening/Closing are absent on purpose: derived. */
export interface LedgerInputs {
  generation: number;
  dispatch: number;
  dateOfDisposal: string;
  manifestNo: string;
  remark: string;
}

type LedgerName = "sludge" | "salt";
const LEDGERS: readonly LedgerName[] = ["sludge", "salt"];
const INPUT_FIELDS = ["generation", "dispatch", "dateOfDisposal", "manifestNo", "remark"] as const;
const NOUN: Record<LedgerName, string> = { sludge: "Sludge", salt: "Salt" };

/**
 * The day's ledgers exactly as the form loaded them. A save is refused when the stored day no longer
 * matches, so a change made elsewhere (another tab or device) is never silently overwritten.
 */
export interface LedgerExpectation {
  entryId: string;
  sludge: HwLedger | null;
  salt: HwLedger | null;
}

/**
 * Audit records kept per entry, newest first to survive. Bounded so a long history can never push the
 * unit's document towards Firestore's 1 MiB limit; "carried" markers are also collapsed to one per
 * source date, since only the latest recalculation from a given day is still in effect.
 */
export const MAX_EDIT_RECORDS = 50;
export const MAX_CARRIED_RECORDS = 20;

const STORED_FIELDS = ["opening", "generation", "dispatch", "dateOfDisposal", "manifestNo", "remark", "closing"] as const;
function sameLedger(a: HwLedger | null | undefined, b: HwLedger | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return STORED_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

/** Drop the oldest records of each kind beyond its cap, keeping chronological order. */
function capped(list: LedgerEdit[]): LedgerEdit[] {
  let dropEdits = Math.max(0, list.filter((x) => x.kind === "edit").length - MAX_EDIT_RECORDS);
  let dropCarried = Math.max(0, list.filter((x) => x.kind === "carried").length - MAX_CARRIED_RECORDS);
  return list.filter((x) => {
    if (x.kind === "edit" && dropEdits > 0) return (dropEdits--, false);
    if (x.kind === "carried" && dropCarried > 0) return (dropCarried--, false);
    return true;
  });
}

export type AmendResult =
  | { ok: true; entries: EtpEntry[]; changed: boolean; editedDates: string[] }
  | { ok: false; error: string };

/** The daily numeric standard: finite, non-negative, at most 2 dp, under the ceiling. */
function quantityError(noun: string, label: string, v: number): string | null {
  if (!Number.isFinite(v)) return `${noun} ${label} is not a number.`;
  if (v < 0) return `${noun} ${label} cannot be negative.`;
  if (v > DAILY_MAX_VALUE) return `${noun} ${label} is above the allowed maximum.`;
  if (round2(v) !== v) return `${noun} ${label} allows at most 2 decimal places.`;
  return null;
}

/** Per-field changes between two stored ledgers, for the audit trail. */
function diffLedger(ledger: LedgerName, before: HwLedger | undefined, after: HwLedger, fields: readonly (keyof HwLedger)[]): LedgerFieldChange[] {
  const out: LedgerFieldChange[] = [];
  for (const f of fields) {
    const from = before?.[f] ?? (typeof after[f] === "number" ? 0 : "");
    const to = after[f];
    if (from !== to) out.push({ ledger, field: f as LedgerFieldChange["field"], from, to });
  }
  return out;
}

/**
 * Amend the Sludge & Salt inputs of the entry for (`industryId`, `date`) and carry the result
 * forward through every later entry of that unit.
 *
 * `entries` must be the SERVER's current copy (read in the transaction that writes the result),
 * so a stale local copy can never be written back over newer data.
 *
 * - Only the ledgers change. Water, energy, custom meters, status and approvals are untouched.
 * - Status is deliberately NOT changed: an amendment is logged in `ledgerEdits` instead, so a prior
 *   approval keeps its earlier timestamp and is never presented as approving the new figures.
 * - Idempotent: saving the same values again changes nothing and records nothing.
 * - Refuses rather than writing an inconsistent ledger: an invalid input, or any later day whose
 *   balance would go negative, rejects the whole save and names the offending date.
 * - With `expected`, refuses if the stored day is not the version the form was loaded from.
 * - With `approvals`, stamps each audit record with the approval the day was under at the time.
 */
export function amendLedgers(
  entries: readonly EtpEntry[],
  industryId: string,
  date: string,
  inputs: Record<LedgerName, LedgerInputs>,
  byUid: string,
  at: string,
  opts: { expected?: LedgerExpectation; approvals?: readonly Approval[] } = {},
): AmendResult {
  const target = entries.find((e) => e.industryId === industryId && e.date === date);
  if (!target) return { ok: false, error: "There is no entry for that date yet. Save a draft of the day first." };
  // At most one approval exists per entry (a re-submission replaces it), so this is "the" decision.
  const under = (e: EtpEntry): Pick<LedgerEdit, "approvalId" | "approvalStage"> => {
    const a = opts.approvals?.find((x) => x.readingId === e.id);
    return a ? { approvalId: a.id, approvalStage: a.stage } : {};
  };

  // ---- 1. validate and rebuild the target's two ledgers; Opening stays exactly as stored
  const nextTarget: Partial<Record<LedgerName, HwLedger>> = {};
  const targetChanges: LedgerFieldChange[] = [];
  for (const l of LEDGERS) {
    const inp = inputs[l];
    const noun = NOUN[l];
    const err = quantityError(noun, "generation", inp.generation) ?? quantityError(noun, "dispatch", inp.dispatch);
    if (err) return { ok: false, error: err };
    const opening = target[l]?.opening ?? 0;
    if (dispatchNeedsManifest(inp.dispatch, inp.manifestNo, inp.dateOfDisposal)) {
      return { ok: false, error: `${noun} dispatch needs a Manifest No. and a Date of disposal.` };
    }
    if (dispatchExceedsStock(opening, inp.generation, inp.dispatch)) {
      return { ok: false, error: `${noun} dispatch cannot exceed Opening + Generation.` };
    }
    const ledger = toLedger({ opening, ...inp });
    if (ledger.closing < 0) return { ok: false, error: `${noun} closing balance cannot be negative.` };
    nextTarget[l] = ledger;
    targetChanges.push(...diffLedger(l, target[l], ledger, INPUT_FIELDS));
  }
  if (targetChanges.length === 0) return { ok: true, entries: [...entries], changed: false, editedDates: [] };
  // Checked only once there is something to write: saving values that are already stored is a
  // harmless no-op even if the form was loaded from an older version.
  const exp = opts.expected;
  if (exp && (exp.entryId !== target.id || LEDGERS.some((l) => !sameLedger(target[l], exp[l])))) {
    return {
      ok: false,
      error: "This day's Sludge & Salt was changed elsewhere after you opened it. Reload the day, then enter your change again.",
    };
  }

  // ---- 2. carry forward. The chain is this unit's entries in date order, each opening from the
  // entry immediately before it - the same source the entry form uses to seed a new day.
  const chain = entries.filter((e) => e.industryId === industryId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const startIdx = chain.findIndex((e) => e.id === target.id);
  const replaced = new Map<string, EtpEntry>();
  const editedDates: string[] = [date];

  let prev: EtpEntry = {
    ...target,
    ...(nextTarget.sludge ? { sludge: nextTarget.sludge } : {}),
    ...(nextTarget.salt ? { salt: nextTarget.salt } : {}),
    ledgerEdits: capped([...(target.ledgerEdits ?? []), { at, byUid, kind: "edit", changes: targetChanges, ...under(target) } satisfies LedgerEdit]),
  };
  replaced.set(target.id, prev);

  for (let i = startIdx + 1; i < chain.length; i++) {
    const e = chain[i];
    let moved = false;
    let next: EtpEntry = e;
    for (const l of LEDGERS) {
      const cur = e[l];
      if (!cur) continue; // a day with no ledger record has nothing to recompute
      const opening = round2(prev[l]?.closing ?? 0);
      if (opening === cur.opening) continue;
      if (dispatchExceedsStock(opening, cur.generation, cur.dispatch)) {
        return {
          ok: false,
          error: `This change would leave ${NOUN[l].toLowerCase()} dispatched on ${e.date} exceeding the stock available that day. Correct ${e.date} first, or reduce this change.`,
        };
      }
      const ledger: HwLedger = { ...cur, opening, closing: closingBalance(opening, cur.generation, cur.dispatch) };
      if (ledger.closing < 0) {
        return { ok: false, error: `This change would make the ${NOUN[l].toLowerCase()} closing balance on ${e.date} negative.` };
      }
      next = { ...next, [l]: ledger };
      moved = true;
    }
    if (moved) {
      // One compact marker per source date: a newer recalculation from the same day replaces the older.
      const kept = (e.ledgerEdits ?? []).filter((x) => !(x.kind === "carried" && x.sourceDate === date));
      next = { ...next, ledgerEdits: capped([...kept, { at, byUid, kind: "carried", sourceDate: date, ...under(e) }]) };
      replaced.set(e.id, next);
      editedDates.push(e.date);
    }
    prev = next;
  }

  // Original array order preserved, so the slice re-serialises in the shape it was read in.
  return { ok: true, entries: entries.map((e) => replaced.get(e.id) ?? e), changed: true, editedDates };
}
