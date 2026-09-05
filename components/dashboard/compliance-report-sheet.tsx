"use client";

import type { Industry } from "@/lib/types";
import type { MonthlyCompliance } from "@/lib/data/monthly";
import { daysInMonth } from "@/lib/data/monthly";
import { kgToMt } from "@/lib/data/etp-calc";
import { formatNumber } from "@/lib/utils";

/* ============================================================================
   Compliance Report - ETP Unit
   EXACT reproduction of the client's prescribed format (sheet "Compliance Report 5" of
   "7. MAYANK TEXOFIN JULY 2026.xlsx", matching the supplied photo). Six columns, the
   client's own row numbering (which genuinely jumps 13 -> 22 -> 24 -> 25), and their
   static wording preserved VERBATIM - including the typos "Uit ID", "Consent oredr no.",
   "Manifeast no" and "Authoeized Signatory". Do not "fix" these: the regulator's template
   is the source of truth.
   ========================================================================== */

/** MT for display; a non-numeric figure renders blank, never "NaN". */
const mt = (kg: number) => (Number.isFinite(Number(kg)) ? formatNumber(kgToMt(Number(kg))) : "");

/** "01/07/2026 to 31/07/2026" - the template's reporting-period wording. */
function monthRangeLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return "";
  const [y, m] = month.split("-");
  return `01/${m}/${y} to ${String(daysInMonth(month)).padStart(2, "0")}/${m}/${y}`;
}

/** "2021-12-01" -> "01/12/2021"; anything else passes through untouched. */
function dmy(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function validity(from?: string, to?: string): string {
  const a = dmy(from);
  const b = dmy(to);
  return a && b ? `${a} to ${b}` : a || b || "";
}

const LEDGER_HEADS = [
  "Opening Balance as on 1 day of the month in MT",
  "Generation During Month in MT",
  "Disposal During Month in MT",
  "Closing stock of sludge on the last day of month in MT",
];

export function ComplianceReportSheet({ industry, summary }: { industry: Industry; summary: MonthlyCompliance }) {
  const range = monthRangeLabel(summary.month);
  const manifests = summary.manifests;

  return (
    <div className="crs-wrap overflow-x-auto">
      <table className="crs w-full border-collapse text-[13px]">
        <colgroup>
          <col className="crs-c-no" />
          <col className="crs-c-label" />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={6} className="crs-title">Compliance Report ETP Unit</td>
          </tr>

          <KV n={1} label="Name of unit" value={industry.name} />
          <KV n={2} label="Uit ID" value={industry.misId ?? ""} />
          <KV n={3} label="Address" value={industry.address ?? industry.area ?? ""} />
          <KV n={4} label="Email" value={industry.email} />
          <KV n={5} label="Mobile" value={industry.mobile} />

          <tr>
            <td className="crs-no">6</td>
            <th className="crs-label">Consent oredr no.</th>
            <td className="crs-v">{industry.consentOrderNo ?? industry.consentNumber ?? ""}</td>
            <td className="crs-v">order date</td>
            <td className="crs-v">{validity(industry.consentValidFrom, industry.consentValidTo)}</td>
            <td className="crs-v">Validity</td>
          </tr>
          <tr>
            <td className="crs-no">7</td>
            <th className="crs-label">Authorization no.</th>
            <td className="crs-v">{industry.hwmAuthNo ?? ""}</td>
            <td className="crs-v">order date</td>
            <td className="crs-v">{validity(industry.hwmValidFrom, industry.hwmValidTo)}</td>
            <td className="crs-v">Validity</td>
          </tr>

          <KV
            n={8}
            label="Production (Monthly)(From 1st day of month to last day of month)"
            value={summary.clothsProductionMeters ? `${formatNumber(summary.clothsProductionMeters)} METERS` : ""}
          />

          <tr>
            <td className="crs-no" rowSpan={2}>9</td>
            <th className="crs-label" rowSpan={2}>Raw water Monthly</th>
            <td className="crs-v crs-head" colSpan={2}>Consumption</td>
            <td className="crs-v crs-head" colSpan={2}>Source</td>
          </tr>
          <tr>
            <td className="crs-v">{formatNumber(summary.rawFreshWaterM3)}</td>
            <td className="crs-v">M3</td>
            {/* Source is not captured anywhere in the app - left blank rather than fabricated. */}
            <td className="crs-v" />
            <td className="crs-v" />
          </tr>

          {/* 10 - the monthly sum of "ETP Inlet Section - Total of All Stream" */}
          <KV n={10} label="Trade Effluent Generation" value={`${formatNumber(summary.tradeEffluentGenerationM3)} M3`} />
          {/* 11 - Direct Reuse + RO Permeate 1&2 + RO Permeate 3&4 + MEE Condensate */}
          <KV n={11} label="Trade effluent recycled M3" value={`${formatNumber(summary.tradeEffluentRecycledM3)} M3`} />

          {/* 12-13 - not measured by this application; the template's own static wording */}
          <KV n={12} label="Boiler/Thermopack*" value="Monitoring results" />
          <KV n={13} label="AAQM*" value="Monitoring results" />

          <tr>
            <td className="crs-no">22</td>
            <th className="crs-label crs-section" colSpan={5}>Details of ETP Sludge</th>
          </tr>
          <tr>
            <td className="crs-no">23</td>
            <th className="crs-label crs-head">Date</th>
            {LEDGER_HEADS.map((h) => (
              <th key={h} className="crs-v crs-head">{h}</th>
            ))}
          </tr>
          <tr>
            <td className="crs-no" />
            <td className="crs-v">{range}</td>
            <td className="crs-v">{mt(summary.sludge.openingKg)}</td>
            <td className="crs-v">{mt(summary.sludge.generationKg)}</td>
            <td className="crs-v">{summary.sludge.disposalKg ? mt(summary.sludge.disposalKg) : ""}</td>
            <td className="crs-v">{mt(summary.sludge.closingKg)}</td>
          </tr>

          {/* The template carries two blank spacer rows here - reproduced, not "tidied away". */}
          <tr className="crs-spacer">
            <td className="crs-no" />
            <td className="crs-v" colSpan={5} />
          </tr>
          <tr className="crs-spacer">
            <td className="crs-no" />
            <td className="crs-v" colSpan={5} />
          </tr>

          <tr>
            <td className="crs-no">24</td>
            <th className="crs-label crs-section" colSpan={5}>Details of MEE salt</th>
          </tr>
          <tr>
            <td className="crs-no" />
            <th className="crs-label crs-head">Date</th>
            {LEDGER_HEADS.map((h) => (
              <th key={`salt-${h}`} className="crs-v crs-head">{h}</th>
            ))}
          </tr>
          <tr>
            <td className="crs-no" />
            <td className="crs-v">{range}</td>
            <td className="crs-v">{mt(summary.salt.openingKg)}</td>
            <td className="crs-v">{mt(summary.salt.generationKg)}</td>
            <td className="crs-v">{summary.salt.disposalKg ? mt(summary.salt.disposalKg) : ""}</td>
            <td className="crs-v">{mt(summary.salt.closingKg)}</td>
          </tr>

          <tr>
            <td className="crs-no" />
            <th className="crs-label crs-section" colSpan={5}>Details of manifest</th>
          </tr>
          <tr>
            <td className="crs-no">25</td>
            <th className="crs-label crs-head">S No.</th>
            <th className="crs-v crs-head">Date</th>
            <th className="crs-v crs-head">Manifeast no</th>
            <th className="crs-v crs-head">Type of waste</th>
            <th className="crs-v crs-head">Quantity</th>
          </tr>
          {manifests.length === 0 ? (
            <tr>
              <td className="crs-no" />
              <td className="crs-v">1</td>
              <td className="crs-v" />
              <td className="crs-v" />
              <td className="crs-v">ETP SLUDGE</td>
              <td className="crs-v" />
            </tr>
          ) : (
            manifests.map((m, i) => (
              <tr key={`${m.manifestNo}-${m.date}-${i}`}>
                <td className="crs-no" />
                <td className="crs-v">{i + 1}</td>
                <td className="crs-v">{dmy(m.date)}</td>
                <td className="crs-v">{m.manifestNo}</td>
                <td className="crs-v">{m.wasteType}</td>
                <td className="crs-v">{mt(m.quantityKg)}</td>
              </tr>
            ))
          )}

          <tr className="crs-spacer">
            <td className="crs-no" />
            <td className="crs-v" colSpan={5} />
          </tr>
          <tr className="crs-spacer">
            <td className="crs-no" />
            <td className="crs-v" colSpan={5} />
          </tr>

          <tr>
            <td colSpan={6} className="crs-sign">
              Name, Designation and Signature of Authoeized Signatory
              {industry.signatoryName ? ` - ${industry.signatoryName}${industry.signatoryDesignation ? ` (${industry.signatoryDesignation})` : ""}` : ""}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** One numbered label row whose value spans columns C:F. */
function KV({ n, label, value }: { n: number; label: string; value: string }) {
  return (
    <tr>
      <td className="crs-no">{n}</td>
      <th className="crs-label">{label}</th>
      <td className="crs-v" colSpan={4}>{value}</td>
    </tr>
  );
}
