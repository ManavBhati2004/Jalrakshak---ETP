"use client";

import { useState } from "react";
import {
  Download,
  CalendarDays,
  CalendarRange,
  Factory,
  ShieldCheck,
  Clock,
  XCircle,
  WifiOff,
  Loader2,
  Droplets,
} from "lucide-react";
import { toast } from "sonner";
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

export function ReportsPanel() {
  const readings = useDataStore((s) => s.readings);
  const industries = useDataStore((s) => s.industries);
  const approvals = useDataStore((s) => s.approvals);
  const compliance = useDataStore((s) => s.compliance);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const [busy, setBusy] = useState<string | null>(null);

  const REPORTS = [
    { key: "daily", title: "Daily", desc: "Today's readings", icon: CalendarDays, color: "#6366f1", count: readings.filter((r) => r.date === TODAY).length, build: () => readings.filter((r) => r.date === TODAY) },
    { key: "monthly", title: "Monthly", desc: "Full logbook", icon: CalendarRange, color: "#8b5cf6", count: readings.length, build: () => readings },
    { key: "industry", title: "Industry-Wise", desc: "Per-unit data", icon: Factory, color: "#0ea5e9", count: industries.length, build: () => industries },
    { key: "compliance", title: "Compliance", desc: "Scores & rates", icon: ShieldCheck, color: "#10b981", count: compliance.length, build: () => compliance.map(({ trend, ...rest }) => rest) },
    { key: "pending", title: "Pending", desc: "Awaiting review", icon: Clock, color: "#f59e0b", count: approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").length, build: () => approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").map(({ timeline, alerts, ...rest }) => rest) },
    { key: "rejected", title: "Rejected", desc: "Rejected log", icon: XCircle, color: "#ef4444", count: approvals.filter((a) => a.stage === "rejected").length, build: () => approvals.filter((a) => a.stage === "rejected").map(({ timeline, alerts, ...rest }) => rest) },
    { key: "nonreporting", title: "Non-Reporting", desc: "Silent units", icon: WifiOff, color: "#fb923c", count: industries.filter((i) => i.status === "non-reporting").length, build: () => industries.filter((i) => i.status === "non-reporting") },
    { key: "etp", title: "ETP Entries", desc: "Water-balance log", icon: Droplets, color: "#0d9488", count: etpEntries.length, build: () => etpEntries },
  ];

  const handleExport = (r: (typeof REPORTS)[number]) => {
    setBusy(r.key);
    const id = toast.loading(`Generating ${r.title} report…`);
    setTimeout(() => {
      const rows = r.build() as Record<string, unknown>[];
      download(stampedName(`jalrakshak-${r.key}`), toCSV(rows));
      toast.success(`${r.title} report exported`, { id, description: `${rows.length} rows · Excel-ready CSV` });
      setBusy(null);
    }, 800);
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {REPORTS.map((r) => (
        <button
          key={r.key}
          onClick={() => handleExport(r)}
          disabled={busy === r.key}
          className="group flex flex-col items-start rounded-2xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md disabled:opacity-60"
        >
          <div className="flex w-full items-start justify-between">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${r.color}1a`, color: r.color }}>
              {busy === r.key ? <Loader2 className="h-5 w-5 animate-spin" /> : <r.icon className="h-5 w-5" />}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{r.count}</span>
          </div>
          <p className="mt-3 text-sm font-bold text-foreground">{r.title}</p>
          <p className="text-xs text-muted-foreground">{r.desc}</p>
          <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </span>
        </button>
      ))}
    </div>
  );
}
