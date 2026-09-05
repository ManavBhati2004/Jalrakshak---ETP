"use client";

import type { EtpEntry, Industry } from "@/lib/types";
import { WATER_METERS, ENERGY_METERS, RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON } from "@/lib/constants";
import { round1, kgToMt } from "@/lib/data/etp-calc";
import { daysInMonth, ledgerRollup } from "@/lib/data/monthly";
import { formatNumber, formatDate } from "@/lib/utils";

/**
 * Regulator-facing monthly print sheets (master §12), shown only under `@media print`.
 * Reproduces the client Excel's logical sheets as daily-total grids: three water sheets
 * (Daily / RO / MEE), one energy sheet and one sludge/salt ledger sheet — one row per
 * calendar day, per-sheet Grand Total. The exact Initial/Final/Total workbook is the
 * Excel download; this print keeps the daily totals legible on paper.
 */

type Section = { label: string; code: string };
const DAILY: Section[] = WATER_METERS.filter((m) => m.group === "daily").map((m) => ({ label: m.label, code: m.code }));
const RO: Section[] = WATER_METERS.filter((m) => m.group === "ro").map((m) => ({ label: m.label, code: m.code }));
const MEE: Section[] = WATER_METERS.filter((m) => m.group === "mee").map((m) => ({ label: m.label, code: m.code }));
const ENERGY: Section[] = ENERGY_METERS.map((m) => ({ label: m.label, code: m.code }));

const mt = (kg: number) => formatNumber(kgToMt(kg));

export function MonthlyPrintSheets({ industry, monthly, month }: { industry: Industry; monthly: EtpEntry[]; month: string }) {
  const days = daysInMonth(month);
  const byDate = new Map(monthly.map((e) => [e.date, e]));
  const dates = Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
  // Reuse the single monthly rollup - no second disposal formula anywhere.
  const sludgeDisposalKg = ledgerRollup(monthly, "sludge").disposalKg;

  return (
    <div className="mps hidden print:block" aria-hidden>
      <MeterGrid title="DAILY ETP LOG SHEET BOOK — Fresh / ETP / Tertiary / Reuse (M3)" unit="M3" kind="water" sections={DAILY} industry={industry} month={month} dates={dates} byDate={byDate} />
      <MeterGrid title="RO Section (M3)" unit="M3" kind="water" sections={RO} exclude={RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON ? ["RO_PERMEATE_COMMON"] : []} industry={industry} month={month} dates={dates} byDate={byDate} />
      <MeterGrid title="MEE Section (M3)" unit="M3" kind="water" sections={MEE} industry={industry} month={month} dates={dates} byDate={byDate} />
      <MeterGrid title="Daily Electricity / Energy (Kwh)" unit="Kwh" kind="energy" sections={ENERGY} industry={industry} month={month} dates={dates} byDate={byDate} />
      <LedgerGrid industry={industry} month={month} dates={dates} byDate={byDate} sludgeDisposalKg={sludgeDisposalKg} />
    </div>
  );
}

function SheetHead({ industry, month, title }: { industry: Industry; month: string; title: string }) {
  return (
    <div className="mps-head">
      <h2>{title}</h2>
      <div className="mps-meta">
        <span><strong>{industry.name}</strong></span>
        <span>MIS ID: {industry.misId || "—"}</span>
        <span>Tehsil {industry.tehsil || "—"} · District {industry.district || "—"}</span>
        <span>Month: {month}</span>
        <span>Consent: {industry.consentOrderNo || industry.consentNumber || "—"}</span>
      </div>
    </div>
  );
}

function MeterGrid({
  title,
  unit,
  kind,
  sections,
  exclude = [],
  industry,
  month,
  dates,
  byDate,
}: {
  title: string;
  unit: string;
  kind: "water" | "energy";
  sections: Section[];
  exclude?: string[];
  industry: Industry;
  month: string;
  dates: string[];
  byDate: Map<string, EtpEntry>;
}) {
  const colTotals: Record<string, number> = {};
  let grandSum = 0;
  return (
    <section className="mps-sheet">
      <SheetHead industry={industry} month={month} title={title} />
      <table className="mps-table">
        <thead>
          <tr>
            <th className="mps-date">Date</th>
            {sections.map((s) => (
              <th key={s.code}>{s.label}<br />Total ({unit})</th>
            ))}
            <th>Grand Total</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const e = byDate.get(d);
            const readings = e?.[kind];
            let rowGrand = 0;
            const cells = sections.map((s) => {
              const m = readings?.[s.code];
              if (m) {
                colTotals[s.code] = round1((colTotals[s.code] ?? 0) + m.total);
                if (!exclude.includes(s.code)) rowGrand = round1(rowGrand + m.total);
              }
              return m ? formatNumber(m.total) : "";
            });
            if (e) grandSum = round1(grandSum + rowGrand);
            return (
              <tr key={d} className={e ? "" : "mps-missing"}>
                <td className="mps-date">{formatDate(d)}</td>
                {cells.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
                <td className="mps-total">{e ? formatNumber(rowGrand) : ""}</td>
              </tr>
            );
          })}
          <tr className="mps-foot">
            <td className="mps-date">Monthly Total</td>
            {sections.map((s) => (
              <td key={s.code}>{formatNumber(colTotals[s.code] ?? 0)}</td>
            ))}
            <td className="mps-total">{formatNumber(grandSum)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function LedgerGrid({ industry, month, dates, byDate, sludgeDisposalKg }: { industry: Industry; month: string; dates: string[]; byDate: Map<string, EtpEntry>; sludgeDisposalKg: number }) {
  return (
    <section className="mps-sheet">
      <SheetHead industry={industry} month={month} title="Sludge & MEE-Salt Ledgers (MT)" />
      <table className="mps-table">
        <thead>
          <tr>
            <th className="mps-date" rowSpan={2}>Date</th>
            <th colSpan={4}>ETP Sludge (MT)</th>
            <th colSpan={4}>ATFD Salt (MEE Section) / PAN Salt (MEE) (MT)</th>
          </tr>
          <tr>
            <th>Opening</th><th>Generation</th><th>Disposal</th><th>Closing</th>
            <th>Opening</th><th>Generation</th><th>Disposal</th><th>Closing</th>
          </tr>
        </thead>
        <tbody>
          {dates.map((d) => {
            const e = byDate.get(d);
            const s = e?.sludge;
            const t = e?.salt;
            return (
              <tr key={d} className={e ? "" : "mps-missing"}>
                <td className="mps-date">{formatDate(d)}</td>
                <td>{s ? mt(s.opening) : ""}</td><td>{s ? mt(s.generation) : ""}</td><td>{s ? mt(s.dispatch) : ""}</td><td className="mps-total">{s ? mt(s.closing) : ""}</td>
                <td>{t ? mt(t.opening) : ""}</td><td>{t ? mt(t.generation) : ""}</td><td>{t ? mt(t.dispatch) : ""}</td><td className="mps-total">{t ? mt(t.closing) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mps-note">
        Authorised quantity (ETP sludge): {industry.authorisedQuantityKg ? `${mt(industry.authorisedQuantityKg)} MT` : "—"}
        <br />
        Sum of Disposal During Month: {mt(sludgeDisposalKg)} MT
        <br />
        MEE-salt authorisation: not configured. Exact Initial/Final meter readings are in the Excel workbook download.
      </p>
    </section>
  );
}
