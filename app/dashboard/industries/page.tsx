"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, Phone, Mail, FileText } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { DataTable } from "@/components/dashboard/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDataStore } from "@/lib/store/data";
import type { Industry } from "@/lib/types";
import { formatNumber, formatDate, cn } from "@/lib/utils";
import { STATUS_COLOR, complianceStatus } from "@/lib/constants";

const FILTERS = [
  { key: "all", label: "All" },
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const [selected, setSelected] = useState<Industry | null>(null);

  const filtered = useMemo(() => industries, [industries]);

  // Deep-link from the topbar search (?focus=IND-###) → open that unit's detail.
  useEffect(() => {
    const focus = searchParams.get("focus");
    if (!focus) return;
    const ind = industries.find((i) => i.id === focus);
    if (ind) {
      setSelected(ind);
      router.replace("/dashboard/industries", { scroll: false });
    }
  }, [searchParams, industries, router]);

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
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelected(row.original)}>
          <Eye className="h-4 w-4" />
        </Button>
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

      <DataTable
        columns={columns}
        data={filtered}
        searchPlaceholder="Search company, area, consent…"
        toolbar={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <IndustryDialog industry={selected} onClose={() => setSelected(null)} />
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

function IndustryDialog({ industry, onClose }: { industry: Industry | null; onClose: () => void }) {
  return (
    <Dialog open={!!industry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {industry && (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{industry.name}</DialogTitle>
            </DialogHeader>
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
            <div className="flex items-center justify-between">
              <StatusBadge status={industry.status} />
              <Button asChild size="sm" className="rounded-lg">
                <Link href="/dashboard/etp">View ETP data</Link>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
