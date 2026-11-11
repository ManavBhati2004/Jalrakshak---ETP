"use client";

import { useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, EyeOff, Phone, Mail, FileText, KeyRound, CheckCircle2, Circle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { DataTable } from "@/components/dashboard/data-table";
import { RegistrationDraftsPanel } from "@/components/dashboard/registration-drafts-panel";
import { RegistrationDetails } from "@/components/dashboard/registration-details";
import { RegistrationReviewBlock } from "@/components/dashboard/registration-review-block";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDataStore } from "@/lib/store/data";
import { resetUnitPassword } from "@/lib/store/accounts";
import { registrationStatusOf } from "@/lib/data/registration";
import { useRegistrationReviews } from "@/lib/hooks/use-registration-records";
import { PASSWORD_RULES, passwordMeetsRules } from "@/lib/password-rules";
import { REGISTRATION_STATUS_LABELS, type Industry, type RegistrationReview, type RegistrationStatus } from "@/lib/types";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { STATUS_COLOR, complianceStatus } from "@/lib/constants";

/** Registration status filters for the table. Drafts are listed in their own panel above it. */
const FILTERS = [
  { key: "all", label: "All" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
] as const;

export default function IndustriesPage() {
  return (
    <Suspense fallback={null}>
      <IndustriesView />
    </Suspense>
  );
}

function IndustriesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const industries = useDataStore((s) => s.industries);
  const reviews = useRegistrationReviews();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  // The id, not a copy: the dialog then always shows the unit as it is now (a decision, an edit).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A deep link (?focus=IND-###, from the search box or after an edit) opens that unit's dialog. The
  // parameter stays in the address while the dialog is open: the dashboard's page transition mounts
  // the page twice, and the second mount must still find it.
  const focusId = searchParams.get("focus");
  const openId = selectedId ?? focusId;
  const selected = openId ? (industries.find((i) => i.id === openId) ?? null) : null;
  const closeDialog = () => {
    setSelectedId(null);
    if (focusId) router.replace("/dashboard/industries", { scroll: false });
  };

  // Statuses only once the decisions are loaded: a decided unit must not flash as undecided.
  const statusOf = (i: Industry): RegistrationStatus | null => (reviews.loaded && !reviews.error ? registrationStatusOf(i, reviews.byUnit[i.id]) : null);
  const regCounts = useMemo(() => {
    const c: Record<RegistrationStatus, number> = { SUBMITTED: 0, APPROVED: 0, REJECTED: 0 };
    if (reviews.loaded && !reviews.error) for (const i of industries) c[registrationStatusOf(i, reviews.byUnit[i.id])]++;
    return c;
  }, [industries, reviews]);
  const filtered = useMemo(
    () => (filter === "all" || !reviews.loaded || reviews.error ? industries : industries.filter((i) => registrationStatusOf(i, reviews.byUnit[i.id]) === filter)),
    [industries, reviews, filter],
  );


  const counts = useMemo(
    () => ({
      active: industries.filter((i) => i.status === "active").length,
      pending: industries.filter((i) => i.status === "pending").length,
      suspended: industries.filter((i) => i.status === "suspended").length,
      nonReporting: industries.filter((i) => i.status === "non-reporting").length,
    }),
    [industries],
  );

  const columns: ColumnDef<Industry>[] = [
    {
      accessorKey: "name",
      header: "Company",
      cell: ({ row }) => (
        <div className="min-w-[180px]">
          <p className="font-semibold text-foreground">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.area}</p>
        </div>
      ),
    },
    {
      accessorKey: "cetpId",
      header: "Mapping",
      cell: ({ row }) =>
        row.original.isIndividualETP ? (
          <span className="rounded-md bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-400">Individual ETP</span>
        ) : (
          <span className="capitalize text-sm text-foreground">{row.original.cetpId}</span>
        ),
    },
    {
      accessorKey: "consentNumber",
      header: "Consent No.",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.consentNumber}</span>,
    },
    {
      accessorKey: "permittedKLD",
      header: "Permitted KLD",
      cell: ({ row }) => <span className="font-mono text-sm text-foreground">{formatNumber(row.original.permittedKLD)}</span>,
    },
    {
      accessorKey: "complianceScore",
      header: "Compliance",
      cell: ({ row }) => {
        const score = row.original.complianceScore;
        const color = STATUS_COLOR[complianceStatus(score)];
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
            </div>
            <span className="font-mono text-xs font-semibold" style={{ color }}>{score}%</span>
          </div>
        );
      },
    },
    {
      accessorKey: "registeredAt",
      header: "Registered",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDate(row.original.registeredAt, true)}
        </span>
      ),
    },
    {
      id: "registration",
      header: "Registration",
      accessorFn: (i) => {
        const s = statusOf(i);
        return s ? REGISTRATION_STATUS_LABELS[s] : "";
      },
      cell: ({ row }) => {
        const s = statusOf(row.original);
        return s ? <StatusBadge status={s.toLowerCase()} label={REGISTRATION_STATUS_LABELS[s]} /> : <span className="text-xs text-muted-foreground">…</span>;
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`/dashboard/industries/${encodeURIComponent(row.original.id)}/edit`}
            aria-label={`Edit registration of ${row.original.name}`}
            title="Edit registration"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedId(row.original.id)} aria-label={`View ${row.original.name}`}>
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Industry Management"
        description="All individual ETP textile units — consent, capacity and compliance at a glance."
        actions={
          <Button asChild className="h-10 gap-2 rounded-xl">
            <Link href="/dashboard/industries/register">
              <Plus className="h-4 w-4" />
              Register Member
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Chip label="Active" value={counts.active} tone="text-emerald-400" />
        <Chip label="Pending" value={counts.pending} tone="text-amber-400" />
        <Chip label="Suspended" value={counts.suspended} tone="text-red-400" />
        <Chip label="Non-Reporting" value={counts.nonReporting} tone="text-orange-400" />
      </div>

      <RegistrationDraftsPanel />

      {reviews.error ? (
        <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          Registration statuses could not be loaded, so they are not shown. Check your connection and reload the page.
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search company, area, consent…"
        toolbar={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by registration status">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
                {f.key !== "all" && reviews.loaded && !reviews.error ? ` (${regCounts[f.key]})` : ""}
              </button>
            ))}
          </div>
        }
      />

      <IndustryDialog
        industry={selected}
        review={selected ? (reviews.byUnit[selected.id] ?? null) : null}
        reviewsLoaded={reviews.loaded}
        reviewsFailed={reviews.error}
        onClose={closeDialog}
      />
    </div>
  );
}

function Chip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3 sm:p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-display text-xl font-bold sm:text-2xl", tone)}>{value}</p>
    </div>
  );
}

function IndustryDialog({
  industry,
  review,
  reviewsLoaded,
  reviewsFailed,
  onClose,
}: {
  industry: Industry | null;
  review: RegistrationReview | null;
  reviewsLoaded: boolean;
  reviewsFailed: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!industry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        {industry && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{industry.name}</DialogTitle>
            </DialogHeader>
            <RegistrationReviewBlock industry={industry} review={review} loaded={reviewsLoaded} failed={reviewsFailed} />
            <div className="flex items-center justify-between">
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">Owner</p>
                <p className="font-semibold text-foreground">{industry.ownerName}</p>
                <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                  <Phone className="h-3.5 w-3.5" /> {industry.mobile}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" /> {industry.email}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> {industry.consentNumber}
                </div>
              </div>
              <div className="shrink-0 text-center">
                <p className="font-display text-4xl font-bold leading-none" style={{ color: STATUS_COLOR[complianceStatus(industry.complianceScore)] }}>
                  {industry.complianceScore}%
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">compliance</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: "Permitted", v: `${formatNumber(industry.permittedKLD)} KLD` },
                { l: "ETP", v: `${formatNumber(industry.etpCapacity)} KLD` },
                { l: "RO", v: `${formatNumber(industry.roCapacity)} KLD` },
                { l: "MEE", v: `${formatNumber(industry.meeCapacity)} KLD` },
                { l: "Mapping", v: industry.isIndividualETP ? "Individual ETP" : (industry.cetpId ?? "—") },
                { l: "Alerts", v: String(industry.alertsCount) },
              ].map((s) => (
                <div key={s.l} className="rounded-xl border border-border bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.l}</p>
                  <p className="mt-0.5 text-sm font-semibold capitalize text-foreground">{s.v}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Registered</span>
              <span className="font-medium text-foreground">{formatDate(industry.registeredAt, true)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Last reading</span>
              <span className="font-medium text-foreground">{formatDate(industry.lastReadingAt, true)}</span>
            </div>

            <details className="group rounded-xl border border-border">
              <summary className="flex cursor-pointer list-none items-center justify-between p-3 text-sm font-medium text-foreground">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" /> Registration details
                </span>
                <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
                <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
              </summary>
              <div className="border-t border-border p-3">
                <RegistrationDetails industry={industry} />
              </div>
            </details>

            <ResetPasswordSection email={industry.email} industryId={industry.id} />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <StatusBadge status={industry.status} />
              <div className="flex gap-2">
                <Button asChild size="sm" variant="outline" className="gap-1.5 rounded-lg">
                  <Link href={`/dashboard/industries/${encodeURIComponent(industry.id)}/edit`}>
                    <Pencil className="h-3.5 w-3.5" /> Edit registration
                  </Link>
                </Button>
                <Button asChild size="sm" className="rounded-lg">
                  <Link href="/dashboard/etp">View ETP data</Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Admin-only reset of a unit's login password: a new password, typed twice. */
function ResetPasswordSection({ email, industryId }: { email: string; industryId: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);

  const checks = [
    ...PASSWORD_RULES.map((r) => ({ label: r.label, ok: r.ok(next) })),
    { label: "Both passwords match", ok: confirm !== "" && confirm === next },
  ];
  const ready = checks.every((c) => c.ok) && passwordMeetsRules(next);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const res = await resetUnitPassword({ industryId, newPassword: next });
    setBusy(false);
    if (!res.ok) {
      toast.error("Password reset failed", { description: res.error });
      return;
    }
    toast.success("Login password updated", { description: `New password set for ${res.email ?? email}. The unit's other sessions are signed out.` });
    setNext("");
    setConfirm("");
    setOpen(false);
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-sm font-medium text-foreground">
        <span className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" /> Reset login password
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Only the Monitoring Body can do this"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2.5">
          <p className="text-xs text-muted-foreground">
            Enter a new password for this unit&apos;s login (<span className="font-medium">{email}</span>) and type it again to confirm.
          </p>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              aria-label="New password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="New password"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:border-primary/50"
            />
            <button type="button" tabIndex={-1} onClick={() => setShowNew((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground" aria-label={showNew ? "Hide password" : "Show password"}>
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            aria-label="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
          <ul className="grid gap-1 sm:grid-cols-2">
            {checks.map((c) => (
              <li key={c.label} className={cn("flex items-center gap-1.5 text-xs", c.ok ? "text-emerald-600" : "text-muted-foreground")}>
                {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}
                {c.label}
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={submit} disabled={busy || !ready} className="w-full rounded-lg">
            {busy ? "Updating…" : "Update password"}
          </Button>
        </div>
      )}
    </div>
  );
}
