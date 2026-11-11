"use client";

import { useState } from "react";
import Link from "next/link";
import { FilePenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { deleteRegistrationDraft } from "@/lib/data/registration-ops";
import { draftProgress } from "@/lib/data/registration";
import { useRegistrationDrafts } from "@/lib/hooks/use-registration-records";
import type { RegistrationDraft } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/** Unfinished registrations, shared by every Monitoring Body officer: continue or delete one. */
export function RegistrationDraftsPanel() {
  const { drafts, loaded, error } = useRegistrationDrafts();
  const [deleting, setDeleting] = useState<RegistrationDraft | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loaded || (!error && drafts.length === 0)) return null;

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const ok = await deleteRegistrationDraft(deleting.id);
    setBusy(false);
    if (!ok) {
      toast.error("Draft not deleted", { description: "Check your connection and try again." });
      return;
    }
    toast.success("Draft deleted", { description: deleting.title });
    setDeleting(null);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-display text-base font-bold text-foreground">
        <FilePenLine className="h-4 w-4 text-primary" /> Registration drafts {error ? null : <span className="text-sm font-medium text-muted-foreground">({drafts.length})</span>}
      </h3>
      {error ? (
        <p className="mt-2 text-sm text-red-600">Drafts could not be loaded. Check your connection and reload the page.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {drafts.map((d) => {
            const p = draftProgress(d.data);
            return (
              <li key={d.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                    <span className="truncate">{d.title}</span>
                    <StatusBadge status="draft" label="Draft" />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.data.misId ? `MIS ID ${d.data.misId} · ` : ""}
                    {p.filled} of {p.total} fields filled · last saved {formatDate(d.updatedAt || null, true)}
                    {d.updatedByEmail ? ` by ${d.updatedByEmail}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild size="sm" className="rounded-lg">
                    <Link href={`/dashboard/industries/register?draft=${encodeURIComponent(d.id)}`}>Continue</Link>
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 rounded-lg text-red-600 hover:text-red-600" onClick={() => setDeleting(d)} aria-label={`Delete draft ${d.title}`}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && !busy && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Delete this draft?</DialogTitle>
            <DialogDescription>
              {deleting?.title}: the saved details are removed for every officer. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" className="rounded-lg" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button className="gap-1.5 rounded-lg bg-red-600 text-white hover:bg-red-600/90" disabled={busy} onClick={() => void remove()}>
              <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
