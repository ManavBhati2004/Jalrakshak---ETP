"use client";

import { useMemo, useState } from "react";
import { Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { deleteLogbookRecords } from "@/lib/data/tenant-ops";
import { describeLogbookCounts, describeLogbookPeriod, logbookPeriodSummary } from "@/lib/data/logbook";
import { useDataStore } from "@/lib/store/data";
import type { Industry } from "@/lib/types";

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50";

const KINDS = [
  { id: "date", label: "Date" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
] as const;
type PeriodKind = (typeof KINDS)[number]["id"];

/**
 * Monitoring Body: delete one unit's logbook records for a date, month or year. The summary is live,
 * so what the officer confirms is what is on screen; typing the unit's id arms the button.
 */
export function LogbookDeleteDialog({
  industry,
  defaultMonth,
  onClose,
  onDeleted,
}: {
  industry: Industry;
  defaultMonth: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const etpEntries = useDataStore((s) => s.etpEntries);
  const [kind, setKind] = useState<PeriodKind>("month");
  const [date, setDate] = useState("");
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultMonth.slice(0, 4));
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const years = useMemo(
    () => [...new Set(etpEntries.filter((e) => e.industryId === industry.id).map((e) => e.date.slice(0, 4)))].sort().reverse(),
    [etpEntries, industry.id],
  );
  const period = kind === "date" ? date : kind === "month" ? month : year;
  const summary = useMemo(() => logbookPeriodSummary(etpEntries, industry.id, period), [etpEntries, industry.id, period]);
  const days = summary.rows.length;

  const idMatches = typed.trim().toUpperCase() === industry.id.toUpperCase();
  const canDelete = days > 0 && idMatches && !busy;

  const submit = async () => {
    if (!canDelete) return;
    setBusy(true);
    const res = await deleteLogbookRecords(industry.id, period, summary.expected);
    setBusy(false);
    if (!res.ok) {
      toast.error("Records not deleted", { description: res.error });
      return;
    }
    toast.success("Logbook records deleted", {
      description: `${res.removed} day${res.removed === 1 ? "" : "s"} of ${industry.name} for ${describeLogbookPeriod(period)}.`,
    });
    onDeleted();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete logbook records</DialogTitle>
          <DialogDescription>
            {industry.name} ({industry.id})
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {KINDS.map((k) => (
            <Button key={k.id} type="button" variant={kind === k.id ? "default" : "outline"} size="sm" onClick={() => setKind(k.id)} className="h-9 flex-1 rounded-lg">
              {k.label}
            </Button>
          ))}
        </div>

        <div>
          <label htmlFor="delete-period" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {kind === "date" ? "Date" : kind === "month" ? "Month" : "Year"}
          </label>
          {kind === "date" ? (
            <input id="delete-period" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          ) : kind === "month" ? (
            <input id="delete-period" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
          ) : (
            <select id="delete-period" value={year} onChange={(e) => setYear(e.target.value)} className={inputCls}>
              {years.includes(year) ? null : <option value={year}>{year}</option>}
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </div>

        {days > 0 ? (
          <div className="flex gap-2.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p>
                This permanently deletes <span className="font-semibold">{days} day{days === 1 ? "" : "s"}</span> for {describeLogbookPeriod(period)} ({describeLogbookCounts(summary.counts)}), with
                their approvals and alerts. This cannot be undone.
              </p>
              {summary.recalculated > 0 ? (
                <p>
                  {summary.recalculated} later day{summary.recalculated === 1 ? "" : "s"} will have Sludge &amp; Salt balances recalculated.
                </p>
              ) : null}
              <p>Later meter readings stay as they are. The unit is told by a notice.</p>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            {period ? `No records for ${describeLogbookPeriod(period)}.` : "Choose a period."}
          </p>
        )}

        <div>
          <label htmlFor="delete-records-confirm" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Type <span className="font-mono font-semibold text-foreground">{industry.id}</span> to confirm
          </label>
          <input
            id="delete-records-confirm"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={industry.id}
            className={inputCls}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-lg" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button className="gap-2 rounded-lg bg-red-600 text-white hover:bg-red-600/90" disabled={!canDelete} onClick={submit}>
            <Trash2 className="h-4 w-4" /> {busy ? "Deleting…" : "Delete records"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
