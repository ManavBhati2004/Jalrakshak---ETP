"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Plus, Gauge, Clock, Droplets, Waves, Recycle, ArrowRight, Trash2, ClipboardList, Download } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { DataTable } from "@/components/dashboard/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Icon } from "@/components/shared/icon";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore, dailyIntake, etpEntryExportRows } from "@/lib/store/data";
import { buildEtpStageFlow } from "@/lib/data/etp-flow";
import { STATUS_COLOR, complianceStatus, ALERT_META } from "@/lib/constants";
import { formatNumber, formatDate, timeAgo, toCSV, stampedName } from "@/lib/utils";
import type { EtpEntry } from "@/lib/types";

export function EtpOverview() {
  const industryId = useAuthStore((s) => s.industryId);
  const industries = useDataStore((s) => s.industries);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const alerts = useDataStore((s) => s.alerts);
  const compliance = useDataStore((s) => s.compliance);

  const industry = industries.find((i) => i.id === industryId);

  const mine = useMemo(
    () => etpEntries.filter((e) => e.industryId === industryId).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [etpEntries, industryId],
  );
  const latest = mine[0];
  // Time-synced by calendar date: "today" becomes "yesterday" automatically when
  // the day rolls over. Compute the date client-side (avoids hydration mismatch),
  // matching how entries build their local YYYY-MM-DD date.
  const [todayStr, setTodayStr] = useState("");
  useEffect(() => {
    const n = new Date();
    const p = (x: number) => String(x).padStart(2, "0");
    setTodayStr(`${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`);
  }, []);
  const yesterdayStr = useMemo(() => {
    if (!todayStr) return "";
    const d = new Date(todayStr + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const p = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, [todayStr]);
  const intake = dailyIntake(mine, todayStr, yesterdayStr);
  const myAlerts = alerts.filter((a) => a.industryId === industryId && a.status === "active").slice(0, 5);
  const pending = mine.filter((e) => e.status === "pending").length;
  const myCompliance = compliance.find((c) => c.industryId === industryId);

  if (!industry) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-lg font-semibold text-foreground">No ETP unit linked to this session</p>
        <Link href="/login" className="text-sm font-semibold text-primary hover:underline">Sign in or register your unit</Link>
      </div>
    );
  }

  const color = STATUS_COLOR[complianceStatus(industry.complianceScore)];

  const balance = [
    { label: "Fresh Water", value: latest?.freshWaterConsumption, unit: "m³", icon: Droplets, accent: "#0ea5e9" },
    { label: "ETP Reuse", value: latest?.etpReuse, unit: "m³", icon: Recycle, accent: "#10b981" },
    { label: "RO Permeate", value: latest?.roPermeate, unit: "m³", icon: Waves, accent: "#6366f1" },
    { label: "RO Reject", value: latest?.roReject, unit: "m³", icon: Waves, accent: "#f59e0b" },
    { label: "Grand Total", value: latest?.waterGrandTotal, unit: "m³", icon: Gauge, accent: "#0d9488" },
    { label: "Sludge Gen", value: latest?.sludge?.generation, unit: "kg", icon: Trash2, accent: "#a78bfa" },
  ];

  const columns: ColumnDef<EtpEntry>[] = [
    { accessorKey: "date", header: "Date", cell: ({ row }) => <span className="whitespace-nowrap text-sm text-foreground">{formatDate(row.original.date)}</span> },
    { accessorKey: "freshWaterConsumption", header: "Fresh Water", cell: ({ row }) => <Num v={row.original.freshWaterConsumption} /> },
    { accessorKey: "etpInlet", header: "ETP Inlet", cell: ({ row }) => <Num v={row.original.etpInlet} /> },
    { accessorKey: "etpReuse", header: "ETP Reuse", cell: ({ row }) => <Num v={row.original.etpReuse} /> },
    { accessorKey: "roInlet", header: "RO Feed", cell: ({ row }) => <Num v={row.original.roInlet} /> },
    { accessorKey: "roReject", header: "RO Reject", cell: ({ row }) => <Num v={row.original.roReject} /> },
    { accessorKey: "roPermeate", header: "RO Permeate", cell: ({ row }) => <Num v={row.original.roPermeate} /> },
    { accessorKey: "waterGrandTotal", header: "Grand Total", cell: ({ row }) => <Num v={row.original.waterGrandTotal ?? 0} /> },
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
    const rows = etpEntryExportRows(mine);
    download(stampedName(`jalrakshak-etp-${industry.id}`), toCSV(rows));
    toast.success("ETP report exported", { description: `${rows.length} reading(s) · ${industry.name}` });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="ETP Industry · Daily water balance"
        title={industry.name}
        description={`${industry.area} · Consent ${industry.consentNumber}`}
        actions={
          <Button asChild className="h-10 gap-2 rounded-xl">
            <Link href="/dashboard/etp-entry">
              <Plus className="h-4 w-4" /> Add Today&apos;s Entry
            </Link>
          </Button>
        }
      />

      {/* unit header + quick stats */}
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 sm:gap-5 sm:p-6">
          <div className="shrink-0 text-center">
            <p className="font-display text-4xl font-bold leading-none" style={{ color }}>{industry.complianceScore}%</p>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">compliance</p>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge status={industry.status} />
              <span className="rounded-md bg-teal-500/10 px-2 py-0.5 text-xs font-medium text-teal-500">Individual ETP</span>
            </div>
            <p className="mt-2 font-display text-lg font-bold text-foreground">Permitted {formatNumber(industry.permittedKLD)} KLD</p>
            <p className="text-sm text-muted-foreground">Last entry {formatDate(industry.lastReadingAt, true)}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Stat icon={<Gauge className="h-4 w-4" />} label="My Entries" value={mine.length} accent="#0d9488" />
          <Stat icon={<Clock className="h-4 w-4" />} label="Pending" value={pending} accent="#f59e0b" />
          <Stat icon={<Waves className="h-4 w-4" />} label="Alerts" value={myAlerts.length} accent="#ef4444" />
        </div>
      </div>

      {/* total water intake + today-vs-yesterday + balance */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Water Intake (latest)</p>
          <p className="mt-2 font-mono text-4xl font-bold text-primary">
            {latest ? formatNumber(latest.totalWaterIntake) : "—"} <span className="text-base font-medium text-muted-foreground">m³</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">= Fresh Water + ETP Reuse + RO Permeate</p>
          {latest && <p className="mt-3 text-xs text-muted-foreground">Recorded {formatDate(latest.date)}</p>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Water Intake</p>
          <div className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Today</span>
              <span className="font-mono font-bold text-foreground">
                {formatNumber(intake.today)} <span className="text-xs font-normal text-muted-foreground">m³</span>
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Yesterday</span>
              <span className="font-mono font-bold text-foreground">
                {formatNumber(intake.yesterday)} <span className="text-xs font-normal text-muted-foreground">m³</span>
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2.5">
              <span className="text-muted-foreground">Difference</span>
              <span className="font-mono font-bold text-foreground">
                {intake.difference > 0 ? "+" : intake.difference < 0 ? "−" : ""}
                {formatNumber(Math.abs(intake.difference))} <span className="text-xs font-normal text-muted-foreground">m³</span>
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {balance.map((b) => (
            <div key={b.label} className="rounded-2xl border border-border bg-card p-4">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${b.accent}1f`, color: b.accent }}>
                {b.icon ? <b.icon className="h-4 w-4" /> : <Droplets className="h-4 w-4" />}
              </span>
              <p className="mt-3 font-mono text-xl font-bold text-foreground sm:text-2xl">
                {b.value != null ? formatNumber(b.value) : "—"} <span className="text-xs font-medium text-muted-foreground">{b.unit}</span>
              </p>
              <p className="text-xs text-muted-foreground">{b.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ETP pipeline */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Droplets className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold text-foreground">My Treatment Pipeline</h3>
        </div>
        <PipelineFlow flow={buildEtpStageFlow(industry)} />
      </div>

      {/* alerts */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-display text-lg font-bold text-foreground">My Alerts</h3>
        <div className="mt-4 space-y-2.5">
          {myAlerts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No active alerts — keep it up!</p>
          ) : (
            myAlerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ALERT_META[a.type].color}1f`, color: ALERT_META[a.type].color }}>
                  <Icon name={ALERT_META[a.type].icon} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.message}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{timeAgo(a.createdAt)}</p>
                </div>
                <StatusBadge status={a.severity} dot={false} />
              </div>
            ))
          )}
        </div>
        {myCompliance && (
          <Link href="/dashboard/etp-entry" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            Record today&apos;s water balance <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* reading history & report */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
              <ClipboardList className="h-5 w-5 text-primary" /> Reading History &amp; Report
            </h3>
            <p className="text-sm text-muted-foreground">Every water-balance entry you&apos;ve filed, with a downloadable report.</p>
          </div>
          <Button onClick={handleDownload} disabled={mine.length === 0} variant="outline" className="h-10 shrink-0 gap-2 rounded-xl">
            <Download className="h-4 w-4" /> Download CSV
          </Button>
        </div>
        <div className="mt-5">
          <DataTable columns={columns} data={mine} searchPlaceholder="Search readings…" pageSize={8} emptyMessage="No readings filed yet." />
        </div>
      </div>
    </div>
  );
}

function Num({ v, unit }: { v: number; unit?: string }) {
  return (
    <span className="whitespace-nowrap font-mono text-sm text-foreground">
      {formatNumber(v)}
      {unit ? <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span> : null}
    </span>
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

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: `${accent}1f`, color: accent }}>{icon}</span>
      <p className="mt-3 font-display text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
