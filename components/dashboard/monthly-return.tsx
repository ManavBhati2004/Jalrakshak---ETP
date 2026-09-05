"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Printer, FileSpreadsheet, Save } from "lucide-react";
import { toast } from "sonner";
import { useDataStore } from "@/lib/store/data";
import { Button } from "@/components/ui/button";
import type { Industry } from "@/lib/types";
import { buildMonthlyCompliance, monthEntries } from "@/lib/data/monthly";
import { downloadMonthlyWorkbook } from "@/lib/data/excel-export";
import { MonthlyPrintSheets } from "@/components/dashboard/monthly-print-sheets";
import { ComplianceReportSheet } from "@/components/dashboard/compliance-report-sheet";
import { formatNumber } from "@/lib/utils";

export function MonthlyReturn({ industry }: { industry: Industry }) {
  const entries = useDataStore((s) => s.etpEntries);
  const setMonthlyProduction = useDataStore((s) => s.setMonthlyProduction);
  const [month, setMonth] = useState("");
  const [clothsInput, setClothsInput] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const n = new Date();
    setMonth(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`);
  }, []);

  const savedCloths = industry.monthlyProduction?.[month] ?? 0;
  useEffect(() => {
    setClothsInput(savedCloths ? String(savedCloths) : "");
  }, [savedCloths, month]);

  const summary = useMemo(
    () => (month ? buildMonthlyCompliance(entries, industry.id, month, Number(clothsInput) || 0) : null),
    [entries, industry.id, month, clothsInput],
  );
  const monthlyEntries = useMemo(() => (month ? monthEntries(entries, industry.id, month) : []), [entries, industry.id, month]);

  const saveCloths = () => {
    setMonthlyProduction(industry.id, month, Number(clothsInput) || 0);
    toast.success("Cloths production saved", { description: `${industry.name} · ${month}` });
  };

  const onDownload = async () => {
    if (!month) return;
    setDownloading(true);
    try {
      await downloadMonthlyWorkbook(industry, entries, month, Number(clothsInput) || savedCloths);
      toast.success("Excel workbook generated", { description: "The exact RSPCB 6-sheet monthly return." });
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDownloading(false);
    }
  };

  if (!summary) return null;

  return (
    <div className="space-y-5">
      {/* controls (hidden when printing) */}
      <div className="mr-screen flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Reporting month</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Cloths Production – in meters (manual)</label>
            <div className="flex gap-2">
              <input inputMode="numeric" maxLength={9} value={clothsInput} onChange={(e) => setClothsInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))} className={inputCls} placeholder="e.g. 1047593" />
              <Button variant="outline" onClick={saveCloths} className="h-10 gap-1.5 rounded-xl"><Save className="h-4 w-4" /> Save</Button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="h-10 gap-2 rounded-xl"><Printer className="h-4 w-4" /> Print</Button>
          <Button onClick={onDownload} disabled={downloading} className="h-10 gap-2 rounded-xl">
            <Download className="h-4 w-4" /> {downloading ? "Generating…" : "Download Excel"}
          </Button>
        </div>
      </div>

      {/* On-screen summary. Screen-only: the PRINTED output is the exact prescribed template. */}
      <div className="mr-screen rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
          <div>
            <h3 className="font-display text-base font-bold text-foreground">Monthly Compliance Report — {summary.month}</h3>
            <p className="text-xs text-muted-foreground">{industry.name} · MIS ID {industry.misId ?? "—"} · {summary.daysReported}/{summary.daysInMonth} days reported</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Cloths Production (manual)" value={`${formatNumber(summary.clothsProductionMeters)} m`} />
          <Metric label="Raw Fresh Water (auto-summed)" value={`${formatNumber(summary.rawFreshWaterM3)} m³`} />
          <Metric label="Raw Influent Generation (auto-summed)" value={`${formatNumber(summary.rawInfluentM3)} m³`} />
          <Metric label="RECYCLE WATER" value={`${formatNumber(summary.recycleWaterM3)} m³`} />
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          The full RSPCB 6-sheet workbook (daily water/RO/MEE/kWh grids + sludge-salt ledger in MT + this compliance report) is available via <span className="font-medium">Download Excel</span>. Figures use submitted/approved entries only.
        </p>
      </div>

      {/* The prescribed RSPCB compliance report, reproduced exactly (screen + print). */}
      <div className="mr-print rounded-2xl border border-border bg-card p-5">
        <ComplianceReportSheet industry={industry} summary={summary} />

        {/* daily-grid regulator sheets — print only (§12) */}
        <MonthlyPrintSheets industry={industry} monthly={monthlyEntries} month={month} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-primary">{value}</p>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background";
