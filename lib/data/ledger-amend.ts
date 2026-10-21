/* ============================================================
   Sludge & Salt amendments — pure, Firebase-free, unit-testable.

   Lets an operator change the ledger inputs of a day that is already filed (in any status),
   then carries the effect forward. Closing is derived and stays derived:
   Closing = Opening + Generation − Dispatch. The Opening is normally carried from the previous
   day's Closing, but it may also be set by hand on any day (an actual stock count).

   Editing day D changes D's Closing, and every later day's Opening that was carried depends on
   it. Without the forward pass, D+1 would keep an Opening computed from D's old Closing, and the
   regulator's ledger sheet and monthly roll-up would stop balancing.
   ============================================================ */

import type { Approval, EtpEntry, HwLedger, LedgerEdit, LedgerFieldChange } from "@/lib/types";
import { DAILY_MAX_VALUE } from "@/lib/constants";
import { closingBalance, dispatchExceedsStock, dispatchNeedsManifest, isFiledEntry, round2, toLedger } from "@/lib/data/etp-calc";

/**
 * The operator-editable fields of one ledger. Closing is absent on purpose: it is derived.
 * `opening` is optional: when given it sets the day's opening; otherwise the stored one is kept.
 * `openingManual` says that opening was set by hand (an actual stock count) - see HwLedger.
 */
export interface LedgerInputs {
  opening?: number;
  openingManual?: boolean;
  generation: number;
  dispatch: number;
  dateOfDisposal: string;
  manifestNo: string;
  remark: string;
}

export type LedgerName = "sludge" | "salt";
const LEDGERS: readonly LedgerName[] = ["sludge", "salt"];
const INPUT_FIELDS = ["opening", "generation", "dispatch", "dateOfDisposal", "manifestNo", "remark"] as const;
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

/** The approval a day was under, for stamping audit records (at most one exists per entry). */
function approvalStamp(e: EtpEntry, approvals: readonly Approval[] | undefined): Pick<LedgerEdit, "approvalId" | "approvalStage"> {
  const a = approvals?.find((x) => x.readingId === e.id);
  return a ? { approvalId: a.id, approvalStage: a.stage } : {};
}

/**
 * Note on a day whose balances moved because an earlier day changed. One marker per source date:
 * a newer recalculation from the same day replaces the older.
 */
export function withCarriedNote(e: EtpEntry, sourceDate: string, at: string, byUid: string, approvals?: readonly Approval[]): EtpEntry {
  const kept = (e.ledgerEdits ?? []).filter((x) => !(x.kind === "carried" && x.sourceDate === sourceDate));
  return { ...e, ledgerEdits: capped([...kept, { at, byUid, kind: "carried", sourceDate, ...approvalStamp(e, approvals) }]) };
}

export type AmendResult =
  | { ok: true; entries: EtpEntry[]; changed: boolean; editedDates: string[] }
  | { ok: false; error: string };

/**
 * Ceiling for a running stock balance. A balance accumulates over months, so it is not held to the
 * 7-digit DAILY ceiling - only to the same 2-decimal standard.
 */
export const MAX_BALANCE = 9999999999.99;

/** A balance: finite, non-negative, at most 2 dp, under MAX_BALANCE. */
function balanceError(noun: string, label: string, v: number): string | null {
  if (!Number.isFinite(v)) return `${noun} ${label} is not a number.`;
  if (v < 0) return `${noun} ${label} cannot be negative.`;
  if (v > MAX_BALANCE) return `${noun} ${label} is above the allowed maximum.`;
  if (round2(v) !== v) return `${noun} ${label} allows at most 2 decimal places.`;
  return null;
}

/** The daily numeric standard: finite, non-negative, at most 2 dp, under the ceiling. */
function quantityError(noun: string, label: string, v: number): string | null {
  if (!Number.isFinite(v)) return `${noun} ${label} is not a number.`;
  if (v < 0) return `${noun} ${label} cannot be negative.`;
  if (v > DAILY_MAX_VALUE) return `${noun} ${label} is above the allowed maximum.`;
  if (round2(v) !== v) return `${noun} ${label} allows at most 2 decimal places.`;
  return null;
}

/** Per-field changes between two stored ledgers, for the audit trail. */
function diffLedger(ledger: LedgerName, before: HwLedger | undefined, after: HwLedger, fields: readonly LedgerFieldChange["field"][]): LedgerFieldChange[] {
  const out: LedgerFieldChange[] = [];
  for (const f of fields) {
    const from = before?.[f] ?? (typeof after[f] === "number" ? 0 : "");
    const to = after[f];
    if (from !== to) out.push({ ledger, field: f, from, to });
  }
  return out;
}

const byDate = (a: EtpEntry, b: EtpEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export type RelinkResult =
  | { ok: true; entries: EtpEntry[]; moved: Set<string> }
  | { ok: false; error: string; date: string; ledger: LedgerName; kind: "overStock" | "negative" };

/**
 * Carry the unit's Sludge & Salt balances forward after one or more of its days changed.
 *
 * `before` and `after` are the full entry lists before and after the change (same ids; `after` may
 * hold a newly saved day). Only FILED days lead the chain (`isFiledEntry`): a draft's or a rejected
 * day's figures never move another day - though its own opening does follow the days before it.
 * Walking the unit's days in date order, each day's opening:
 * - stays as given when it is in `pinned` (`<entryId>:sludge|salt`, set by this change) or was set
 *   by hand (`openingManual`) - an actual stock count is an anchor;
 * - otherwise moves by exactly as much as the closing it follows moved. A day that carried the
 *   previous closing keeps carrying it, and a small difference already on record (imported data)
 *   is kept rather than silently "corrected" away.
 * Every closing is recomputed from its own day. A day whose figures moved is refused rather than
 * written if its dispatch would exceed its stock or its closing go negative, naming that date.
 *
 * Returns `after` (order preserved) with the moved days updated, and the ids the walk moved.
 */
export function relinkLedgers(before: readonly EtpEntry[], after: readonly EtpEntry[], industryId: string, pinned: ReadonlySet<string>): RelinkResult {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const updated = new Map<string, EtpEntry>();
  const moved = new Set<string>();

  for (const l of LEDGERS) {
    const noun = NOUN[l].toLowerCase();
    // The closing that led `date` BEFORE the change: the latest earlier FILED day's.
    const origLeaders = before.filter((e) => e.industryId === industryId && e[l] && isFiledEntry(e)).sort(byDate);
    const origPrevClosing = (date: string): number | undefined => {
      let c: number | undefined;
      for (const e of origLeaders) {
        if (e.date >= date) break;
        c = e[l]!.closing;
      }
      return c;
    };
    const chain = after
      .map((e) => updated.get(e.id) ?? e)
      .filter((e) => e.industryId === industryId && e[l])
      .sort(byDate);

    let prevNew: number | undefined; // the closing now leading the next day (latest filed day so far)
    for (const cur of chain) {
      const led = cur[l]!;
      const orig = beforeById.get(cur.id)?.[l];
      let opening = led.opening;
      const anchored = pinned.has(`${cur.id}:${l}`) || !!led.openingManual;
      if (!anchored && orig && prevNew !== undefined) {
        const op = origPrevClosing(cur.date);
        if (op !== undefined) opening = orig.opening + (prevNew - op);
      }
      opening = round2(opening);
      const closing = closingBalance(opening, led.generation, led.dispatch);
      const differs = !orig || orig.opening !== opening || orig.closing !== closing || orig.generation !== led.generation || orig.dispatch !== led.dispatch;
      if (differs) {
        if (dispatchExceedsStock(opening, led.generation, led.dispatch)) {
          return {
            ok: false,
            error: `This change would leave ${noun} dispatched on ${cur.date} exceeding the stock available that day. Correct ${cur.date} first, or reduce this change.`,
            date: cur.date,
            ledger: l,
            kind: "overStock",
          };
        }
        if (closing < 0) {
          return { ok: false, error: `This change would make the ${noun} closing balance on ${cur.date} negative.`, date: cur.date, ledger: l, kind: "negative" };
        }
      }
      if (opening !== led.opening || closing !== led.closing) {
        updated.set(cur.id, { ...cur, [l]: { ...led, opening, closing } });
        if (!pinned.has(`${cur.id}:${l}`)) moved.add(cur.id);
      }
      if (isFiledEntry(cur)) prevNew = closing;
    }
  }
  // Original array order preserved, so the slice re-serialises in the shape it was read in.
  return { ok: true, entries: after.map((e) => updated.get(e.id) ?? e), moved };
}

/**
 * Amend the Sludge & Salt inputs of the entry for (`industryId`, `date`) and carry the result
 * forward through the unit's later entries.
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

  // ---- 1. validate and rebuild the target's two ledgers
  const nextTarget: Partial<Record<LedgerName, HwLedger>> = {};
  const targetChanges: LedgerFieldChange[] = [];
  for (const l of LEDGERS) {
    const inp = inputs[l];
    const noun = NOUN[l];
    const err =
      (inp.opening !== undefined ? balanceError(noun, "opening balance", inp.opening) : null) ??
      quantityError(noun, "generation", inp.generation) ??
      quantityError(noun, "dispatch", inp.dispatch);
    if (err) return { ok: false, error: err };
    const opening = inp.opening ?? target[l]?.opening ?? 0;
    if (dispatchNeedsManifest(inp.dispatch, inp.manifestNo, inp.dateOfDisposal)) {
      return { ok: false, error: `${noun} dispatch needs a Manifest No. and a Date of disposal.` };
    }
    if (dispatchExceedsStock(opening, inp.generation, inp.dispatch)) {
      return { ok: false, error: `${noun} dispatch cannot exceed Opening + Generation.` };
    }
    const openingManual = inp.opening !== undefined ? !!inp.openingManual : !!target[l]?.openingManual;
    const ledger = toLedger({ opening, generation: inp.generation, dispatch: inp.dispatch, dateOfDisposal: inp.dateOfDisposal, manifestNo: inp.manifestNo, remark: inp.remark, openingManual });
    if (ledger.closing < 0) return { ok: false, error: `${noun} closing balance cannot be negative.` };
    nextTarget[l] = ledger;
    targetChanges.push(...diffLedger(l, target[l], ledger, INPUT_FIELDS));
    // Marking (or clearing) a hand-set opening is a real change even when the figure is unchanged.
    if (!!ledger.openingManual !== !!target[l]?.openingManual && !targetChanges.some((c) => c.ledger === l && c.field === "opening")) {
      targetChanges.push({ ledger: l, field: "opening", from: target[l]?.opening ?? 0, to: ledger.opening });
    }
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

  // ---- 2. carry forward through the later days
  const edited: EtpEntry = {
    ...target,
    ...(nextTarget.sludge ? { sludge: nextTarget.sludge } : {}),
    ...(nextTarget.salt ? { salt: nextTarget.salt } : {}),
    ledgerEdits: capped([...(target.ledgerEdits ?? []), { at, byUid, kind: "edit", changes: targetChanges, ...approvalStamp(target, opts.approvals) } satisfies LedgerEdit]),
  };
  const linked = relinkLedgers(
    entries,
    entries.map((e) => (e.id === target.id ? edited : e)),
    industryId,
    new Set([`${target.id}:sludge`, `${target.id}:salt`]),
  );
  if (!linked.ok) return { ok: false, error: linked.error };

  const editedDates = [date];
  const out = linked.entries.map((e) => {
    if (!linked.moved.has(e.id)) return e;
    editedDates.push(e.date);
    return withCarriedNote(e, date, at, byUid, opts.approvals);
  });
  editedDates.sort((a, b) => (a === date ? -1 : b === date ? 1 : a < b ? -1 : 1));
  return { ok: true, entries: out, changed: true, editedDates };
}
