/* ============================================================
   Operations that must re-check the server copy at write time, built on patchTenantSlice.
   Each one is pure logic (approval-decisions.ts, ledger-amend.ts) run inside a per-unit
   Firestore transaction.
   ============================================================ */

import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { patchTenantSlice } from "@/lib/data/tenant-tx";
import { quiesceLocalWrites, retiredUnitIds } from "@/lib/data/firestore-storage";
import { deleteDocument } from "@/lib/data/documents";
import { approveCandidatesInSlice, type ApprovalCandidate, type CandidateOutcome } from "@/lib/data/approval-decisions";
import { amendLedgers, type LedgerExpectation, type LedgerInputs } from "@/lib/data/ledger-amend";
import { applyCorrections, type LogbookContext, type LogbookEdits } from "@/lib/data/logbook";
import { useDataStore } from "@/lib/store/data";
import { ETP_DOCUMENT_TYPES } from "@/lib/types";

export interface BulkApproveReport {
  approved: CandidateOutcome[];
  skipped: CandidateOutcome[];
  /** Units whose transaction failed outright; their candidates were NOT approved. */
  failed: { industryId: string; count: number; error: string }[];
}

/**
 * Approve exactly the confirmed candidates. One transaction per unit — bounded, sequential, and
 * each re-checks its candidates against that unit's CURRENT server copy, so an entry edited,
 * re-submitted or decided by another officer after confirmation is skipped, never approved unseen.
 *
 * A unit that fails does not undo the others: its successes stand, and the report says precisely
 * what was approved, skipped and failed. Safe to retry — already-approved candidates are skipped.
 */
export async function approveAll(candidates: readonly ApprovalCandidate[], reviewer: string): Promise<BulkApproveReport> {
  const report: BulkApproveReport = { approved: [], skipped: [], failed: [] };
  const byUnit = new Map<string, ApprovalCandidate[]>();
  for (const c of candidates) byUnit.set(c.industryId, [...(byUnit.get(c.industryId) ?? []), c]);

  for (const [industryId, unitCandidates] of byUnit) {
    const reviewedAt = new Date().toISOString();
    const res = await patchTenantSlice(industryId, (slice) => {
      const r = approveCandidatesInSlice(slice, unitCandidates, reviewer, reviewedAt);
      return { next: r.changed ? { ...slice, approvals: r.approvals, etpEntries: r.etpEntries } : null, result: r.outcomes };
    });
    if (!res.ok) {
      report.failed.push({ industryId, count: unitCandidates.length, error: res.error });
      continue;
    }
    for (const o of res.result) (o.result === "approved" ? report.approved : report.skipped).push(o);
  }
  return report;
}

/**
 * Save Sludge & Salt for an existing day, at any time and in any status. Only the ledger inputs
 * are taken from the caller; everything else comes from the server copy, so fields the operator
 * did not touch can never be overwritten with a stale local version. `expected` is the day as the
 * form loaded it: if the server's copy has moved on since, the save is refused, not merged.
 */
export async function saveLedgers(
  industryId: string,
  date: string,
  inputs: { sludge: LedgerInputs; salt: LedgerInputs },
  expected: LedgerExpectation,
  byUid: string,
): Promise<{ ok: true; changed: boolean; editedDates: string[] } | { ok: false; error: string }> {
  const at = new Date().toISOString();
  let failure: string | null = null;
  const res = await patchTenantSlice(industryId, (slice) => {
    // Reset per attempt: Firestore re-runs this on contention, and a stale failure from an
    // earlier attempt must not be reported for a save that then succeeded.
    failure = null;
    const r = amendLedgers(slice.etpEntries, industryId, date, inputs, byUid, at, { expected, approvals: slice.approvals });
    if (!r.ok) {
      failure = r.error;
      return { next: null, result: { changed: false, editedDates: [] as string[] } };
    }
    return { next: r.changed ? { ...slice, etpEntries: r.entries } : null, result: { changed: r.changed, editedDates: r.editedDates } };
  });
  if (!res.ok) return { ok: false, error: res.error };
  if (failure) return { ok: false, error: failure };
  return { ok: true, ...res.result };
}

/**
 * Save the Monitoring Body's Logbook corrections for one unit. The edits are re-applied to the
 * server's current copy inside a transaction; `expected` holds the revisions of every day the
 * corrections touch as the sheet showed them, so a day the ETP changed meanwhile refuses the save
 * instead of being overwritten.
 */
export async function saveCorrections(
  industryId: string,
  edits: LogbookEdits,
  ctx: LogbookContext,
  expected: Readonly<Record<string, string>>,
  by: { uid: string; email?: string },
): Promise<{ ok: true; corrected: number } | { ok: false; error: string }> {
  const at = new Date().toISOString();
  let failure: string | null = null;
  const res = await patchTenantSlice(industryId, (slice) => {
    failure = null; // reset per attempt: Firestore may re-run this on contention
    const r = applyCorrections({ etpEntries: slice.etpEntries, approvals: slice.approvals }, industryId, edits, ctx, {
      expected,
      byUid: by.uid,
      byEmail: by.email,
      at,
    });
    if (!r.ok) {
      failure = r.error;
      return { next: null, result: 0 };
    }
    return { next: r.corrected ? { ...slice, etpEntries: r.etpEntries, approvals: r.approvals } : null, result: r.corrected };
  });
  if (!res.ok) return { ok: false, error: res.error };
  if (failure) return { ok: false, error: failure };
  return { ok: true, corrected: res.result };
}

/**
 * Delete a unit for good (Monitoring Body). Its uploaded documents go first - a subcollection is not
 * removed with its parent - then ONE batch deletes the unit and retires its id. The rules accept
 * neither write without the other, so a deleted unit's id can never be issued again (its operator's
 * profile still points at it). Meter-issue history stays: the rules keep that undeletable.
 */
export async function deleteUnit(industryId: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, error: "Your session has expired. Sign in again." };
  // Let earlier store writes reach the server first, so none of them lands after the delete.
  if (!(await quiesceLocalWrites())) {
    return { ok: false, error: "Earlier changes are still syncing. Check your connection and try again." };
  }
  for (const t of ETP_DOCUMENT_TYPES) {
    if (!(await deleteDocument(industryId, t.code))) {
      return { ok: false, error: "Could not remove the unit's uploaded documents, so the unit was not deleted. Try again." };
    }
  }
  const batch = writeBatch(db);
  batch.set(doc(db, "retiredUnits", industryId), {
    industryId,
    name: name.slice(0, 200),
    deletedAt: serverTimestamp(),
    deletedByUid: user.uid,
    deletedByEmail: user.email,
  });
  batch.delete(doc(db, "industries", industryId));
  try {
    await batch.commit();
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") {
      // The usual cause: another officer deleted it a moment ago, so its retirement record exists.
      const gone = await getDoc(doc(db, "retiredUnits", industryId)).then((d) => d.exists(), () => false);
      return { ok: false, error: gone ? "This unit has already been deleted, possibly by another officer." : "You do not have permission to delete this unit." };
    }
    return { ok: false, error: "Could not delete the unit. Check your connection and try again." };
  }
  retiredUnitIds.add(industryId);
  useDataStore.getState().removeIndustry(industryId);
  return { ok: true };
}

/** Close the help-request alert a meter issue raised, once that issue is resolved. */
export async function resolveAlertTx(industryId: string, alertId: string): Promise<boolean> {
  const res = await patchTenantSlice(industryId, (slice) => {
    const hit = slice.alerts.some((a) => a.id === alertId && a.status !== "resolved");
    if (!hit) return { next: null, result: false };
    return { next: { ...slice, alerts: slice.alerts.map((a) => (a.id === alertId ? { ...a, status: "resolved" as const } : a)) }, result: true };
  });
  return res.ok && res.result;
}
