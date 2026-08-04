"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ArrowRight, Droplets, FileSpreadsheet, Send } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PipelineFlow } from "@/components/dashboard/pipeline-flow";
import { ReportsPanel } from "@/components/dashboard/reports-panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Icon } from "@/components/shared/icon";
import { useDataStore, selectMetrics } from "@/lib/store/data";
import { buildEtpStageFlow } from "@/lib/data/etp-flow";
import { ALERT_META } from "@/lib/constants";
import { formatNumber, formatDate, timeAgo, displayUnit } from "@/lib/utils";
import type { FlowNode } from "@/lib/types";

export function AdminOverview() {
  const metrics = useDataStore(useShallow(selectMetrics));
  const alerts = useDataStore((s) => s.alerts);
  const approvals = useDataStore((s) => s.approvals);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const readings = useDataStore((s) => s.readings);
  const industries = useDataStore((s) => s.industries);

  const etpUnits = useMemo(() => industries.filter((i) => i.isIndividualETP), [industries]);

  const recentAlerts = alerts.filter((a) => a.status === "active").slice(0, 5);
  const pendingApprovals = approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").slice(0, 5);

  // aggregate ETP treatment pipeline — combined sanctioned capacity across all individual ETP units
  const flow = useMemo<FlowNode[]>(() => {
    if (etpUnits.length === 0) return [];
    const sums: number[] = [];
    for (const ind of etpUnits) {
      buildEtpStageFlow(ind).forEach((n, i) => {
        sums[i] = (sums[i] ?? 0) + n.value;
      });
    }
    return buildEtpStageFlow(etpUnits[0]).map((n, i) => ({ ...n, id: `agg-${n.short}`, value: sums[i] ?? n.value }));
  }, [etpUnits]);

  // newest operator submissions across ETP water-balance and flow-meter readings
  const recentSubs = useMemo(() => {
    const subs = [
      ...etpEntries.map((e) => ({ id: e.id, kind: "ETP", name: e.industryName, date: e.date, at: e.submittedAt, value: `Intake ${formatNumber(e.totalWaterIntake)} m³` })),
      ...readings.map((r) => ({ id: r.id, kind: "Meter", name: r.industryName, date: r.date, at: r.submittedAt, value: `${r.meterPoint} ${formatNumber(r.difference)} ${displayUnit(r.unit)}` })),
    ];
    return subs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [etpEntries, readings]);

  const metricCards = [
    { label: "ETP Units", value: etpUnits.length, icon: "Droplets", accent: "#0d9488", delta: { value: "live", positive: true }, href: "/dashboard/etp" },
    { label: "Total Industries", value: metrics.totalIndustries, icon: "Factory", accent: "#8b5cf6", href: "/dashboard/industries" },
    { label: "Pending Approvals", value: metrics.pendingApprovals, icon: "Clock", accent: "#f59e0b", hint: "Awaiting review", href: "/dashboard/approvals" },
    { label: "Rejected Entries", value: metrics.rejectedEntries, icon: "XCircle", accent: "#ef4444", hint: "This cycle", href: "/dashboard/approvals" },
    { label: "Non-Reporting", value: metrics.nonReporting, icon: "WifiOff", accent: "#fb923c", hint: "48h+ silent", href: "/dashboard/industries" },
    { label: "Active Alerts", value: metrics.activeAlerts, icon: "BellRing", accent: "#0ea5e9", delta: { value: "live", positive: false }, href: "/dashboard/alerts" },
    { label: "ETP Entries", value: etpEntries.length, icon: "FileSpreadsheet", accent: "#06b6d4", hint: "Submitted", href: "/dashboard/etp" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring Body"
        title="Command Center Overview"
        description="A unified, real-time view of individual ETP treatment, water balance, industrial compliance, the alert engine and one-click reports across every ETP unit."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {metricCards.map((m, i) => (
          <MetricCard key={m.label} {...m} index={i} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        {/* aggregate ETP treatment pipeline */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4">
            <h3 className="font-display text-lg font-bold text-foreground">ETP Treatment Pipeline</h3>
            <p className="text-xs text-muted-foreground">Combined sanctioned capacity across individual ETP units</p>
          </div>
          <PipelineFlow flow={flow} />
        </div>

        {/* ETP unit status */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-foreground">ETP Units</h3>
            <Link href="/dashboard/etp" className="text-xs font-semibold text-primary hover:underline">View all</Link>
          </div>
          <div className="mt-3 space-y-2.5">
            {etpUnits.map((ind) => (
              <Link key={ind.id} href="/dashboard/etp" className="block rounded-xl border border-border p-3 transition-colors hover:border-primary/40 hover:bg-muted/40">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Droplets className="h-4 w-4 text-primary" /> {ind.name}
                  </span>
                  <StatusBadge status={ind.status} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{ind.area}</span>
                  <span className="shrink-0">Permitted <span className="font-mono font-semibold text-foreground">{formatNumber(ind.permittedKLD)}</span> KLD</span>
                </div>
              </Link>
            ))}
            {etpUnits.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No ETP units registered</p>}
          </div>
        </div>
      </div>

      {/* reports on dashboard */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          <h3 className="font-display text-lg font-bold text-foreground">Reports &amp; Exports</h3>
          <span className="text-xs text-muted-foreground">· generated live from current data</span>
        </div>
        <ReportsPanel />
      </div>

      {/* recent submissions from ETP operators */}
      <ListPanel title="Recent Submissions" href="/dashboard/etp" empty="No submissions yet">
        {recentSubs.map((s) => (
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Send className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">{s.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{s.kind}</span> · {s.value}
              </p>
            </div>
            <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(s.date)}</span>
          </div>
        ))}
      </ListPanel>

      {/* alerts + approvals */}
      <div className="grid gap-4 md:grid-cols-2">
        <ListPanel title="Recent Alerts" href="/dashboard/alerts" empty="No active alerts">
          {recentAlerts.map((a) => (
            <div key={a.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ALERT_META[a.type].color}1f`, color: ALERT_META[a.type].color }}>
                <Icon name={ALERT_META[a.type].icon} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{a.title}</p>
                  <StatusBadge status={a.severity} dot={false} />
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.message}</p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">{timeAgo(a.createdAt)}</p>
              </div>
            </div>
          ))}
        </ListPanel>

        <ListPanel title="Pending Approvals" href="/dashboard/approvals" empty="All caught up">
          {pendingApprovals.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                <Icon name="Clock" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{a.industryName}</p>
                <p className="text-xs text-muted-foreground">{a.meterPoint} · {formatNumber(a.difference)} {displayUnit(a.unit)}</p>
              </div>
              <StatusBadge status={a.stage} dot={false} />
            </div>
          ))}
        </ListPanel>
      </div>
    </div>
  );
}

function ListPanel({ title, href, children, empty }: { title: string; href: string; children: React.ReactNode; empty: string }) {
  const items = Array.isArray(children) ? children : [children];
  const isEmpty = items.flat().filter(Boolean).length === 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-bold text-foreground">{title}</h3>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-4 space-y-2.5">{isEmpty ? <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p> : children}</div>
    </div>
  );
}
