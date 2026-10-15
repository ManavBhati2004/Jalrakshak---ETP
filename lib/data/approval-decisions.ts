/* ============================================================
   Approval decisions — pure, Firebase-free, unit-testable.

   ONE definition of "what approving an approval does", shared by the individual Approve
   button (`decideApproval` in the store) and Approve All, so the two can never drift in
   attribution, timestamps or side effects.
   ============================================================ */

import type { Approval, ApprovalStage, EtpEntry } from "@/lib/types";

/** Awaiting a Monitoring-Body decision — the Approvals tab's "Queue". */
export function isPendingStage(stage: ApprovalStage): boolean {
  return stage === "submitted" || stage === "verification";
}

/**
 * The decided form of an approval. This is exactly the transformation `decideApproval` has always
 * applied; it was extracted, not changed.
 */
export function decidedApproval(a: Approval, decision: "approved" | "rejected", reviewer: string, reviewedAt: string): Approval {
  return {
    ...a,
    stage: decision,
    reviewedAt,
    reviewer,
    timeline: [
      { ...a.timeline[0], done: true },
      { stage: "verification", label: "Under Verification", at: reviewedAt, by: reviewer, done: true },
      {
        stage: decision,
        label: decision === "approved" ? "Approved" : "Rejected",
        at: reviewedAt,
        by: reviewer,
        done: true,
      },
    ],
  };
}

/**
 * The exact submission the Monitoring Body was shown and confirmed. A re-submission replaces an
 * approval with a NEW id, and `submittedAt` changes on every save, so this pair pins one version:
 * anything edited after confirmation no longer matches and is skipped, never approved unseen.
 */
export interface ApprovalCandidate {
  industryId: string;
  approvalId: string;
  submittedAt: string;
  /**
   * Fingerprint of the entry as the officer saw it. `submittedAt` alone is not enough: a Sludge &
   * Salt amendment changes neither it nor the status, so without this an entry amended after
   * confirmation would be approved unseen.
   */
  revision: string;
}

/** Deterministic JSON: object keys sorted at every level, so equal content gives an equal string. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/**
 * The entry's content revision. Excludes `status` - the one field an approval itself changes - so
 * the fingerprint is stable across the approval but moves with ANY edit, including an amendment.
 */
export function entryRevision(e: EtpEntry): string {
  const { status: _status, ...rest } = e;
  void _status;
  return stableStringify(rest);
}

/** The full test an entry must pass to be approvable — shared by the count and the write. */
function eligibleEntry(a: Approval, e: EtpEntry | undefined): e is EtpEntry {
  return !!e && e.entryStatus === "SUBMITTED" && e.status === "pending" && e.submittedAt === a.submittedAt;
}

export type CandidateOutcome =
  | { approvalId: string; industryId: string; result: "approved" }
  | { approvalId: string; industryId: string; result: "skipped"; reason: string };

/** ETP-entry approvals only — never the separate flow-meter `readings` category. */
export function isEtpEntryApproval(a: Approval, entries: readonly EtpEntry[]): boolean {
  return entries.some((e) => e.id === a.readingId);
}

/**
 * The candidate set Approve All offers: every pending ETP-entry approval, across all units in the
 * caller's data. There is no pagination on the Approvals tab, so "every page" is simply all of them.
 */
export function eligibleApprovalCandidates(approvals: readonly Approval[], entries: readonly EtpEntry[]): ApprovalCandidate[] {
  const out: ApprovalCandidate[] = [];
  for (const a of approvals) {
    if (!isPendingStage(a.stage)) continue;
    // The SAME predicate the write re-checks, so the confirmed count never overstates the result.
    const e = entries.find((x) => x.id === a.readingId);
    if (!eligibleEntry(a, e)) continue;
    out.push({ industryId: a.industryId, approvalId: a.id, submittedAt: a.submittedAt, revision: entryRevision(e) });
  }
  return out;
}

/**
 * Approve the candidates that belong to ONE unit, re-checking every one against `slice` — which
 * must be the server's current copy, read inside the same transaction that will write the result.
 * Anything no longer eligible is skipped with a reason; nothing is approved that was not confirmed.
 *
 * Idempotent: running it again over an already-approved slice approves nothing and changes nothing.
 */
export function approveCandidatesInSlice(
  slice: { approvals: Approval[]; etpEntries: EtpEntry[] },
  candidates: readonly ApprovalCandidate[],
  reviewer: string,
  reviewedAt: string,
): { approvals: Approval[]; etpEntries: EtpEntry[]; outcomes: CandidateOutcome[]; changed: boolean } {
  const outcomes: CandidateOutcome[] = [];
  const approveIds = new Set<string>();
  const entryIds = new Set<string>();

  for (const c of candidates) {
    const skip = (reason: string) => outcomes.push({ approvalId: c.approvalId, industryId: c.industryId, result: "skipped", reason });
    const a = slice.approvals.find((x) => x.id === c.approvalId);
    if (!a) {
      skip("No longer in the queue — it was re-submitted or removed after you confirmed.");
      continue;
    }
    if (!isPendingStage(a.stage)) {
      skip(`Already ${a.stage} — possibly by another officer.`);
      continue;
    }
    if (a.submittedAt !== c.submittedAt) {
      skip("Changed after you confirmed; review it individually.");
      continue;
    }
    const entry = slice.etpEntries.find((e) => e.id === a.readingId);
    if (!entry) {
      skip("Not an ETP entry approval.");
      continue;
    }
    if (entry.entryStatus !== "SUBMITTED") {
      skip("The entry is no longer submitted.");
      continue;
    }
    if (entry.submittedAt !== a.submittedAt) {
      skip("The entry changed after this approval was raised; review it individually.");
      continue;
    }
    if (entry.status !== "pending") {
      skip(`The entry is already ${entry.status}.`);
      continue;
    }
    if (entryRevision(entry) !== c.revision) {
      skip("Changed after you confirmed (for example a Sludge & Salt amendment); review it individually.");
      continue;
    }
    approveIds.add(a.id);
    entryIds.add(entry.id);
    outcomes.push({ approvalId: c.approvalId, industryId: c.industryId, result: "approved" });
  }

  if (approveIds.size === 0) return { approvals: slice.approvals, etpEntries: slice.etpEntries, outcomes, changed: false };

  return {
    // `map` preserves order, so the slice re-serialises in the same shape it was read in.
    approvals: slice.approvals.map((a) => (approveIds.has(a.id) ? decidedApproval(a, "approved", reviewer, reviewedAt) : a)),
    etpEntries: slice.etpEntries.map((e) => (entryIds.has(e.id) ? { ...e, status: "approved" as const } : e)),
    outcomes,
    changed: true,
  };
}
