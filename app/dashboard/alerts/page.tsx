"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BellRing, Check, CircleCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Icon } from "@/components/shared/icon";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/lib/store/data";
import { useAuthStore, isAdmin } from "@/lib/store/auth";
import { ALERT_META, SEVERITY_COLOR } from "@/lib/constants";
import type { AlertSeverity } from "@/lib/types";
import { timeAgo, cn } from "@/lib/utils";

const STATUS_TABS = [
  { key: "active", label: "Active" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
] as const;

const SEVERITIES: AlertSeverity[] = ["critical", "high", "medium", "low"];

export default function AlertsPage() {
  const allAlerts = useDataStore((s) => s.alerts);
  const acknowledge = useDataStore((s) => s.acknowledgeAlert);
  const resolve = useDataStore((s) => s.resolveAlert);
  const role = useAuthStore((s) => s.role);
  const industryId = useAuthStore((s) => s.industryId);
  const admin = isAdmin(role);
  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["key"]>("active");

  // ETP operators see only their own unit's alerts (read-only).
  const alerts = useMemo(
    () => (admin ? allAlerts : allAlerts.filter((a) => a.industryId === industryId)),
    [allAlerts, admin, industryId],
  );

  const sevCounts = useMemo(() => {
    const active = alerts.filter((a) => a.status === "active");
    return Object.fromEntries(SEVERITIES.map((s) => [s, active.filter((a) => a.severity === s).length])) as Record<AlertSeverity, number>;
  }, [alerts]);

  const filtered = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return tab === "all" ? sorted : sorted.filter((a) => a.status === tab);
  }, [alerts, tab]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={admin ? "Governance" : "ETP · Alerts"}
        title={admin ? "Alert Center" : "Alerts & Warnings"}
        description={
          admin
            ? "The engine flags late, zero, excess, missing-photo, non-reporting and rejected events the moment they occur."
            : "Alerts and warnings raised on your ETP water-balance entries."
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SEVERITIES.map((s) => (
          <div key={s} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_COLOR[s] }} />
              <span className="text-xs font-medium capitalize text-muted-foreground">{s}</span>
            </div>
            <p className="mt-1 font-display text-2xl font-bold" style={{ color: SEVERITY_COLOR[s] }}>
              {sevCounts[s]}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((a) => {
            const meta = ALERT_META[a.type];
            return (
              <motion.div
                layout
                key={a.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.3 }}
                className="flex items-start gap-4 rounded-2xl border border-border bg-card p-4"
              >
                <span
                  className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: `${meta.color}1a`, color: meta.color }}
                >
                  <Icon name={meta.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-foreground">{a.title}</p>
                    <StatusBadge status={a.severity} dot={false} />
                    {a.status !== "active" && <StatusBadge status={a.status} />}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{a.message}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground/70">
                    {a.industryName && <span>{a.industryName}</span>}
                    {a.cetpId && <span className="capitalize">· {a.cetpId}</span>}
                    <span>· {timeAgo(a.createdAt)}</span>
                  </div>
                </div>
                {admin && a.status === "active" && (
                  <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                    <Button size="sm" variant="outline" className="h-8 gap-1 rounded-lg" onClick={() => { acknowledge(a.id); toast("Alert acknowledged"); }}>
                      <Check className="h-3.5 w-3.5" /> Ack
                    </Button>
                    <Button size="sm" className="h-8 gap-1 rounded-lg" onClick={() => { resolve(a.id); toast.success("Alert resolved"); }}>
                      <CircleCheck className="h-3.5 w-3.5" /> Resolve
                    </Button>
                  </div>
                )}
                {admin && a.status === "acknowledged" && (
                  <Button size="sm" className="h-8 shrink-0 gap-1 rounded-lg" onClick={() => { resolve(a.id); toast.success("Alert resolved"); }}>
                    <CircleCheck className="h-3.5 w-3.5" /> Resolve
                  </Button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
            <BellRing className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No alerts in this view.</p>
          </div>
        )}
      </div>
    </div>
  );
}
