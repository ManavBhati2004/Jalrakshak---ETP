"use client";

import { useMemo, useState } from "react";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore } from "@/lib/store/data";
import { PageHeader } from "@/components/dashboard/page-header";
import { MonthlyReturn } from "@/components/dashboard/monthly-return";

export default function MonthlyReturnPage() {
  const role = useAuthStore((s) => s.role);
  const industryId = useAuthStore((s) => s.industryId);
  const industries = useDataStore((s) => s.industries);
  const etpUnits = useMemo(() => industries.filter((i) => i.isIndividualETP), [industries]);
  const [sel, setSel] = useState("");
  const isAdmin = role === "monitoring-admin";
  const targetId = isAdmin ? sel || etpUnits[0]?.id : industryId;
  const industry = industries.find((i) => i.id === targetId);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="RSPCB Monthly Return"
        title="Monthly Return & Compliance Report"
        description="Download the exact RSPCB monthly workbook (6 sheets: water · RO · MEE · kWh · sludge/salt in MT · compliance) and the monthly compliance summary for the selected month."
      />
      {isAdmin && (
        <div className="mr-screen rounded-2xl border border-border bg-card p-4">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">ETP unit</label>
          <select value={targetId ?? ""} onChange={(e) => setSel(e.target.value)} className="h-10 w-full max-w-md rounded-xl border border-border bg-muted/30 px-3 text-sm">
            {etpUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · MIS {u.misId ?? "—"}
              </option>
            ))}
          </select>
        </div>
      )}
      {industry ? <MonthlyReturn industry={industry} /> : <p className="text-sm text-muted-foreground">No ETP unit available.</p>}
    </div>
  );
}
