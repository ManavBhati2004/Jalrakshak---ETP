"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { LogbookSheet } from "@/components/dashboard/logbook-sheet";
import { useDataStore } from "@/lib/store/data";
import { useHydrated } from "@/lib/hooks/use-hydrated";

/** The current month as YYYY-MM, from the device's calendar. */
const thisMonth = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Monitoring Body: the Reading Logbook. Every reading a unit submitted for a month, laid out like the
 * RSPCB workbook, with mistaken readings correctable in place. The unit sees the corrected values in
 * its own logbook, and each correction is recorded on the day it changed.
 */
export default function LogbookPage() {
  const industries = useDataStore((s) => s.industries);
  const etpUnits = useMemo(() => industries.filter((i) => i.isIndividualETP), [industries]);
  const hydrated = useHydrated();
  const [sel, setSel] = useState("");
  const [picked, setPicked] = useState("");
  // The default month is read after mount, so the server render and the first client render agree.
  const month = picked || (hydrated ? thisMonth() : "");
  const industry = industries.find((i) => i.id === (sel || etpUnits[0]?.id));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring Body"
        title="Reading Logbook"
        description="Every reading a unit submitted, one row per day, laid out like the RSPCB workbook. Correct a mistaken reading here — the unit sees the corrected value in its own logbook, and each correction is recorded."
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="logbook-unit" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            ETP unit
          </label>
          <select
            id="logbook-unit"
            value={industry?.id ?? ""}
            onChange={(e) => setSel(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm"
          >
            {etpUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · MIS {u.misId ?? "—"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="logbook-month" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Month
          </label>
          <input
            id="logbook-month"
            type="month"
            value={month}
            onChange={(e) => e.target.value && setPicked(e.target.value)}
            className="h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm sm:w-48"
          />
        </div>
      </div>

      {industry && month ? (
        // Keyed so switching unit or month starts from a clean sheet with no carried-over edits.
        <LogbookSheet key={`${industry.id}|${month}`} industry={industry} month={month} />
      ) : (
        <p className="text-sm text-muted-foreground">{etpUnits.length ? "Loading…" : "No ETP units registered."}</p>
      )}
    </div>
  );
}
