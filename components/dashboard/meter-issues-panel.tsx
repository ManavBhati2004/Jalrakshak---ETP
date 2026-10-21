"use client";

import { useMemo, useState } from "react";
import { Gauge, Send, RotateCcw, PlayCircle, CheckCircle2, CircleDot } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDataStore } from "@/lib/store/data";
import { activeBaseline, baselinesFrom, customColumnUnit, istDateString, latestMeterReading, meterKeyOf, openIssueFor, parseDailyValue } from "@/lib/data/etp-calc";
import { MAX_ISSUE_DESCRIPTION, MAX_RESET_REASON, reportMeterIssue, resetMeterDirectly, resolveMeterIssue } from "@/lib/data/meter-issues";
import { ENERGY_METERS, WATER_METERS } from "@/lib/constants";
import { useMeterIssues } from "@/lib/hooks/use-meter-issues";
import type { EtpEntry, Industry, MeterIssue, MeterIssueResolution } from "@/lib/types";
import { formatDate, formatNumber } from "@/lib/utils";

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background";

export interface ReportableMeter {
  key: string;
  label: string;
  unit: string;
  group: string;
}

/** OPEN / RESOLVED, in the same chip style as the rest of the dashboard. */
function IssueStatus({ issue }: { issue: MeterIssue }) {
  return issue.status === "OPEN" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
      <CircleDot className="h-3 w-3" /> Open
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
      <CheckCircle2 className="h-3 w-3" /> Resolved
    </span>
  );
}

/**
 * "Reset to 0 on 15 Oct 2026 by …". Operators see "the Monitoring Body" rather than an officer's
 * login - that address is for the regulator's own audit, not for the units.
 */
function resolutionText(i: MeterIssue, by: "officer" | "body"): string {
  if (i.status !== "RESOLVED") return "";
  const on = i.resolvedAt ? ` on ${formatDate(istDateString(i.resolvedAt))}` : "";
  const who = by === "body" ? " by the Monitoring Body" : i.resolvedByEmail ? ` by ${i.resolvedByEmail}` : "";
  return i.resolution === "RESET" ? `Reset to 0${on}${who}` : `Resumed at ${formatNumber(i.newBaseline ?? 0)} ${i.unit}${on}${who}`;
}

/* ============================================================
   Operator: report a meter problem
   ============================================================ */

/**
 * A small "Report Meter Issue" control for the meter section header. Lists the unit's issues so the
 * operator can see what is pending. Reporting never changes a reading itself - only the Monitoring
 * Body can set a new baseline, and the rules enforce that.
 */
export function ReportMeterIssue({
  industryId,
  issues,
  meters,
  loaded,
  unavailable,
}: {
  industryId: string;
  issues: MeterIssue[];
  meters: ReportableMeter[];
  loaded: boolean;
  unavailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [meterKey, setMeterKey] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  const openIssues = issues.filter((i) => i.status === "OPEN");
  const already = meterKey ? openIssueFor(issues, meterKey) : undefined;
  const groups = useMemo(() => {
    const out: Record<string, ReportableMeter[]> = {};
    for (const m of meters) (out[m.group] ??= []).push(m);
    return out;
  }, [meters]);

  const submit = async () => {
    const meter = meters.find((m) => m.key === meterKey);
    if (!meter || sending || already) return;
    if (!description.trim()) {
      toast.error("Describe the problem with the meter.");
      return;
    }
    setSending(true);
    const res = await reportMeterIssue({
      industryId,
      meterKey: meter.key,
      meterLabel: meter.label,
      unit: meter.unit,
      description,
      known: issues,
    });
    setSending(false);
    if (!res.ok) {
      toast.error("Report not sent", { description: res.error });
      return;
    }
    if (res.reused) {
      toast.info("Already reported", { description: `${meter.label} already has an open issue from ${formatDate(res.issue.createdAt, true)}.` });
    } else {
      toast.success("Meter issue reported", { description: `${meter.label} — the Monitoring Body has been notified.` });
      setDescription("");
      setMeterKey("");
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen((v) => !v)} className="h-9 gap-1.5 rounded-xl">
        <Gauge className="h-4 w-4" /> Report Meter Issue
        {openIssues.length ? (
          <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-bold text-amber-600">{openIssues.length} open</span>
        ) : null}
      </Button>

      {open ? (
        <div className="mt-3 w-full rounded-xl border border-border bg-muted/30 p-3">
          {unavailable ? (
            <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
              Meter issues are unavailable right now, so a report cannot be sent. Your daily entry is not affected.
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr]">
            <div>
              <label htmlFor="issue-meter" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Affected meter
              </label>
              <select id="issue-meter" value={meterKey} onChange={(e) => setMeterKey(e.target.value)} className={inputCls}>
                <option value="">Select a meter…</option>
                {Object.entries(groups).map(([group, ms]) => (
                  <optgroup key={group} label={group}>
                    {ms.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="issue-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                What is wrong? (failure, replacement, incorrect display…)
              </label>
              <textarea
                id="issue-description"
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, MAX_ISSUE_DESCRIPTION))}
                rows={2}
                placeholder="e.g. Meter replaced after the dial stopped; new meter starts at 0."
                className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {already
                ? `This meter already has an open issue (reported ${formatDate(already.createdAt, true)}) — it will not be filed twice.`
                : "Reporting does not change any reading. The Monitoring Body decides whether to reset the meter or resume it from a value."}
            </p>
            <Button
              onClick={submit}
              disabled={!meterKey || !description.trim() || sending || !!already || !loaded || unavailable}
              className="h-9 gap-1.5 rounded-xl"
            >
              <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send report"}
            </Button>
          </div>

          {issues.length ? (
            <ul className="mt-3 space-y-2 border-t border-border/60 pt-3">
              {issues.slice(0, 6).map((i) => (
                <li key={i.id} className="flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{i.meterLabel}</p>
                    <p className="break-words text-muted-foreground">{i.description}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {i.raisedBy === "monitoring-body" ? "Raised by the Monitoring Body" : "Reported"} {formatDate(i.createdAt, true)}
                      {i.status === "RESOLVED" ? ` · ${resolutionText(i, "body")}` : ""}
                    </p>
                  </div>
                  <IssueStatus issue={i} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/* ============================================================
   Monitoring Body: review and resolve, across units
   ============================================================ */

type Reading = { value: number; date: string } | null;
type Pending = {
  issue: MeterIssue;
  unitName: string;
  resolution: MeterIssueResolution;
  current: Reading;
  staleNote: string | null;
  /** The plant date when the dialog opened - the "from" of the preview (the server stamps the real one). */
  today: string;
};

/** How a filed day stands, in the words the Approvals tab uses. */
function entryStanding(e: EtpEntry | undefined): string {
  if (!e) return "";
  if (e.entryStatus === "DRAFT") return "draft";
  return e.status === "pending" ? "pending review" : e.status;
}

/**
 * A compact Meter Issues section for the Monitoring Body. Lists each unit's open issues and offers
 * exactly two resolutions: Reset to 0, or Resume from a value. Both go through a confirmation that
 * names the unit, the meter, its current reading and baseline, and the proposed new baseline.
 */
export function MeterIssuesAdmin({ units }: { units: { id: string; name: string }[] }) {
  const etpEntries = useDataStore((s) => s.etpEntries);
  const { byUnit, loaded, error } = useMeterIssues(units.map((u) => u.id));
  const [showResolved, setShowResolved] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [resumeValue, setResumeValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [directOpen, setDirectOpen] = useState(false);

  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? id;
  const all = useMemo(() => Object.values(byUnit).flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [byUnit]);
  const openIssues = all.filter((i) => i.status === "OPEN");
  const shown = showResolved ? all : openIssues;

  const current = (i: MeterIssue): Reading => latestMeterReading(etpEntries, i.industryId, i.meterKey);
  const entryOn = (industryId: string, date: string) => etpEntries.find((e) => e.industryId === industryId && e.date === date);
  /** The baseline already in force for this meter from an earlier resolution, if any. */
  const baselineNow = (i: MeterIssue) => activeBaseline(baselinesFrom(byUnit[i.industryId] ?? []), i.meterKey, "9999-12-31");

  const start = (issue: MeterIssue, resolution: MeterIssueResolution) => {
    setResumeValue("");
    setPending({ issue, unitName: nameOf(issue.industryId), resolution, current: current(issue), staleNote: null, today: istDateString(Date.now()) });
  };

  const parsedResume = parseDailyValue(resumeValue);
  const newBaseline = pending?.resolution === "RESET" ? 0 : parsedResume.value;
  const resumeInvalid = pending?.resolution === "RESUME" && (resumeValue.trim() === "" || !!parsedResume.error || parsedResume.value == null);

  const confirm = async () => {
    if (!pending || busy || newBaseline == null) return;
    setBusy(true);
    const res = await resolveMeterIssue({
      industryId: pending.issue.industryId,
      issueId: pending.issue.id,
      resolution: pending.resolution,
      newBaseline,
      confirmed: pending.current,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.stale) {
        // The meter moved on: show the new figures and ask for a fresh confirmation.
        setPending({ ...pending, current: res.stale.current, staleNote: res.error });
        return;
      }
      toast.error("Not resolved", { description: res.error });
      return;
    }
    toast.success(pending.resolution === "RESET" ? "Meter reset to 0" : `Meter resumed at ${formatNumber(newBaseline)}`, {
      description: `${pending.unitName} · ${pending.issue.meterLabel}`,
    });
    setPending(null);
  };

  const readingText = (r: Reading, industryId: string, unit: string) => {
    if (!r) return "none on record";
    const standing = entryStanding(entryOn(industryId, r.date));
    return `${formatNumber(r.value)} ${unit} (${formatDate(r.date)}${standing ? `, ${standing}` : ""})`;
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
            <Gauge className="h-5 w-5 text-primary" /> Meter Issues
          </h3>
          <p className="text-sm text-muted-foreground">Faulty or replaced meters reported by units, awaiting a new baseline.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600">{openIssues.length} open</span>
          <Button variant="outline" size="sm" onClick={() => setShowResolved((v) => !v)} className="h-8 rounded-lg">
            {showResolved ? "Open only" : "Show resolved"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDirectOpen(true)} disabled={!loaded} className="h-8 gap-1.5 rounded-lg">
            <RotateCcw className="h-3.5 w-3.5" /> Reset a meter
          </Button>
        </div>
      </div>
      {directOpen ? <DirectResetDialog units={units} byUnit={byUnit} onClose={() => setDirectOpen(false)} /> : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-700">
          Some units&apos; meter issues could not be loaded. The list below may be incomplete.
        </p>
      ) : null}

      {!loaded ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading meter issues…</p>
      ) : shown.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{showResolved ? "No meter issues reported yet." : "No open meter issues."}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {shown.map((i) => (
            <li key={`${i.industryId}/${i.id}`} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 text-sm">
                <p className="font-semibold text-foreground">
                  {nameOf(i.industryId)} · <span className="font-medium">{i.meterLabel}</span>
                </p>
                <p className="break-words text-muted-foreground">{i.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Reported reading{" "}
                  <span className="font-mono text-foreground">{i.reportedReading == null ? "—" : `${formatNumber(i.reportedReading)} ${i.unit}`}</span>
                  {" · "}Current reading <span className="font-mono text-foreground">{readingText(current(i), i.industryId, i.unit)}</span>
                  {" · "}
                  {i.raisedBy === "monitoring-body" ? "Reset directly" : "Reported"} {formatDate(i.createdAt, true)} by {i.reporterEmail}
                </p>
                {i.status === "RESOLVED" ? <p className="mt-1 text-xs font-medium text-emerald-600">{resolutionText(i, "officer")}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <IssueStatus issue={i} />
                {i.status === "OPEN" ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => start(i, "RESET")} className="h-8 gap-1.5 rounded-lg">
                      <RotateCcw className="h-3.5 w-3.5" /> Reset to 0
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => start(i, "RESUME")} className="h-8 gap-1.5 rounded-lg">
                      <PlayCircle className="h-3.5 w-3.5" /> Resume from a value
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!pending} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>{pending.resolution === "RESET" ? "Reset this meter to 0?" : "Resume this meter from a value?"}</DialogTitle>
                <DialogDescription>
                  The new baseline applies to this meter only, from its next reading. Readings already filed stay exactly as they are.
                </DialogDescription>
              </DialogHeader>
              {pending.staleNote ? (
                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">{pending.staleNote}</p>
              ) : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Unit</dt>
                <dd className="font-medium text-foreground">
                  {pending.unitName} <span className="text-xs text-muted-foreground">({pending.issue.industryId})</span>
                </dd>
                <dt className="text-muted-foreground">Meter</dt>
                <dd className="font-medium text-foreground">
                  {pending.issue.meterLabel} <span className="text-xs text-muted-foreground">({pending.issue.unit})</span>
                </dd>
                <dt className="text-muted-foreground">Current reading</dt>
                <dd className="font-mono text-foreground">{readingText(pending.current, pending.issue.industryId, pending.issue.unit)}</dd>
                {(() => {
                  const b = baselineNow(pending.issue);
                  return b ? (
                    <>
                      <dt className="text-muted-foreground">Current baseline</dt>
                      <dd className="font-mono text-foreground">
                        {formatNumber(b.newBaseline)} {pending.issue.unit} (set {formatDate(b.effectiveDate)})
                      </dd>
                    </>
                  ) : null;
                })()}
                <dt className="text-muted-foreground">New baseline</dt>
                <dd className="font-mono font-semibold text-primary">
                  {pending.resolution === "RESET" ? `0 ${pending.issue.unit}` : newBaseline != null && !resumeInvalid ? `${formatNumber(newBaseline)} ${pending.issue.unit}` : "—"}
                </dd>
                <dt className="text-muted-foreground">Applies to</dt>
                <dd className="text-foreground">
                  Readings dated {pending.current ? `after ${formatDate(pending.current.date)} and ` : ""}from {formatDate(pending.today)} onward
                </dd>
              </dl>
              {pending.resolution === "RESUME" ? (
                <div>
                  <label htmlFor="resume-value" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Resume value ({pending.issue.unit}) — may be lower than the old reading after a repair or replacement
                  </label>
                  <input
                    id="resume-value"
                    inputMode="decimal"
                    value={resumeValue}
                    onChange={(e) => setResumeValue(e.target.value)}
                    placeholder="e.g. 500"
                    className={inputCls}
                    autoFocus
                  />
                  {resumeValue.trim() && parsedResume.error ? (
                    <p className="mt-1 text-xs text-red-500">Enter a non-negative number with at most 2 decimal places.</p>
                  ) : null}
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="outline" className="rounded-lg" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </Button>
                <Button className="gap-2 rounded-lg" disabled={busy || resumeInvalid || newBaseline == null} onClick={confirm}>
                  {pending.resolution === "RESET" ? <RotateCcw className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                  {busy ? "Saving…" : pending.staleNote ? "Confirm again" : pending.resolution === "RESET" ? "Reset to 0" : "Resume"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================
   Monitoring Body: reset a meter directly, without a report
   ============================================================ */

/** Every meter a unit has, by stable key: 12 water, 3 energy, then its custom columns. */
function metersOf(industry: Industry | undefined): ReportableMeter[] {
  if (!industry) return [];
  return [
    ...WATER_METERS.map((m) => ({ key: meterKeyOf("water", m.code), label: m.label, unit: "M3", group: "Water" })),
    ...ENERGY_METERS.map((m) => ({ key: meterKeyOf("energy", m.code), label: m.label, unit: "Kwh", group: "Energy" })),
    ...[...(industry.customColumns ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((c) => ({ key: meterKeyOf("custom", c.id), label: c.name, unit: customColumnUnit(c), group: "Custom" })),
  ];
}

/**
 * The Monitoring Body starts a meter's new reading sequence on its own - e.g. a replaced meter seen
 * on inspection - with the same two choices and the same confirmation as resolving a report. The
 * old meter's last reading is kept; the record says the Monitoring Body raised it.
 */
function DirectResetDialog({
  units,
  byUnit,
  onClose,
}: {
  units: { id: string; name: string }[];
  byUnit: Record<string, MeterIssue[]>;
  onClose: () => void;
}) {
  const industries = useDataStore((s) => s.industries);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [meterKey, setMeterKey] = useState("");
  const [resolution, setResolution] = useState<MeterIssueResolution>("RESET");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  // The reading the officer is confirming against: taken when the meter is chosen, so a reading filed
  // while the dialog is open is caught as stale rather than silently baselined over.
  const [confirmed, setConfirmed] = useState<Reading>(null);
  const [today] = useState(() => istDateString(Date.now()));

  const industry = industries.find((i) => i.id === unitId);
  const meters = useMemo(() => metersOf(industry), [industry]);
  const groups = useMemo(() => {
    const out: Record<string, ReportableMeter[]> = {};
    for (const m of meters) (out[m.group] ??= []).push(m);
    return out;
  }, [meters]);
  const meter = meters.find((m) => m.key === meterKey);
  const issues = byUnit[unitId] ?? [];
  const openOne = meterKey ? openIssueFor(issues, meterKey) : undefined;
  const baselineNow = meterKey ? activeBaseline(baselinesFrom(issues), meterKey, "9999-12-31") : undefined;

  const pickMeter = (key: string) => {
    setMeterKey(key);
    setStaleNote(null);
    setConfirmed(key ? latestMeterReading(etpEntries, unitId, key) : null);
  };
  const pickUnit = (id: string) => {
    setUnitId(id);
    pickMeter("");
  };

  const parsed = parseDailyValue(value);
  const newBaseline = resolution === "RESET" ? 0 : parsed.value;
  const valueInvalid = resolution === "RESUME" && (value.trim() === "" || !!parsed.error || parsed.value == null);
  const canSubmit = !!meter && !openOne && !valueInvalid && newBaseline != null && reason.trim().length > 0 && !busy;

  const submit = async () => {
    if (!meter || !canSubmit || newBaseline == null) return;
    setBusy(true);
    const res = await resetMeterDirectly({
      industryId: unitId,
      meterKey: meter.key,
      meterLabel: meter.label,
      unit: meter.unit,
      reason,
      resolution,
      newBaseline,
      confirmed,
      known: issues,
    });
    setBusy(false);
    if (!res.ok) {
      if (res.stale) {
        setConfirmed(res.stale.current);
        setStaleNote(res.error);
        return;
      }
      toast.error("Meter not reset", { description: res.error });
      return;
    }
    toast.success(resolution === "RESET" ? "Meter reset to 0" : `Meter resumed at ${formatNumber(newBaseline)}`, {
      description: `${units.find((u) => u.id === unitId)?.name ?? unitId} · ${meter.label}`,
    });
    onClose();
  };

  const reading = confirmed ? `${formatNumber(confirmed.value)} ${meter?.unit ?? ""} (${formatDate(confirmed.date)})` : "none on record";

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset a meter</DialogTitle>
          <DialogDescription>
            Start a meter&apos;s new reading sequence without waiting for the unit to report it — e.g. after a replacement. Readings already filed stay
            exactly as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="direct-unit" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              ETP unit
            </label>
            <select id="direct-unit" value={unitId} onChange={(e) => pickUnit(e.target.value)} className={inputCls}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="direct-meter" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Meter
            </label>
            <select id="direct-meter" value={meterKey} onChange={(e) => pickMeter(e.target.value)} className={inputCls}>
              <option value="">Select a meter…</option>
              {Object.entries(groups).map(([group, ms]) => (
                <optgroup key={group} label={group}>
                  {ms.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant={resolution === "RESET" ? "default" : "outline"} size="sm" onClick={() => setResolution("RESET")} className="h-9 flex-1 gap-1.5 rounded-lg">
            <RotateCcw className="h-3.5 w-3.5" /> Reset to 0
          </Button>
          <Button type="button" variant={resolution === "RESUME" ? "default" : "outline"} size="sm" onClick={() => setResolution("RESUME")} className="h-9 flex-1 gap-1.5 rounded-lg">
            <PlayCircle className="h-3.5 w-3.5" /> Resume from a value
          </Button>
        </div>
        {resolution === "RESUME" ? (
          <div>
            <label htmlFor="direct-value" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Resume value{meter ? ` (${meter.unit})` : ""} — may be lower than the old reading after a repair or replacement
            </label>
            <input id="direct-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 500" className={inputCls} />
            {value.trim() && parsed.error ? <p className="mt-1 text-xs text-red-500">Enter a non-negative number with at most 2 decimal places.</p> : null}
          </div>
        ) : null}
        <div>
          <label htmlFor="direct-reason" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Reason (recorded with the reset)
          </label>
          <textarea
            id="direct-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_RESET_REASON))}
            rows={2}
            placeholder="e.g. Faulty meter replaced on inspection; new meter starts at 0."
            className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
          />
        </div>
        {meter ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Old meter&apos;s last reading</dt>
            <dd className="font-mono text-foreground">{reading} — kept</dd>
            {baselineNow ? (
              <>
                <dt className="text-muted-foreground">Current baseline</dt>
                <dd className="font-mono text-foreground">
                  {formatNumber(baselineNow.newBaseline)} {meter.unit} (set {formatDate(baselineNow.effectiveDate)})
                </dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">New baseline</dt>
            <dd className="font-mono font-semibold text-primary">{newBaseline != null && !valueInvalid ? `${formatNumber(newBaseline)} ${meter.unit}` : "—"}</dd>
            <dt className="text-muted-foreground">Applies to</dt>
            <dd className="text-foreground">
              Readings dated {confirmed ? `after ${formatDate(confirmed.date)} and ` : ""}from {formatDate(today)} onward
            </dd>
          </dl>
        ) : null}
        {openOne ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
            This meter already has an open report from the unit (reported {formatDate(openOne.createdAt, true)}) — resolve it from the list instead.
          </p>
        ) : null}
        {staleNote ? <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">{staleNote}</p> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-lg" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="gap-2 rounded-lg" disabled={!canSubmit} onClick={submit}>
            {resolution === "RESET" ? <RotateCcw className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            {busy ? "Saving…" : staleNote ? "Confirm again" : resolution === "RESET" ? "Reset to 0" : "Resume"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
