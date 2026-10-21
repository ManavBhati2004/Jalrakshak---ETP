"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Lock as LockIcon, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDataStore } from "@/lib/store/data";
import { useMeterIssues } from "@/lib/hooks/use-meter-issues";
import { baselinesFrom, customColumnUnit, round2, type MeterBaseline } from "@/lib/data/etp-calc";
import {
  cellKey,
  computeCorrections,
  describeCorrectionField,
  isFiled,
  ledgerField,
  meterField,
  readingOf,
  unitRevisions,
  type LedgerField,
  type LogbookContext,
  type MeterKind,
} from "@/lib/data/logbook";
import { saveCorrections } from "@/lib/data/tenant-ops";
import { syncContext } from "@/lib/data/firestore-storage";
import { auth } from "@/lib/firebase";
import { daysInMonth } from "@/lib/data/monthly";
import { ENERGY_METERS, WATER_GROUPS, WATER_METERS } from "@/lib/constants";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import type { EtpEntry, Industry, MeterIssue } from "@/lib/types";

type TabId = "daily" | "ro" | "mee" | "energy" | "ledgers" | "custom";
type MeterCol = { kind: MeterKind; code: string; label: string; unit: string };

const NO_ISSUES: MeterIssue[] = [];
const LEDGERS = [
  { id: "sludge" as const, label: "ETP Sludge (kg)" },
  { id: "salt" as const, label: "MEE Salt (kg)" },
];
const LEDGER_COLS: { field: LedgerField | "closing"; label: string; kind: "num" | "date" | "text" | "derived" }[] = [
  { field: "opening", label: "Opening", kind: "num" },
  { field: "generation", label: "Generation", kind: "num" },
  { field: "dispatch", label: "Dispatch", kind: "num" },
  { field: "dateOfDisposal", label: "Date of disposal", kind: "date" },
  { field: "manifestNo", label: "Manifest No.", kind: "text" },
  { field: "closing", label: "Closing", kind: "derived" },
  { field: "remark", label: "Remark", kind: "text" },
];

/** The daily numeric standard as a keystroke filter: digits and one point, ≤7 integer digits, ≤2 decimals. */
const numFilter = (s: string) => {
  let v = s.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  const [int = "", dec = ""] = v.split(".");
  return v.includes(".") ? `${int.slice(0, 7)}.${dec.slice(0, 2)}` : int.slice(0, 7);
};
const numText = (v: number | null | undefined) => (v == null ? "" : String(v));
/** A running stock balance may have up to 10 integer digits. */
const balanceFilter = (s: string) => {
  let v = s.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  const [int = "", dec = ""] = v.split(".");
  return v.includes(".") ? `${int.slice(0, 10)}.${dec.slice(0, 2)}` : int.slice(0, 10);
};

function statusOf(e: EtpEntry | undefined): { label: string; tone: string } {
  if (!e) return { label: "Not filed", tone: "text-muted-foreground" };
  if (e.entryStatus === "DRAFT") return { label: "Draft", tone: "text-amber-600" };
  if (e.status === "rejected") return { label: "Rejected", tone: "text-red-600" };
  if (e.status === "approved") return { label: "Approved", tone: "text-emerald-600" };
  return { label: "Pending", tone: "text-sky-600" };
}

const cellCls =
  "h-8 w-24 rounded-md border border-border bg-background px-1.5 text-right font-mono text-xs outline-none transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/15";
const thCls = "whitespace-nowrap border-b border-border px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const tdCls = "border-b border-border/60 px-2 py-1 align-middle";

/**
 * The Monitoring Body's Excel-like sheet for one unit and month. Cells hold what the unit submitted;
 * typing into a cell previews the correction live - totals, the next day's Initial and later
 * Sludge & Salt balances move as they will on save. Nothing is written until "Save corrections",
 * which re-checks everything against the server copy inside a transaction.
 */
export function LogbookSheet({ industry, month }: { industry: Industry; month: string }) {
  const etpEntries = useDataStore((s) => s.etpEntries);
  const issueFeed = useMeterIssues([industry.id]);
  const issues = issueFeed.byUnit[industry.id] ?? NO_ISSUES;
  const baselinesJson = useMemo(() => JSON.stringify(baselinesFrom(issues)), [issues]);
  const baselines = useMemo(() => JSON.parse(baselinesJson) as MeterBaseline[], [baselinesJson]);
  const ctx: LogbookContext = useMemo(() => ({ industry, baselines }), [industry, baselines]);
  const customColumns = useMemo(() => [...(industry.customColumns ?? [])].sort((a, b) => a.order - b.order), [industry.customColumns]);

  const [edits, setEdits] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabId>("daily");
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  // A ref, not state: a second click can land before the re-render that disables the button.
  const inFlight = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  /**
   * The unit's entry revisions when the officer started correcting. Saving is checked against THIS,
   * not against whatever has synced since: a day the ETP re-filed or edited while corrections were
   * being typed refuses the save instead of being overwritten - even though the sheet shows it live.
   */
  const baseRevisions = useRef<Record<string, string> | null>(null);

  const preview = useMemo(() => computeCorrections(etpEntries, industry.id, edits, ctx), [etpEntries, industry.id, edits, ctx]);
  const previewById = useMemo(() => new Map(preview.entries.map((e) => [e.id, e])), [preview]);
  const dates = useMemo(() => Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`), [month]);
  const storedByDate = useMemo(
    () => new Map(etpEntries.filter((e) => e.industryId === industry.id && e.date.startsWith(`${month}-`)).map((e) => [e.date, e])),
    [etpEntries, industry.id, month],
  );
  const errorAt = useMemo(() => new Map(preview.errors.map((e) => [cellKey(e.date, e.field), e.message])), [preview.errors]);
  /** The previous day's closing per day and ledger - the value an opening is normally carried from. */
  const prevClosing = useMemo(() => {
    const out = new Map<string, number>();
    for (const { id: l } of LEDGERS) {
      const chain = preview.entries.filter((e) => e.industryId === industry.id && e[l]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      for (let i = 1; i < chain.length; i++) out.set(`${chain[i].date}|${l}`, chain[i - 1][l]!.closing);
    }
    return out;
  }, [preview.entries, industry.id]);

  const editCount = Object.keys(edits).length;
  const ready = issueFeed.loaded;

  const tabs: { id: TabId; label: string }[] = [
    ...WATER_GROUPS.map((g) => ({ id: g.id as TabId, label: g.id === "daily" ? "Daily (M3)" : g.id === "ro" ? "RO (M3)" : "MEE (M3)" })),
    { id: "energy", label: "Energy (Kwh)" },
    { id: "ledgers", label: "Sludge & Salt (kg)" },
    ...(customColumns.length ? [{ id: "custom" as TabId, label: "Custom" }] : []),
  ];
  const meterCols: MeterCol[] =
    tab === "energy"
      ? ENERGY_METERS.map((m) => ({ kind: "energy", code: m.code, label: m.label, unit: "Kwh" }))
      : tab === "custom"
        ? customColumns.map((c) => ({ kind: "custom", code: c.id, label: c.name, unit: customColumnUnit(c) }))
        : WATER_METERS.filter((m) => m.group === tab).map((m) => ({ kind: "water", code: m.code, label: m.label, unit: "M3" }));

  const setCell = (date: string, field: string, raw: string, storedText: string, shownText: string) => {
    const key = cellKey(date, field);
    const next = { ...edits };
    // Typing the submitted value back undoes the edit - except for an opening an earlier correction
    // has moved: there, typing the old value means "keep it", so the edit stays and pins it.
    if (raw === storedText && (!field.endsWith(".opening") || shownText === storedText)) delete next[key];
    else next[key] = raw;
    if (Object.keys(next).length === 0) baseRevisions.current = null;
    else if (!baseRevisions.current) baseRevisions.current = unitRevisions(useDataStore.getState().etpEntries, industry.id);
    setEdits(next);
  };
  const discard = () => {
    baseRevisions.current = null;
    setEdits({});
  };

  /** Excel-style movement: Enter / ↓ to the next submitted day in the same column, ↑ back. */
  const onNavKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const dir = e.key === "ArrowDown" || e.key === "Enter" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const col = e.currentTarget.dataset.col;
    for (let r = Number(e.currentTarget.dataset.row) + dir; r >= 0 && r < dates.length; r += dir) {
      const el = gridRef.current?.querySelector<HTMLInputElement>(`input[data-col="${col}"][data-row="${r}"]`);
      if (el) {
        el.focus();
        el.select();
        return;
      }
    }
  };

  /** One editable cell. A plain function (not a component) so typing never remounts the input. */
  const input = (opts: { date: string; row: number; field: string; shown: string; stored: string; label: string; type?: "num" | "date" | "text" }) => {
    const key = cellKey(opts.date, opts.field);
    const edited = key in edits;
    const error = errorAt.get(key);
    const type = opts.type ?? "num";
    return (
      <input
        data-col={opts.field}
        data-row={opts.row}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "num" ? "decimal" : undefined}
        value={edited ? edits[key] : opts.shown}
        onChange={(e) =>
          setCell(opts.date, opts.field, type === "num" ? (opts.field.endsWith(".opening") ? balanceFilter : numFilter)(e.target.value) : e.target.value, opts.stored, opts.shown)
        }
        onKeyDown={onNavKey}
        aria-label={`${opts.label} on ${formatDate(opts.date)}`}
        aria-invalid={!!error}
        title={error ?? (edited ? `Submitted: ${opts.stored || "blank"}` : undefined)}
        className={cn(
          cellCls,
          type !== "num" && "w-32 text-left font-sans",
          edited && "border-amber-500 bg-amber-50 dark:bg-amber-500/10",
          !edited && opts.shown !== opts.stored && "bg-amber-50/60 dark:bg-amber-500/5",
          error && "border-red-500 bg-red-50 dark:bg-red-500/10",
        )}
      />
    );
  };

  const derived = (value: string, hint?: string, moved?: boolean) => (
    <span title={hint} className={cn("inline-flex items-center gap-1 font-mono text-xs text-muted-foreground", moved && "rounded bg-amber-50 px-1 text-amber-800 dark:bg-amber-500/10")}>
      {hint ? <LockIcon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {value}
    </span>
  );

  const rows = dates.map((date, row) => {
    const stored = storedByDate.get(date);
    const filed = !!stored && isFiled(stored);
    const shown = stored ? previewById.get(stored.id) : undefined;
    return { date, row, stored, filed, shown, status: statusOf(stored) };
  });

  // ---- save ----
  const changeList = useMemo(
    () =>
      [...preview.changes.entries()]
        .map(([id, changes]) => ({ entry: previewById.get(id)!, changes, carried: preview.carriedOnly.has(id) }))
        .sort((a, b) => (a.entry.date < b.entry.date ? -1 : 1)),
    [preview, previewById],
  );
  const canSave = ready && editCount > 0 && preview.errors.length === 0 && preview.changes.size > 0 && !saving;

  const onSave = async () => {
    if (inFlight.current || !canSave) return;
    if (!syncContext.ready) {
      toast.info("Still loading the latest data", { description: "Try again in a moment." });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    const user = auth.currentUser;
    const base = baseRevisions.current ?? {};
    const expected = Object.fromEntries([...preview.changes.keys()].map((id) => [id, base[id] ?? ""]));
    const res = await saveCorrections(industry.id, edits, ctx, expected, {
      uid: user?.uid ?? "",
      email: user?.email ?? undefined,
    });
    inFlight.current = false;
    setSaving(false);
    setConfirming(false);
    if (!res.ok) {
      toast.error("Corrections not saved", { description: res.error });
      return;
    }
    toast.success("Corrections saved", {
      description: `${res.corrected} day${res.corrected === 1 ? "" : "s"} updated. ${industry.name} sees the corrected readings in its logbook.`,
    });
    discard();
  };

  const fmtChange = (v: number | string | null) => (v == null || v === "" ? "blank" : typeof v === "number" ? formatNumber(v) : v);

  // ---- tables ----
  const statusCell = (r: (typeof rows)[number]) => (
    <td className={cn(tdCls, "whitespace-nowrap text-[11px] font-medium", r.status.tone)}>
      {r.status.label}
      {r.stored?.corrections?.some((c) => !c.carried) ? (
        <span
          title={`Corrected on ${formatDate(r.stored.corrections.filter((c) => !c.carried).at(-1)!.at, true)}`}
          className="ml-1.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-violet-700"
        >
          Corrected
        </span>
      ) : null}
    </td>
  );
  const dateCell = (date: string) => (
    <td className={cn(tdCls, "sticky left-0 z-10 whitespace-nowrap bg-card text-xs font-medium text-foreground")}>{formatDate(date)}</td>
  );

  const meterTable = () => {
    const totals: Record<string, number> = {};
    let grand = 0;
    const group = tab === "daily" || tab === "ro" || tab === "mee" ? tab : null;
    const body = rows.map((r) => {
      const cells: ReactNode[] = meterCols.map((m) => {
        const now = readingOf(r.shown, m.kind, m.code);
        const was = readingOf(r.stored, m.kind, m.code);
        const fI = meterField(m.kind, m.code, "initial");
        const fF = meterField(m.kind, m.code, "final");
        if (r.filed && now) totals[m.code] = round2((totals[m.code] ?? 0) + now.total);
        const initEditable = r.filed && ready && preview.editableInitials.has(cellKey(r.date, fI));
        return [
          <td key={`${m.code}-i`} className={tdCls}>
            {initEditable
              ? input({ date: r.date, row: r.row, field: fI, shown: numText(now?.initial), stored: numText(was?.initial), label: `${m.label} Initial` })
              : now
                ? derived(formatNumber(now.initial), r.filed ? "Follows the previous day's Final - correct that Final instead." : undefined, now.initial !== was?.initial)
                : null}
          </td>,
          <td key={`${m.code}-f`} className={tdCls}>
            {r.filed && ready
              ? input({ date: r.date, row: r.row, field: fF, shown: numText(now?.final), stored: numText(was?.final), label: `${m.label} Final` })
              : now
                ? derived(formatNumber(now.final))
                : null}
          </td>,
          <td key={`${m.code}-t`} className={cn(tdCls, "text-right font-mono text-xs font-semibold", now && now.total !== was?.total && "text-amber-700")}>
            {now ? formatNumber(now.total) : ""}
          </td>,
        ];
      });
      const rowGrand = group && r.shown?.waterTotals ? r.shown.waterTotals[group] : null;
      if (r.filed && rowGrand != null) grand = round2(grand + rowGrand);
      return (
        <tr key={r.date} className={cn(!r.filed && "bg-muted/30")}>
          {dateCell(r.date)}
          {statusCell(r)}
          {cells}
          {group ? <td className={cn(tdCls, "text-right font-mono text-xs font-bold text-primary")}>{rowGrand != null && r.shown ? formatNumber(rowGrand) : ""}</td> : null}
        </tr>
      );
    });
    return (
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-card">
          <tr>
            <th rowSpan={2} className={cn(thCls, "sticky left-0 z-30 bg-card")}>
              Date
            </th>
            <th rowSpan={2} className={thCls}>
              Status
            </th>
            {meterCols.map((m) => (
              <th key={m.code} colSpan={3} className={cn(thCls, "border-l border-border text-center normal-case tracking-normal text-foreground")}>
                {m.label} <span className="text-muted-foreground">({m.unit})</span>
              </th>
            ))}
            {group ? (
              <th rowSpan={2} className={cn(thCls, "border-l border-border")}>
                Grand Total
              </th>
            ) : null}
          </tr>
          <tr>
            {meterCols.map((m) => [
              <th key={`${m.code}-i`} className={cn(thCls, "border-l border-border")}>
                Initial
              </th>,
              <th key={`${m.code}-f`} className={thCls}>
                Final
              </th>,
              <th key={`${m.code}-t`} className={thCls}>
                Total
              </th>,
            ])}
          </tr>
        </thead>
        <tbody>{body}</tbody>
        <tfoot>
          <tr className="bg-muted/40">
            <td className={cn(tdCls, "sticky left-0 z-10 bg-muted text-xs font-semibold")}>Monthly total</td>
            <td className={tdCls} />
            {meterCols.map((m) => [
              <td key={`${m.code}-i`} className={tdCls} />,
              <td key={`${m.code}-f`} className={tdCls} />,
              <td key={`${m.code}-t`} className={cn(tdCls, "text-right font-mono text-xs font-bold")}>
                {formatNumber(totals[m.code] ?? 0)}
              </td>,
            ])}
            {group ? <td className={cn(tdCls, "text-right font-mono text-xs font-bold text-primary")}>{formatNumber(grand)}</td> : null}
          </tr>
        </tfoot>
      </table>
    );
  };

  const ledgerTable = () => (
    <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-20 bg-card">
        <tr>
          <th rowSpan={2} className={cn(thCls, "sticky left-0 z-30 bg-card")}>
            Date
          </th>
          <th rowSpan={2} className={thCls}>
            Status
          </th>
          {LEDGERS.map((l) => (
            <th key={l.id} colSpan={LEDGER_COLS.length} className={cn(thCls, "border-l border-border text-center normal-case tracking-normal text-foreground")}>
              {l.label}
            </th>
          ))}
        </tr>
        <tr>
          {LEDGERS.map((l) =>
            LEDGER_COLS.map((c, i) => (
              <th key={`${l.id}-${c.field}`} className={cn(thCls, i === 0 && "border-l border-border")}>
                {c.label}
              </th>
            )),
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.date} className={cn(!r.filed && "bg-muted/30")}>
            {dateCell(r.date)}
            {statusCell(r)}
            {LEDGERS.map((l) =>
              LEDGER_COLS.map((c) => {
                const now = r.shown?.[l.id];
                const was = r.stored?.[l.id];
                const field = ledgerField(l.id, c.field);
                if (c.kind === "derived") {
                  return (
                    <td key={field} className={cn(tdCls, "text-right font-mono text-xs font-semibold", now && now.closing !== was?.closing && "text-amber-700")}>
                      {now ? formatNumber(now.closing) : ""}
                    </td>
                  );
                }
                const value = now?.[c.field as LedgerField];
                const stored = was?.[c.field as LedgerField];
                const prev = prevClosing.get(`${r.date}|${l.id}`);
                const flag = c.field === "opening" && now && prev !== undefined && round2(now.opening) !== round2(prev);
                return (
                  <td key={field} className={tdCls}>
                    <span className="inline-flex items-center gap-1">
                      {r.filed && ready
                        ? input({
                            date: r.date,
                            row: r.row,
                            field,
                            shown: c.kind === "num" ? numText(value as number | undefined) : String(value ?? ""),
                            stored: c.kind === "num" ? numText(stored as number | undefined) : String(stored ?? ""),
                            label: `${l.label} ${c.label}`,
                            type: c.kind as "num" | "date" | "text",
                          })
                        : now
                          ? derived(c.kind === "num" ? formatNumber(Number(value ?? 0)) : String(value ?? ""))
                          : null}
                      {flag ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                          title={`Differs from the previous day's closing (${formatNumber(prev!)} kg)`}
                          aria-label="Opening differs from the previous day's closing"
                        />
                      ) : null}
                    </span>
                  </td>
                );
              }),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Logbook sheets">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          White cells are editable · <LockIcon className="inline h-3 w-3" aria-hidden /> follows the previous day · amber = changed · red = needs fixing
        </p>
      </div>

      {!ready ? <p className="p-4 text-sm text-muted-foreground">Loading meter baselines…</p> : null}
      {issueFeed.error ? (
        <p className="m-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
          Meter resets for this unit could not be loaded, so Initials after a reset may show as editable starts.
        </p>
      ) : null}

      <div ref={gridRef} className="max-h-[70vh] overflow-auto">
        {tab === "ledgers" ? ledgerTable() : meterTable()}
      </div>

      {preview.errors.length ? (
        <ul className="space-y-0.5 border-t border-border px-4 py-3 text-xs text-red-600">
          {preview.errors.slice(0, 6).map((e) => (
            <li key={`${e.date}|${e.field}`}>
              {formatDate(e.date)} · {describeCorrectionField(e.field, customColumns)}: {e.message}
            </li>
          ))}
          {preview.errors.length > 6 ? <li>…and {preview.errors.length - 6} more</li> : null}
        </ul>
      ) : null}

      <div className="sticky bottom-0 flex flex-col gap-2 rounded-b-2xl border-t border-border bg-card/95 p-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {editCount === 0
            ? "No changes. Type into a cell to correct a reading."
            : `${editCount} cell${editCount === 1 ? "" : "s"} changed · ${preview.changes.size} day${preview.changes.size === 1 ? "" : "s"} affected${
                preview.errors.length ? ` · ${preview.errors.length} to fix` : ""
              }`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" disabled={editCount === 0 || saving} onClick={discard} className="h-10 gap-1.5 rounded-xl">
            <Undo2 className="h-4 w-4" /> Discard
          </Button>
          <Button disabled={!canSave} onClick={() => setConfirming(true)} className="h-10 gap-1.5 rounded-xl">
            <Save className="h-4 w-4" /> Save corrections
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !o && !saving && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save these corrections?</DialogTitle>
            <DialogDescription>
              {industry.name} · {preview.changes.size} day{preview.changes.size === 1 ? "" : "s"}. The unit will see the corrected readings in its logbook. Each
              day keeps its status, and the correction is recorded with your name and the time.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto text-xs">
            {changeList.slice(0, 31).map(({ entry, changes, carried }) => (
              <div key={entry.id}>
                <p className="font-semibold text-foreground">
                  {formatDate(entry.date)}
                  {carried ? <span className="ml-1 font-normal text-muted-foreground">(follows an earlier correction)</span> : null}
                </p>
                <ul className="ml-3 list-disc text-muted-foreground">
                  {changes.map((c) => (
                    <li key={c.field}>
                      {describeCorrectionField(c.field, customColumns)}: {fmtChange(c.from)} → <span className="font-semibold text-foreground">{fmtChange(c.to)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {changeList.length > 31 ? <p className="text-muted-foreground">…and {changeList.length - 31} more days</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-lg" disabled={saving} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button className="gap-2 rounded-lg" disabled={saving} onClick={onSave}>
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save corrections"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
