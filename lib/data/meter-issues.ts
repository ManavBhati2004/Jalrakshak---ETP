/* ============================================================
   Meter issues & baselines.

   Stored at industries/{industryId}/meterIssues/{issueId} — OUTSIDE the unit's JSON blob, which
   the owner may rewrite freely and the rules cannot inspect. Here firestore.rules check every
   field: only the unit's operator may report (as OPEN, as themselves, at the server's time), and
   only the Monitoring Body may resolve, once, writing only the resolution fields.

   A RESOLVED issue is also the meter's baseline record, so resolving it and setting the baseline
   are one document write: the two can never disagree.

   Issue ids are `<kind>.<code>.<n>`: issue n of a meter can only be created once issue n−1 is
   resolved, so a meter never has two open issues - and never two competing baselines.
   ============================================================ */

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { MeterIssue, MeterIssueResolution } from "@/lib/types";
import type { IndustrySlice } from "@/lib/data/firestore-storage";
import { issueDocId, lastIssueSeq, latestMeterReading, round2 } from "@/lib/data/etp-calc";
import { DAILY_MAX_VALUE } from "@/lib/constants";
import { useDataStore } from "@/lib/store/data";
import { resolveAlertTx } from "@/lib/data/tenant-ops";

/** Bounded so the document stays small; mirrored by firestore.rules. */
export const MAX_ISSUE_DESCRIPTION = 1000;

/** How far past the last issue it knows of a report will look for a free number. */
const MAX_SEQ_WALK = 25;

const issuesCol = (industryId: string) => collection(db, "industries", industryId, "meterIssues");

const isoOf = (v: unknown): string => (v instanceof Timestamp ? v.toDate().toISOString() : typeof v === "string" ? v : "");

/** Server timestamps become ISO strings; a write still in flight shows the local estimate. */
function toIssue(snap: DocumentSnapshot): MeterIssue {
  const d = snap.data({ serverTimestamps: "estimate" }) ?? {};
  return {
    ...(d as Omit<MeterIssue, "id" | "createdAt" | "resolvedAt">),
    id: snap.id,
    createdAt: isoOf(d.createdAt),
    resolvedAt: d.resolvedAt == null ? undefined : isoOf(d.resolvedAt),
  };
}

/** Live view of one unit's issues, newest first. `onError` fires if they cannot be read at all. */
export function subscribeMeterIssues(industryId: string, onData: (issues: MeterIssue[]) => void, onError: () => void): Unsubscribe {
  return onSnapshot(
    issuesCol(industryId),
    (snap) => {
      const out = snap.docs.map(toIssue);
      out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      onData(out);
    },
    () => onError(),
  );
}

class IssueAbort extends Error {}

/**
 * Report a meter problem. If the meter already has an OPEN issue it is reused, not duplicated -
 * decided inside a transaction against the server, not against whatever this screen last saw.
 * The Monitoring Body is notified through the existing help-request alert, which feeds the bell
 * and the Alert Center; its id is stored on the issue so resolution can close it.
 */
export async function reportMeterIssue(input: {
  industryId: string;
  meterKey: string;
  meterLabel: string;
  unit: string;
  description: string;
  /** The unit's issues as currently known - only a starting point for the number search. */
  known: readonly MeterIssue[];
}): Promise<{ ok: true; issue: MeterIssue; reused: boolean } | { ok: false; error: string }> {
  const description = input.description.trim().slice(0, MAX_ISSUE_DESCRIPTION);
  if (!description) return { ok: false, error: "Describe the problem with the meter." };
  // Identity comes from the signed-in session; the rules check it against the auth token.
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, error: "Your session has expired. Sign in again." };

  // The reading shown to the Monitoring Body: the meter's latest saved reading, any status.
  const latest = latestMeterReading(useDataStore.getState().etpEntries, input.industryId, input.meterKey);
  const alertId = `AL-${Date.now().toString(36).toUpperCase()}-MTR`;
  const start = Math.max(1, lastIssueSeq(input.known, input.meterKey));

  let out: { issue: MeterIssue; reused: boolean };
  try {
    out = await runTransaction(db, async (tx) => {
      // Walk from the last issue known here to the first free number. An OPEN issue on the way is
      // this meter's unresolved one: hand it back instead of filing a duplicate.
      for (let seq = start; seq < start + MAX_SEQ_WALK; seq++) {
        const ref = doc(issuesCol(input.industryId), issueDocId(input.meterKey, seq));
        const snap = await tx.get(ref);
        if (snap.exists()) {
          const existing = toIssue(snap);
          if (existing.status === "OPEN") return { issue: existing, reused: true };
          continue;
        }
        const data = {
          industryId: input.industryId,
          meterKey: input.meterKey,
          seq,
          meterLabel: input.meterLabel,
          unit: input.unit,
          reportedReading: latest?.value ?? null,
          reportedReadingDate: latest?.date ?? null,
          description,
          status: "OPEN" as const,
          reporterUid: user.uid,
          reporterEmail: user.email as string,
          alertId,
        };
        tx.set(ref, { ...data, createdAt: serverTimestamp() });
        return { issue: { ...data, id: ref.id, createdAt: new Date().toISOString() }, reused: false };
      }
      throw new IssueAbort("This meter has more issues on record than can be listed here. Refresh the page and try again.");
    });
  } catch (e) {
    if (e instanceof IssueAbort) return { ok: false, error: e.message };
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") return { ok: false, error: "You can only report meters on your own unit." };
    return { ok: false, error: "Could not send the report. Check your connection and try again." };
  }
  // Raised only AFTER the issue exists, and only for a new one, so neither a failed report nor a
  // repeated click ever leaves an orphan or duplicate notification.
  if (!out.reused) {
    useDataStore.getState().reportIssue(
      input.industryId,
      "Meter / hardware",
      `${input.meterLabel}: ${description}${latest ? ` (last reading ${latest.value} on ${latest.date})` : ""}`,
      { id: alertId },
    );
  }
  return { ok: true, ...out };
}

/** Validate a baseline the same way the daily numeric standard validates any reading. */
export function baselineError(resolution: MeterIssueResolution, value: number): string | null {
  if (resolution === "RESET" && value !== 0) return "A reset sets the baseline to exactly 0.";
  if (!Number.isFinite(value)) return "Enter a number.";
  if (value < 0) return "A baseline cannot be negative.";
  if (value > DAILY_MAX_VALUE) return "That value is above the allowed maximum.";
  if (round2(value) !== value) return "At most 2 decimal places.";
  return null;
}

type Reading = { value: number; date: string } | null;
const sameReading = (a: Reading, b: Reading) => (a === null || b === null ? a === b : a.value === b.value && a.date === b.date);

class StaleAbort extends Error {
  constructor(readonly current: Reading) {
    super("stale");
  }
}

/**
 * Resolve an issue by setting the meter's new baseline (Monitoring Body only — enforced by the
 * rules, not just hidden in the UI).
 *
 * One transaction re-reads the issue and the unit's current data. It refuses if the issue was
 * already resolved (by another officer), or if the meter's latest reading - value AND date - is no
 * longer the one the officer confirmed against, so a baseline is never applied to a meter whose
 * state moved on. The effective time is the server's, stamped by the write itself.
 */
export async function resolveMeterIssue(input: {
  industryId: string;
  issueId: string;
  resolution: MeterIssueResolution;
  newBaseline: number;
  /** The meter's latest reading as the officer was shown it, or null for none. */
  confirmed: Reading;
}): Promise<{ ok: true } | { ok: false; error: string; stale?: { current: Reading } }> {
  const bad = baselineError(input.resolution, input.newBaseline);
  if (bad) return { ok: false, error: bad };
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, error: "Your session has expired. Sign in again." };

  const issueRef = doc(issuesCol(input.industryId), input.issueId);
  const unitRef = doc(db, "industries", input.industryId);
  let alertId: string | undefined;
  try {
    await runTransaction(db, async (tx) => {
      const issueSnap = await tx.get(issueRef);
      const unitSnap = await tx.get(unitRef);
      if (!issueSnap.exists()) throw new IssueAbort("That issue no longer exists.");
      const issue = toIssue(issueSnap);
      if (issue.status !== "OPEN") throw new IssueAbort("Already resolved — possibly by another officer. Refresh to see the outcome.");
      if (!unitSnap.exists()) throw new IssueAbort("That unit no longer exists.");

      let slice: IndustrySlice;
      try {
        slice = JSON.parse(String(unitSnap.data().json)) as IndustrySlice;
      } catch {
        throw new IssueAbort("That unit's stored data could not be read.");
      }
      const latest = latestMeterReading(slice.etpEntries, input.industryId, issue.meterKey);
      if (!sameReading(latest, input.confirmed)) throw new StaleAbort(latest);
      alertId = issue.alertId;
      tx.update(issueRef, {
        status: "RESOLVED",
        resolution: input.resolution,
        newBaseline: input.newBaseline,
        // Where the old sequence ends: taken from the SERVER copy, inside the transaction.
        previousReading: latest?.value ?? null,
        afterDate: latest?.date ?? "",
        resolvedAt: serverTimestamp(),
        resolvedByUid: user.uid,
        resolvedByEmail: user.email,
      });
    });
  } catch (e) {
    if (e instanceof StaleAbort) {
      const now = e.current ? `${e.current.value} on ${e.current.date}` : "no reading";
      return {
        ok: false,
        error: `The meter's latest reading is now ${now}, not what you confirmed. Check the new figures and confirm again.`,
        stale: { current: e.current },
      };
    }
    if (e instanceof IssueAbort) return { ok: false, error: e.message };
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") return { ok: false, error: "Only the Monitoring Body can resolve meter issues." };
    if (code === "aborted" || code === "failed-precondition") return { ok: false, error: "The issue changed while saving. Please try again." };
    return { ok: false, error: "Could not resolve. Check your connection and try again." };
  }
  // Best-effort: the issue is resolved either way; the alert is only the notification.
  if (alertId) await resolveAlertTx(input.industryId, alertId).catch(() => false);
  return { ok: true };
}

/** Most reasons fit a line; bounded like an operator's description, mirrored by the rules. */
export const MAX_RESET_REASON = MAX_ISSUE_DESCRIPTION;

/**
 * The Monitoring Body resets (or resumes) a meter directly, without waiting for the unit to report
 * it - e.g. after inspecting a replaced meter. Recorded exactly like a resolved report: the meter's
 * next numbered issue, created already RESOLVED and marked `raisedBy: "monitoring-body"`, so the
 * sequencing, the entry page's notice and the reports treat it identically. The old meter's last
 * reading stays on its day and is kept on the record as `previousReading`.
 *
 * One transaction: refuses if the meter already has an open report (resolve that one instead) or
 * if its latest reading is no longer the one the officer confirmed against.
 */
export async function resetMeterDirectly(input: {
  industryId: string;
  meterKey: string;
  meterLabel: string;
  unit: string;
  reason: string;
  resolution: MeterIssueResolution;
  newBaseline: number;
  /** The meter's latest reading as the officer was shown it, or null for none. */
  confirmed: Reading;
  /** The unit's issues as currently known - only a starting point for the number search. */
  known: readonly MeterIssue[];
}): Promise<{ ok: true; issueId: string } | { ok: false; error: string; stale?: { current: Reading } }> {
  const bad = baselineError(input.resolution, input.newBaseline);
  if (bad) return { ok: false, error: bad };
  const reason = input.reason.trim().slice(0, MAX_RESET_REASON);
  if (!reason) return { ok: false, error: "Give a reason for the reset (e.g. meter replaced)." };
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, error: "Your session has expired. Sign in again." };

  const unitRef = doc(db, "industries", input.industryId);
  const start = Math.max(1, lastIssueSeq(input.known, input.meterKey));
  try {
    const issueId = await runTransaction(db, async (tx) => {
      const unitSnap = await tx.get(unitRef);
      if (!unitSnap.exists()) throw new IssueAbort("That unit no longer exists.");
      let slice: IndustrySlice;
      try {
        slice = JSON.parse(String(unitSnap.data().json)) as IndustrySlice;
      } catch {
        throw new IssueAbort("That unit's stored data could not be read.");
      }
      const latest = latestMeterReading(slice.etpEntries, input.industryId, input.meterKey);
      if (!sameReading(latest, input.confirmed)) throw new StaleAbort(latest);

      for (let seq = start; seq < start + MAX_SEQ_WALK; seq++) {
        const ref = doc(issuesCol(input.industryId), issueDocId(input.meterKey, seq));
        const snap = await tx.get(ref);
        if (snap.exists()) {
          if (toIssue(snap).status === "OPEN") {
            throw new IssueAbort("This meter already has an open report from the unit - resolve it from the list instead.");
          }
          continue;
        }
        tx.set(ref, {
          industryId: input.industryId,
          meterKey: input.meterKey,
          seq,
          meterLabel: input.meterLabel,
          unit: input.unit,
          reportedReading: latest?.value ?? null,
          reportedReadingDate: latest?.date ?? null,
          description: reason,
          status: "RESOLVED",
          reporterUid: user.uid,
          reporterEmail: user.email,
          createdAt: serverTimestamp(),
          raisedBy: "monitoring-body",
          resolution: input.resolution,
          newBaseline: input.newBaseline,
          // Where the old sequence ends: taken from the SERVER copy, inside the transaction.
          previousReading: latest?.value ?? null,
          afterDate: latest?.date ?? "",
          resolvedAt: serverTimestamp(),
          resolvedByUid: user.uid,
          resolvedByEmail: user.email,
        });
        return ref.id;
      }
      throw new IssueAbort("This meter has more issues on record than can be listed here. Refresh the page and try again.");
    });
    return { ok: true, issueId };
  } catch (e) {
    if (e instanceof StaleAbort) {
      const now = e.current ? `${e.current.value} on ${e.current.date}` : "no reading";
      return {
        ok: false,
        error: `The meter's latest reading is now ${now}, not what you confirmed. Check the new figures and confirm again.`,
        stale: { current: e.current },
      };
    }
    if (e instanceof IssueAbort) return { ok: false, error: e.message };
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") return { ok: false, error: "Only the Monitoring Body can reset a meter." };
    if (code === "aborted" || code === "failed-precondition") return { ok: false, error: "The meter changed while saving. Please try again." };
    return { ok: false, error: "Could not reset the meter. Check your connection and try again." };
  }
}
