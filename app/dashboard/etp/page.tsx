"use client";

import { useMemo, useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { Droplets, Recycle, Waves, ChevronRight, ArrowLeft, Download, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { DataTable } from "@/components/dashboard/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/lib/store/data";
import { buildEtpStageFlow } from "@/lib/data/etp-flow";
import { STATUS_COLOR, complianceStatus } from "@/lib/constants";
import { formatNumber, formatDate, toCSV, stampedName } from "@/lib/utils";
import type { EtpEntry, Industry } from "@/lib/types";

export default function IndividualEtpPage() {
  const industries = useDataStore((s) => s.industries);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const etps = industries.filter((i) => i.isIndividualETP);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const latestByIndustry = useMemo(() => {
    const map: Record<string, EtpEntry | undefined> = {};
    for (const e of [...etpEntries].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
      map[e.industryId] = e; // last write wins → latest
    }
    return map;
  }, [etpEntries]);

  const selected = selectedId ? etps.find((i) => i.id === selectedId) ?? null : null;

  if (selected) {
    return <EtpDetail ind={selected} entries={etpEntries} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Individual ETP Units"
        description="Industries operating their own Effluent Treatment Plants. Select a unit to view its capacities, treatment pipeline, reading history and report."
      />

      {etps.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No individual ETP units registered.
        </div>
      ) : (
        <div className="space-y-2.5">
          {etps.map((ind) => {
            const latest = latestByIndustry[ind.id];
            const count = etpEntries.filter((e) => e.industryId === ind.id).length;
            const color = STATUS_COLOR[complianceStatus(ind.complianceScore)];
            return (
              <button
                key={ind.id}
                onClick={() => setSelectedId(ind.id)}
                className="group flex w-full items-center gap-4 rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-500">
                  <Droplets className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-display text-base font-bold text-foreground">{ind.name}</h3>
                    <span className="hidden rounded-md bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-500 sm:inline">
                      Individual ETP
                    </span>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{ind.area}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusBadge status={ind.status} />
                    <span className="text-xs text-muted-foreground">
                      {count} reading{count === 1 ? "" : "s"}
                    </span>
                    <span className="text-xs text-muted-foreground">Last: {latest ? formatDate(latest.date) : "—"}</span>
                  </div>
                </div>
                <div className="hidden flex-col items-end sm:flex">
                  <span className="font-mono text-lg font-bold" style={{ color }}>
                    {ind.complianceScore}%
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">compliance</span>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EtpDetail({ ind, entries, onBack }: { ind: Industry; entries: EtpEntry[]; onBack: () => void }) {
  const color = STATUS_COLOR[complianceStatus(ind.complianceScore)];

  const mine = useMemo(
    () => entries.filter((e) => e.industryId === ind.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [entries, ind.id],
  );
  const latest = mine[0];
  const approved = mine.filter((e) => e.status === "approved").length;
  const pending = mine.filter((e) => e.status === "pending").length;
  const rejected = mine.filter((e) => e.status === "rejected").length;

  const caps = [
    { l: "Permitted", v: ind.permittedKLD },
    { l: "ETP", v: ind.etpCapacity },
    { l: "Max Effluent", v: ind.maxEffluentGeneration ?? ind.permittedKLD },
    { l: "MEE", v: ind.meeCapacity },
    { l: "RO I", v: ind.roStage1 ?? ind.roCapacity },
    { l: "RO II", v: ind.roStage2 ?? 0 },
    { l: "RO III", v: ind.roStage3 ?? 0 },
    { l: "RO IV", v: ind.roStage4 ?? 0 },
  ];

  const columns: ColumnDef<EtpEntry>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap text-sm text-foreground">{formatDate(row.original.date)}</span> },
    { accessorKey: "freshWaterConsumption", header: "Fresh Water", cell: ({ row }) => <NumCell v={row.original.freshWaterConsumption} /> },
    { accessorKey: "etpInlet", header: "ETP Inlet", cell: ({ row }) => <NumCell v={row.original.etpInlet} /> },
    { accessorKey: "etpOutlet", header: "ETP Outlet", cell: ({ row }) => <NumCell v={row.original.etpOutlet} /> },
    { accessorKey: "etpReuse", header: "ETP Reuse", cell: ({ row }) => <NumCell v={row.original.etpReuse} /> },
    { accessorKey: "roInlet", header: "RO Inlet", cell: ({ row }) => <NumCell v={row.original.roInlet} /> },
    { accessorKey: "roReject", header: "RO Reject", cell: ({ row }) => <NumCell v={row.original.roReject} /> },
    { accessorKey: "roPermeate", header: "RO Permeate", cell: ({ row }) => <NumCell v={row.original.roPermeate} /> },
    { accessorKey: "sludgeToTSDF", header: "Sludge→TSDF", cell: ({ row }) => <NumCell v={row.original.sludgeToTSDF} /> },
    {
      accessorKey: "totalWaterIntake",
      header: "Total Intake",
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-sm font-bold text-foreground">
          {formatNumber(row.original.totalWaterIntake)} <span className="text-xs font-normal text-muted-foreground">m³</span>
        </span>
      ),
    },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ];

  const handleDownload = () => {
    if (!mine.length) return;
    const rows = mine.map((e) => ({
      Date: e.date,
      "Fresh Water (m³)": e.freshWaterConsumption,
      "ETP Inlet (m³)": e.etpInlet,
      "ETP Outlet (m³)": e.etpOutlet,
      "ETP Reuse (m³)": e.etpReuse,
      "RO Inlet (m³)": e.roInlet,
      "RO Reject (m³)": e.roReject,
      "RO Permeate (m³)": e.roPermeate,
      "Sludge to TSDF (m³)": e.sludgeToTSDF,
      "Total Water Intake (m³)": e.totalWaterIntake,
      Status: e.status,
      "Submitted At": e.submittedAt,
    }));
    download(stampedName(`jalrakshak-etp-${ind.id}`), toCSV(rows));
    toast.success("ETP report exported", { description: `${rows.length} reading(s) · ${ind.name}` });
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> All ETP Units
      </button>

      {/* detail card (same UI as before) */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-500">
              <Droplets className="h-5 w-5" />
            </span>
            <h3 className="mt-3 font-display text-lg font-bold text-foreground">{ind.name}</h3>
            <p className="text-sm text-muted-foreground">{ind.area}</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge status={ind.status} />
              <span className="rounded-md bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-500">Individual ETP</span>
            </div>
          </div>
          <div className="shrink-0 text-center">
            <p className="font-display text-4xl font-bold leading-none" style={{ color }}>{ind.complianceScore}%</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">compliance</p>
          </div>
        </div>

        {/* capacities (KLD) */}
        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Capacities (KLD)</p>
        <div className="mt-1.5 grid grid-cols-4 gap-2">
          {caps.map((s) => (
            <div key={s.l} className="rounded-xl border border-border bg-muted/30 p-2 text-center">
              <p className="font-mono text-sm font-bold text-foreground">{formatNumber(s.v)}</p>
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{s.l}</p>
            </div>
          ))}
        </div>

        {/* latest water balance (m³) */}
        <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Waves className="h-3.5 w-3.5 text-primary" /> Latest Water Balance
            </p>
            <span className="text-[10px] text-muted-foreground">{latest ? formatDate(latest.date) : "No entry"}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Total Intake" value={latest?.totalWaterIntake} accent="#0d9488" />
            <Mini label="ETP Reuse" value={latest?.etpReuse} accent="#10b981" />
            <Mini label="RO Permeate" value={latest?.roPermeate} accent="#6366f1" />
            <Mini label="Sludge→TSDF" value={latest?.sludgeToTSDF} accent="#a78bfa" />
          </div>
        </div>

        <div className="mt-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Recycle className="h-4 w-4 text-primary" /> Treatment Pipeline
          </p>
          <PipelineFlow flow={buildEtpStageFlow(ind)} />
        </div>
      </div>

      {/* reading history & report */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
              <ClipboardList className="h-5 w-5 text-primary" /> Reading History &amp; Report
            </h3>
            <p className="text-sm text-muted-foreground">Every water-balance reading filed earlier by this unit.</p>
          </div>
          <Button onClick={handleDownload} disabled={mine.length === 0} variant="outline" className="h-10 shrink-0 gap-2 rounded-xl">
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>

        {/* report summary */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryStat label="Total Readings" value={mine.length} accent="#0d9488" />
          <SummaryStat label="Approved" value={approved} accent="#10b981" />
          <SummaryStat label="Pending" value={pending} accent="#f59e0b" />
          <SummaryStat label="Rejected" value={rejected} accent="#ef4444" />
        </div>

        {/* history table */}
        <div className="mt-5">
          <DataTable
            columns={columns}
            data={mine}
            searchPlaceholder="Search readings…"
            pageSize={8}
            emptyMessage="No readings filed yet."
          />
        </div>
      </div>
    </div>
  );
}

function NumCell({ v }: { v: number }) {
  return (
    <span className="whitespace-nowrap font-mono text-sm text-foreground">
      {formatNumber(v)} <span className="text-xs font-normal text-muted-foreground">m³</span>
    </span>
  );
}

function Mini({ label, value, accent }: { label: string; value?: number; accent: string }) {
  return (
    <div className="rounded-lg bg-card p-2 text-center">
      <p className="font-mono text-sm font-bold" style={{ color: accent }}>
        {value != null ? formatNumber(value) : "—"}
      </p>
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label} (m³)</p>
    </div>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 text-center">
      <p className="font-mono text-2xl font-bold" style={{ color: accent }}>
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

/* ---- local CSV download helper ---- */
function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
