import { authorisedQuantities, type AuthorisedQuantity } from "@/lib/data/etp-calc";
import type { Industry } from "@/lib/types";
import { formatDate, formatNumber } from "@/lib/utils";

const quantity = (q: AuthorisedQuantity | null, period: string) => (q ? `${formatNumber(q.quantity)} ${q.unit === "MT" ? "MT" : "kg"} per ${period}` : "Not set");
const validity = (from?: string, to?: string) => (from || to ? `${formatDate(from ?? null)} to ${formatDate(to ?? null)}` : "—");
const shown = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : String(v));

/** A registered unit's registration details, read-only, section by section as the form has them. */
export function RegistrationDetails({ industry }: { industry: Industry }) {
  const q = authorisedQuantities(industry);
  const sections: { title: string; rows: [string, string][] }[] = [
    {
      title: "Unit details",
      rows: [
        ["Owner", shown(industry.ownerName)],
        ["Address", shown(industry.address)],
        ["Area / Location", shown(industry.area)],
        ["Tehsil / District", [industry.tehsil, industry.district].filter(Boolean).join(" / ") || "—"],
        ["MIS ID", shown(industry.misId)],
        ["Mobile", shown(industry.mobile)],
        ["Email (login)", shown(industry.email)],
      ],
    },
    {
      title: "Consent",
      rows: [
        ["Consent Order No.", shown(industry.consentOrderNo ?? industry.consentNumber)],
        ["Order date", formatDate(industry.consentOrderDate ?? null)],
        ["Validity", validity(industry.consentValidFrom, industry.consentValidTo)],
      ],
    },
    {
      title: "Hazardous waste",
      rows: [
        ["HWM Authorization No.", shown(industry.hwmAuthNo)],
        ["Order date", formatDate(industry.hwmAuthDate ?? null)],
        ["Validity", validity(industry.hwmValidFrom, industry.hwmValidTo)],
        ["Authorised quantity per day", quantity(q.perDay, "day")],
        ["Authorised quantity per year", quantity(q.perYear, "year")],
        ["TSDF", shown(industry.tsdfName)],
        ["TSDF address", shown(industry.tsdfAddress)],
        ["Remarks", shown(industry.hwmRemarks)],
      ],
    },
    {
      title: "Authorised signatory",
      rows: [
        ["Name", shown(industry.signatoryName)],
        ["Designation", shown(industry.signatoryDesignation)],
      ],
    },
  ];
  return (
    <div className="space-y-3">
      {sections.map((s) => (
        <div key={s.title} className="rounded-xl border border-border bg-muted/30 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</p>
          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            {s.rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
                <dd className="mb-1 whitespace-pre-wrap break-words font-medium text-foreground sm:mb-0">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
