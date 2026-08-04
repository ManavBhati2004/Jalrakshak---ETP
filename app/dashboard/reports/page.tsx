"use client";

import { useState } from "react";
import { FileSpreadsheet, Download, CalendarDays, CalendarRange, Factory, ShieldCheck, Clock, XCircle, WifiOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { useDataStore } from "@/lib/store/data";
import { toCSV, stampedName } from "@/lib/utils";

const TODAY = "2026-06-20";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const readings = useDataStore((s) => s.readings);
  const industries = useDataStore((s) => s.industries);
  const approvals = useDataStore((s) => s.approvals);
  const compliance = useDataStore((s) => s.compliance);
  const [busy, setBusy] = useState<string | null>(null);

  const REPORTS = [
    { key: "daily", title: "Daily Report", desc: "All readings recorded today", icon: CalendarDays, color: "#22d3ee", count: readings.filter((r) => r.date === TODAY).length, build: () => readings.filter((r) => r.date === TODAY) },
    { key: "monthly", title: "Monthly Report", desc: "Full reading logbook export", icon: CalendarRange, color: "#34d399", count: readings.length, build: () => readings },
    { key: "industry", title: "Industry-Wise", desc: "Per-unit consent & compliance", icon: Factory, color: "#60a5fa", count: industries.length, build: () => industries.map(({ flow, ...rest }: any) => rest) },
    { key: "compliance", title: "Compliance Report", desc: "Scores & submission rates", icon: ShieldCheck, color: "#10b981", count: compliance.length, build: () => compliance.map(({ trend, ...rest }) => rest) },
    { key: "pending", title: "Pending Entries", desc: "Awaiting verification", icon: Clock, color: "#fbbf24", count: approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").length, build: () => approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").map(({ timeline, alerts, ...rest }) => rest) },
    { key: "rejected", title: "Rejected Entries", desc: "Rejected readings log", icon: XCircle, color: "#f87171", count: approvals.filter((a) => a.stage === "rejected").length, build: () => approvals.filter((a) => a.stage === "rejected").map(({ timeline, alerts, ...rest }) => rest) },
    { key: "nonreporting", title: "Non-Reporting", desc: "Units silent for 48h+", icon: WifiOff, color: "#fb923c", count: industries.filter((i) => i.status === "non-reporting").length, build: () => industries.filter((i) => i.status === "non-reporting") },
  ];

  const handleExport = (r: (typeof REPORTS)[number]) => {
    setBusy(r.key);
    const id = toast.loading(`Generating ${r.title}…`);
    setTimeout(() => {
      const rows = r.build() as Record<string, unknown>[];
      download(stampedName(`jalrakshak-${r.key}`), toCSV(rows));
      toast.success(`${r.title} exported`, { id, description: `${rows.length} rows · Excel-ready CSV` });
      setBusy(null);
    }, 900);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Governance"
        title="Reports & Exports"
        description="Generate Excel-ready exports for inspections, audits and review meetings. Exports download real CSV files."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {REPORTS.map((r) => (
          <div key={r.key} className="group flex flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/30">
            <div className="flex items-start justify-between">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${r.color}1a`, color: r.color }}>
                <r.icon className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{r.count} rows</span>
            </div>
            <h3 className="mt-4 font-display text-base font-bold text-foreground">{r.title}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{r.desc}</p>
            <button
              onClick={() => handleExport(r)}
              disabled={busy === r.key}
              className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-60"
            >
              {busy === r.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {busy === r.key ? "Exporting…" : "Export"}
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-5">
        <FileSpreadsheet className="h-6 w-6 text-emerald-400" />
        <p className="text-sm text-muted-foreground">
          Exports are generated client-side from live state — submit a reading or register a member and re-export to see it reflected.
        </p>
      </div>
    </div>
  );
}
