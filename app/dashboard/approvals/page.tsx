"use client";

import { useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ImageIcon, ImageOff, Camera, CheckCheck, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { ApprovalTimeline } from "@/components/dashboard/approval-timeline";
import { StatusBadge } from "@/components/shared/status-badge";
import { Icon } from "@/components/shared/icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { eligibleApprovalCandidates, type ApprovalCandidate, type CandidateOutcome } from "@/lib/data/approval-decisions";
import { approveAll, type BulkApproveReport } from "@/lib/data/tenant-ops";
import { syncContext } from "@/lib/data/firestore-storage";
import { useDataStore } from "@/lib/store/data";
import { useAuthStore } from "@/lib/store/auth";
import { ALERT_META, ROLES } from "@/lib/constants";
import { formatNumber, formatDate, cn, displayUnit } from "@/lib/utils";
import type { EtpEntry } from "@/lib/types";

const TABS = [
  { key: "queue", label: "Queue" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
] as const;

export default function ApprovalsPage() {
  const approvals = useDataStore((s) => s.approvals);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const decide = useDataStore((s) => s.decideApproval);
  const role = useAuthStore((s) => s.role);
  const reviewer = (ROLES.find((r) => r.id === role)?.name) ?? "Inspector";
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("queue");

  const filtered = useMemo(() => {
    const sorted = [...approvals].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    if (tab === "queue") return sorted.filter((a) => a.stage === "submitted" || a.stage === "verification");
    if (tab === "approved") return sorted.filter((a) => a.stage === "approved");
    if (tab === "rejected") return sorted.filter((a) => a.stage === "rejected");
    return sorted;
  }, [approvals, tab]);

  const counts = useMemo(
    () => ({
      queue: approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").length,
      approved: approvals.filter((a) => a.stage === "approved").length,
      rejected: approvals.filter((a) => a.stage === "rejected").length,
    }),
    [approvals],
  );

  // ---- Approve All ----
  // Every pending ETP-entry approval this officer can see. There is no pagination and no unit
  // filter on this page, so that is the whole authorised queue, not just what is on screen.
  const eligible = useMemo(() => eligibleApprovalCandidates(approvals, etpEntries), [approvals, etpEntries]);
  const [confirmSet, setConfirmSet] = useState<ApprovalCandidate[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  // A ref, not state: a second click can land before the re-render that disables the button.
  const bulkInFlight = useRef(false);
  const [bulkRun, setBulkRun] = useState<{ report: BulkApproveReport; candidates: ApprovalCandidate[] } | null>(null);
  // While the dialog is open the queue can move. Say so, rather than silently widening the set.
  const arrivedSince = confirmSet ? eligible.filter((c) => !confirmSet.some((x) => x.approvalId === c.approvalId)).length : 0;
  const changedSince = confirmSet
    ? confirmSet.filter((c) => !eligible.some((x) => x.approvalId === c.approvalId && x.revision === c.revision)).length
    : 0;

  const openApproveAll = () => {
    // The store briefly holds placeholder data before the live load lands; never act on that.
    if (!syncContext.ready) {
      toast.info("Still loading the latest data", { description: "Try again in a moment." });
      return;
    }
    // Snapshot the exact set now. Anything submitted while the dialog is open is NOT added.
    setConfirmSet(eligible);
  };

  const runApproveAll = async () => {
    if (!confirmSet || bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    const candidates = confirmSet;
    const report = await approveAll(candidates, reviewer);
    bulkInFlight.current = false;
    setBulkBusy(false);
    const total = candidates.length;
    setConfirmSet(null);
    setBulkRun({ report, candidates });
    const failedCount = report.failed.reduce((n, f) => n + f.count, 0);
    if (failedCount === 0 && report.skipped.length === 0) {
      toast.success(`Approved ${report.approved.length} ${report.approved.length === 1 ? "entry" : "entries"}`, { description: `by ${reviewer}` });
    } else {
      toast.warning(`Approved ${report.approved.length} of ${total}`, {
        description: `${report.skipped.length} skipped, ${failedCount} failed. See the summary above the queue.`,
      });
    }
  };

  /**
   * Retry only the units that failed, with the candidates confirmed for them. Safe to repeat: each
   * is re-checked at write time, so anything that did go through is skipped, never approved twice.
   */
  const retryFailed = async () => {
    if (!bulkRun || bulkInFlight.current) return;
    const failedUnits = new Set(bulkRun.report.failed.map((f) => f.industryId));
    const again = bulkRun.candidates.filter((c) => failedUnits.has(c.industryId));
    if (!again.length) return;
    bulkInFlight.current = true;
    setBulkBusy(true);
    const retry = await approveAll(again, reviewer);
    bulkInFlight.current = false;
    setBulkBusy(false);
    setBulkRun({
      candidates: bulkRun.candidates,
      report: {
        approved: [...bulkRun.report.approved, ...retry.approved],
        skipped: [...bulkRun.report.skipped, ...retry.skipped],
        failed: retry.failed,
      },
    });
    const stillFailed = retry.failed.reduce((n, f) => n + f.count, 0);
    if (stillFailed) toast.warning(`${stillFailed} still not approved`, { description: "See the summary above the queue." });
    else toast.success(`Retry approved ${retry.approved.length}`, { description: retry.skipped.length ? `${retry.skipped.length} skipped` : `by ${reviewer}` });
  };

  const unitsIn = (set: ApprovalCandidate[]) => new Set(set.map((c) => c.industryId)).size;

  const handle = (id: string, name: string, decision: "approved" | "rejected") => {
    decide(id, decision, reviewer);
    toast[decision === "approved" ? "success" : "error"](
      decision === "approved" ? "Reading approved" : "Reading rejected",
      { description: `${name} · by ${reviewer}` },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="Approval Workflow"
        description="Verify submitted readings against photos, differences and auto-raised alerts before they enter the compliance record."
        actions={
          tab === "queue" ? (
            <Button
              onClick={openApproveAll}
              disabled={eligible.length === 0 || bulkBusy}
              className="h-10 gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-600/90"
            >
              <CheckCheck className="h-4 w-4" /> {bulkBusy ? "Approving…" : `Approve All (${eligible.length})`}
            </Button>
          ) : null
        }
      />

      {bulkRun ? (
        <BulkResult
          report={bulkRun.report}
          labelOf={(o) => {
            const a = approvals.find((x) => x.id === o.approvalId);
            const e = a ? etpEntries.find((x) => x.id === a.readingId) : undefined;
            return `${a?.industryName ?? o.industryId}${e ? ` · ${formatDate(e.date)}` : ""}`;
          }}
          busy={bulkBusy}
          onRetry={retryFailed}
          onDismiss={() => setBulkRun(null)}
        />
      ) : null}

      <Dialog open={!!confirmSet} onOpenChange={(o) => !o && !bulkBusy && setConfirmSet(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve all pending ETP entries?</DialogTitle>
            <DialogDescription>
              Approve all {confirmSet?.length ?? 0} eligible pending ETP daily {confirmSet?.length === 1 ? "entry" : "entries"} across{" "}
              {confirmSet ? unitsIn(confirmSet) : 0} {confirmSet && unitsIn(confirmSet) === 1 ? "unit" : "units"}? This covers every pending ETP daily entry in
              the queue, not only those on screen, from all units. Flow-meter readings are not included. Entries submitted or changed after you opened
              this are left for individual review.
            </DialogDescription>
          </DialogHeader>
          {arrivedSince || changedSince ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
              {arrivedSince ? `${arrivedSince} more ${arrivedSince === 1 ? "entry has" : "entries have"} arrived since you opened this and ${arrivedSince === 1 ? "is" : "are"} not included. ` : ""}
              {changedSince ? `${changedSince} ${changedSince === 1 ? "entry has" : "entries have"} changed or been handled since and will be skipped.` : ""}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" disabled={bulkBusy} onClick={() => setConfirmSet(null)}>
              Cancel
            </Button>
            <Button className="gap-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90" disabled={bulkBusy || !confirmSet?.length} onClick={runApproveAll}>
              <CheckCheck className="h-4 w-4" /> {bulkBusy ? "Approving…" : "Approve All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="rounded-full bg-current/15 px-1.5 text-xs font-bold">
                {t.key === "queue" ? counts.queue : t.key === "approved" ? counts.approved : counts.rejected}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((a) => {
            const decided = a.stage === "approved" || a.stage === "rejected";
            return (
              <motion.div
                layout
                key={a.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.35 }}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-foreground">{a.industryName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.meterPoint} · {formatDate(a.submittedAt, true)}
                    </p>
                  </div>
                  <StatusBadge status={a.stage} />
                </div>

                {/* reading photo + difference */}
                <div className="mt-4 flex items-stretch gap-3">
                  <div className={cn("flex h-20 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border", a.hasPhoto ? "border-border bg-muted/40 text-muted-foreground" : "border-dashed border-amber-500/40 bg-amber-500/5 text-amber-400")}>
                    {a.hasPhoto ? <ImageIcon className="h-6 w-6" /> : <ImageOff className="h-6 w-6" />}
                    <span className="text-[10px] font-medium">{a.hasPhoto ? "Photo" : "No photo"}</span>
                  </div>
                  <div className="flex flex-1 flex-col justify-center rounded-xl border border-border bg-muted/30 px-4">
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className="font-mono text-2xl font-bold text-primary">
                      {formatNumber(a.difference)} <span className="text-sm font-medium text-muted-foreground">{displayUnit(a.unit)}</span>
                    </p>
                  </div>
                </div>

                {/* alerts */}
                {a.alerts.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {a.alerts.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${ALERT_META[t].color}1a`, color: ALERT_META[t].color }}>
                        <Icon name={ALERT_META[t].icon} className="h-3 w-3" />
                        {ALERT_META[t].label}
                      </span>
                    ))}
                  </div>
                )}

                {a.remarks && <p className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">“{a.remarks}”</p>}

                {/* timeline */}
                <div className="mt-4 border-t border-border pt-4">
                  <ApprovalTimeline steps={a.timeline} />
                </div>

                {/* actions */}
                {!decided ? (
                  <div className="mt-4 flex gap-2">
                    <Button disabled={bulkBusy} onClick={() => handle(a.id, a.industryName, "approved")} className="h-10 flex-1 gap-1.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-600/90">
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                    <Button disabled={bulkBusy} onClick={() => handle(a.id, a.industryName, "rejected")} variant="outline" className="h-10 flex-1 gap-1.5 rounded-xl border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-400">
                      <X className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {a.stage === "approved" ? "Approved" : "Rejected"} by{" "}
                      <span className="font-semibold text-foreground">{a.reviewer}</span> · {formatDate(a.reviewedAt, true)}
                    </p>
                    <AmendedAfter approvalId={a.id} entry={etpEntries.find((e) => e.id === a.readingId)} />
                  </>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
          <Camera className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nothing here — the queue is clear.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Sludge & Salt changes made after this decision. Status is deliberately not changed by an amendment,
 * so this note is what keeps the earlier decision from reading as covering new figures. Each record
 * names the approval it was made under and that approval's stage at the time (read from the server
 * inside the saving transaction), so no device clock decides what came "after".
 */
function AmendedAfter({ approvalId, entry }: { approvalId: string; entry?: EtpEntry }) {
  const after = (entry?.ledgerEdits ?? []).filter(
    (x) => x.approvalId === approvalId && (x.approvalStage === "approved" || x.approvalStage === "rejected"),
  );
  const edits = after.filter((x) => x.kind === "edit");
  const carried = after.filter((x) => x.kind === "carried");
  if (after.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {edits.length ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700">
          <PencilLine className="h-3.5 w-3.5 shrink-0" />
          Sludge &amp; Salt amended after this decision · {formatDate(edits[edits.length - 1].at, true)}
          {edits.length > 1 ? ` (${edits.length} amendments)` : ""}
        </p>
      ) : null}
      {carried.length ? (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700">
          <PencilLine className="h-3.5 w-3.5 shrink-0" />
          Sludge &amp; Salt balances recalculated after this decision (earlier day {formatDate(carried[carried.length - 1].sourceDate ?? null)} amended)
        </p>
      ) : null}
    </div>
  );
}

/** The outcome of an Approve All run - never claims success for what failed or was skipped. */
function BulkResult({
  report,
  labelOf,
  busy,
  onRetry,
  onDismiss,
}: {
  report: BulkApproveReport;
  labelOf: (o: CandidateOutcome) => string;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const failedCount = report.failed.reduce((n, f) => n + f.count, 0);
  const clean = failedCount === 0 && report.skipped.length === 0;
  return (
    <div className={cn("rounded-2xl border p-4 text-sm", clean ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/40 bg-amber-500/5")}>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-foreground">
          Approve All: {report.approved.length} approved · {report.skipped.length} skipped · {failedCount} failed
        </p>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 rounded-lg">
          Dismiss
        </Button>
      </div>
      {report.skipped.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {report.skipped.map((o) => (
            <li key={o.approvalId}>
              Skipped {labelOf(o)}: {o.result === "skipped" ? o.reason : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {report.failed.length ? (
        <ul className="mt-2 space-y-0.5 text-xs text-red-600">
          {report.failed.map((f) => (
            <li key={f.industryId}>
              {f.count} {f.count === 1 ? "entry" : "entries"} for {f.industryId} not approved: {f.error} They are still in the queue.
            </li>
          ))}
        </ul>
      ) : null}
      {report.failed.length ? (
        <Button variant="outline" size="sm" onClick={onRetry} disabled={busy} className="mt-2 h-8 rounded-lg">
          {busy ? "Retrying…" : "Retry failed"}
        </Button>
      ) : null}
    </div>
  );
}
