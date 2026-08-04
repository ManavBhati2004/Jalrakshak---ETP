"use client";

import { useState } from "react";
import Link from "next/link";
import { UserCog, Bell, Database, Palette, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/shared/icon";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore } from "@/lib/store/data";
import { ROLES, COMPLIANCE } from "@/lib/constants";

const PREFS = [
  { key: "email", label: "Email notifications", desc: "Send a copy of new alerts to the registered email.", def: true },
  { key: "late", label: "Late submission alerts", desc: "Flag readings recorded outside the 8AM / 8PM window.", def: true },
  { key: "capacity", label: "Capacity-exceeded alerts", desc: "Raise critical alert when flow crosses permitted KLD.", def: true },
  { key: "digest", label: "Daily digest", desc: "A morning summary of compliance and pending items.", def: false },
];

export default function SettingsPage() {
  const role = useAuthStore((s) => s.role);
  const roleMeta = ROLES.find((r) => r.id === role) ?? ROLES[0];
  const resetData = useDataStore((s) => s.resetData);
  const [prefs, setPrefs] = useState<Record<string, boolean>>(Object.fromEntries(PREFS.map((p) => [p.key, p.def])));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System" title="Settings" description="Manage your session, alert preferences and platform data." />

      <div className="grid gap-5 md:grid-cols-2">
        {/* Session */}
        <Card title="Session & Role" icon={<UserCog className="h-4 w-4" />}>
          <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/30 p-4">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl text-white" style={{ background: roleMeta.accent }}>
              <Icon name={roleMeta.icon} className="h-6 w-6" />
            </span>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{roleMeta.name}</p>
              <p className="text-xs text-muted-foreground">{roleMeta.scope}</p>
            </div>
            <Button asChild variant="outline" size="sm" className="rounded-lg">
              <Link href="/login">Switch role</Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{roleMeta.description}</p>
        </Card>

        {/* Appearance */}
        <Card title="Appearance" icon={<Palette className="h-4 w-4" />}>
          <Row label="Command Center theme" desc="Dark, high-contrast monitoring theme (default for dashboards).">
            <Switch checked disabled />
          </Row>
          <Row label="Reduced motion" desc="Respects your system motion preference automatically.">
            <Switch checked disabled />
          </Row>
        </Card>

        {/* Alert prefs */}
        <Card title="Alert Preferences" icon={<Bell className="h-4 w-4" />}>
          {PREFS.map((p) => (
            <Row key={p.key} label={p.label} desc={p.desc}>
              <Switch
                checked={prefs[p.key]}
                onCheckedChange={(v) => {
                  setPrefs((s) => ({ ...s, [p.key]: v }));
                  toast(`${p.label} ${v ? "enabled" : "disabled"}`);
                }}
              />
            </Row>
          ))}
        </Card>

        {/* Thresholds */}
        <Card title="Compliance Thresholds" icon={<ShieldCheck className="h-4 w-4" />}>
          <Row label="Compliant" desc={`Score at or above ${COMPLIANCE.compliant}% is treated as compliant.`}>
            <span className="rounded-lg bg-emerald-500/15 px-3 py-1 font-mono text-sm font-bold text-emerald-400">≥ {COMPLIANCE.compliant}%</span>
          </Row>
          <Row label="Warning" desc={`Between ${COMPLIANCE.warning}% and ${COMPLIANCE.compliant - 1}% triggers a watch.`}>
            <span className="rounded-lg bg-amber-500/15 px-3 py-1 font-mono text-sm font-bold text-amber-400">{COMPLIANCE.warning}–{COMPLIANCE.compliant - 1}%</span>
          </Row>
          <Row label="Non-compliant" desc={`Below ${COMPLIANCE.warning}% is flagged red.`}>
            <span className="rounded-lg bg-red-500/15 px-3 py-1 font-mono text-sm font-bold text-red-400">&lt; {COMPLIANCE.warning}%</span>
          </Row>
        </Card>

        {/* Data management */}
        <Card title="Data Management" icon={<Database className="h-4 w-4" />}>
          <p className="text-sm text-muted-foreground">
            All submissions are stored in your browser. Resetting restores the original default dataset and clears your changes.
          </p>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="mt-4 gap-2 rounded-xl border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-400">
                <RotateCcw className="h-4 w-4" /> Reset data
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset data?</DialogTitle>
                <DialogDescription>
                  This restores all readings, approvals, alerts and industries to the original seed. Your submitted entries will be lost.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" className="rounded-lg">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    className="gap-2 rounded-lg bg-red-600 text-white hover:bg-red-600/90"
                    onClick={() => {
                      resetData();
                      toast.success("Data reset to defaults");
                    }}
                  >
                    <RotateCcw className="h-4 w-4" /> Reset
                  </Button>
                </DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <h3 className="mb-4 flex items-center gap-2 font-display text-base font-bold text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
