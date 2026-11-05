"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { DocumentsPanel } from "@/components/dashboard/documents-panel";
import { useDataStore } from "@/lib/store/data";

/**
 * Monitoring Body: one unit's compliance documents in one place - the PDFs it uploaded, to view and
 * download, and the status and remark set here on its consents and authorization.
 */
export default function DocumentsPage() {
  const industries = useDataStore((s) => s.industries);
  const etpUnits = useMemo(() => industries.filter((i) => i.isIndividualETP), [industries]);
  const [sel, setSel] = useState("");
  const industry = etpUnits.find((i) => i.id === sel) ?? etpUnits[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring Body"
        title="Compliance Documents"
        description="The CTE, CTO, authorization and notice PDFs each unit has uploaded. View or download them, and set the status and remark the unit sees."
      />

      <div className="rounded-2xl border border-border bg-card p-4">
        <label htmlFor="documents-unit" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          ETP unit
        </label>
        <select
          id="documents-unit"
          value={industry?.id ?? ""}
          onChange={(e) => setSel(e.target.value)}
          className="h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm"
        >
          {etpUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.id})
            </option>
          ))}
        </select>
      </div>

      {industry ? (
        // Keyed so a unit's documents never show, even briefly, under another unit's name.
        <DocumentsPanel key={industry.id} industryId={industry.id} industryName={industry.name} canUpload={false} canReview />
      ) : (
        <p className="text-sm text-muted-foreground">No ETP units registered.</p>
      )}
    </div>
  );
}
