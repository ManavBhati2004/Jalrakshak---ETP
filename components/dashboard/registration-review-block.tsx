"use client";

import { useState } from "react";
import Link from "next/link";
import { BadgeCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { decideRegistration } from "@/lib/data/registration-ops";
import { registrationStatusOf } from "@/lib/data/registration";
import { REGISTRATION_STATUS_LABELS, type Industry, type RegistrationReview } from "@/lib/types";
import { formatDate } from "@/lib/utils";

/**
 * A unit's registration status, its latest decision, and - for a submitted registration - Approve
 * and Reject. Rejecting needs a remark; a rejected registration is corrected and resubmitted from
 * the edit form.
 */
export function RegistrationReviewBlock({
  industry,
  review,
  loaded,
  failed,
}: {
  industry: Industry;
  review: RegistrationReview | null;
  loaded: boolean;
  failed: boolean;
}) {
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const status = loaded && !failed ? registrationStatusOf(industry, review) : null;

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    if (decision === "REJECTED" && !remark.trim()) {
      toast.error("Give the reason for rejecting it", { description: "The remark is kept with the decision." });
      return;
    }
    setBusy(decision);
    const res = await decideRegistration(industry.id, decision, remark);
    setBusy(null);
    if (!res.ok) {
      toast.error(decision === "APPROVED" ? "Registration not approved" : "Registration not rejected", { description: res.error });
      return;
    }
    setRemark("");
    toast.success(decision === "APPROVED" ? "Registration approved" : "Registration rejected", {
      description: decision === "APPROVED" ? `${industry.name} is now active.` : `${industry.name} can be corrected and resubmitted.`,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <BadgeCheck className="h-4 w-4 text-primary" /> Registration
        </p>
        {status ? (
          <StatusBadge status={status.toLowerCase()} label={REGISTRATION_STATUS_LABELS[status]} />
        ) : (
          <span className="text-xs text-muted-foreground">{failed ? "Status could not be loaded" : "Loading…"}</span>
        )}
      </div>
      {review ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {REGISTRATION_STATUS_LABELS[review.status]} {formatDate(review.at || null, true)}
          {review.byEmail ? ` by ${review.byEmail}` : ""}
          {review.remark ? <span className="mt-1 block whitespace-pre-wrap text-foreground">“{review.remark}”</span> : null}
        </p>
      ) : status ? (
        <p className="mt-2 text-xs text-muted-foreground">No decision on record yet.</p>
      ) : null}

      {status === "SUBMITTED" ? (
        <div className="mt-3 space-y-2">
          <textarea
            value={remark}
            onChange={(e) => setRemark(e.target.value.slice(0, 500))}
            rows={2}
            aria-label={`Remark on the registration of ${industry.name}`}
            placeholder="Remark (required to reject)"
            className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => void decide("APPROVED")} className="flex-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-600/90">
              {busy === "APPROVED" ? "Approving…" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void decide("REJECTED")} className="flex-1 rounded-lg text-red-600 hover:text-red-600">
              {busy === "REJECTED" ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </div>
      ) : null}
      {status === "REJECTED" ? (
        <Button asChild size="sm" variant="outline" className="mt-3 w-full gap-1.5 rounded-lg">
          <Link href={`/dashboard/industries/${encodeURIComponent(industry.id)}/edit`}>
            <Pencil className="h-3.5 w-3.5" /> Correct and resubmit
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
