"use client";

import type { EtpEntry, Industry, HwLedger, MeterReading } from "@/lib/types";
import { WATER_METERS, ENERGY_METERS, WATER_SHEET_GROUPS } from "@/lib/constants";
import { formatDate } from "@/lib/utils";

/**
 * Regulator-facing print sheets for a single daily entry (RSPCB prescribed return):
 * two water sheets (meters 1–5 / 6–10), one energy sheet, one sludge sheet holding
 * both the ETP sludge and the ATFD/PAN salt ledgers. Rendered hidden on screen and
 * shown only under `@media print` (see globals.css `.etp-print` rules); the operator
 * uses the browser's Print → "Save as PDF". Labels are reproduced verbatim.
 */
export function EtpPrintSheets({ entry, industry }: { entry: EtpEntry; industry: Industry }) {
  const water = entry.water ?? {};
  const energy = entry.energy ?? {};
  return (
    <div className="etp-print hidden print:block" aria-hidden>
      <WaterSheet title="Daily Water Entry — Sheet 1" from={WATER_SHEET_GROUPS[0][0]} to={WATER_SHEET_GROUPS[0][1]} water={water} remark={entry.waterRemark} industry={industry} date={entry.date} />
      <WaterSheet title="Daily Water Entry — Sheet 2" from={WATER_SHEET_GROUPS[1][0]} to={WATER_SHEET_GROUPS[1][1]} water={water} remark={entry.waterRemark} industry={industry} date={entry.date} />
      <EnergySheet energy={energy} remark={entry.energyRemark} industry={industry} date={entry.date} />
      <SludgeSheet sludge={entry.sludge} salt={entry.salt} industry={industry} date={entry.date} />
    </div>
  );
}

function SheetMeta({ industry, date }: { industry: Industry; date: string }) {
  return (
    <div className="ps-meta">
      <div>
        <strong>{industry.name}</strong>
      </div>
      <div>
        MIS ID: {industry.misId || "—"} · Consent Order No.: {industry.consentOrderNo || industry.consentNumber}
      </div>
      <div>
        {industry.tehsil ? `Tehsil ${industry.tehsil} · ` : ""}
        {industry.district ? `District ${industry.district} · ` : ""}
        Date: {formatDate(date)}
      </div>
    </div>
  );
}

function WaterSheet({
  title,
  from,
  to,
  water,
  remark,
  industry,
  date,
}: {
  title: string;
  from: number;
  to: number;
  water: Record<string, MeterReading>;
  remark?: string;
  industry: Industry;
  date: string;
}) {
  return (
    <section className="ps-sheet">
      <h2>{title}</h2>
      <SheetMeta industry={industry} date={date} />
      <table className="ps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Meter</th>
            <th>Initial Reading</th>
            <th>Final Reading</th>
            <th>Total (M3)</th>
          </tr>
        </thead>
        <tbody>
          {WATER_METERS.slice(from, to).map((m, i) => {
            const r = water[m.key];
            return (
              <tr key={m.key}>
                <td>{from + i + 1}</td>
                <td>{m.label}</td>
                <td>{fmt(r?.initial)}</td>
                <td>{fmt(r?.final)}</td>
                <td>{fmt(r?.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ps-remark">
        <strong>Remark:</strong> {remark || "—"}
      </p>
    </section>
  );
}

function EnergySheet({ energy, remark, industry, date }: { energy: Record<string, MeterReading>; remark?: string; industry: Industry; date: string }) {
  return (
    <section className="ps-sheet">
      <h2>Daily Electricity / Energy Entry</h2>
      <SheetMeta industry={industry} date={date} />
      <table className="ps-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Meter</th>
            <th>Initial Reading</th>
            <th>Final Reading</th>
            <th>Total (Kwh)</th>
          </tr>
        </thead>
        <tbody>
          {ENERGY_METERS.map((m, i) => {
            const r = energy[m.key];
            return (
              <tr key={m.key}>
                <td>{i + 1}</td>
                <td>{m.label}</td>
                <td>{fmt(r?.initial)}</td>
                <td>{fmt(r?.final)}</td>
                <td>{fmt(r?.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ps-remark">
        <strong>Remark:</strong> {remark || "—"}
      </p>
    </section>
  );
}

function SludgeSheet({ sludge, salt, industry, date }: { sludge?: HwLedger; salt?: HwLedger; industry: Industry; date: string }) {
  return (
    <section className="ps-sheet">
      <h2>Daily Sludge &amp; Salt Ledgers</h2>
      <SheetMeta industry={industry} date={date} />
      <LedgerTable noun="Sludge" heading="ETP Sludge" ledger={sludge} />
      <LedgerTable noun="Salt" heading="ATFD Salt (MEE Section) / PAN Salt (MEE)" ledger={salt} />
    </section>
  );
}

function LedgerTable({ noun, heading, ledger }: { noun: string; heading: string; ledger?: HwLedger }) {
  return (
    <>
      <h3>{heading}</h3>
      <table className="ps-table">
        <thead>
          <tr>
            <th>Opening Balance in kg</th>
            <th>{noun} Generation in kg</th>
            <th>Date of disposal</th>
            <th>{noun} Dispatch / Disposal in kg</th>
            <th>Manifest No.</th>
            <th>Closing Balance in kg</th>
            <th>Remark</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{fmt(ledger?.opening)}</td>
            <td>{fmt(ledger?.generation)}</td>
            <td>{ledger?.dateOfDisposal || "—"}</td>
            <td>{fmt(ledger?.dispatch)}</td>
            <td>{ledger?.manifestNo || "—"}</td>
            <td>{fmt(ledger?.closing)}</td>
            <td>{ledger?.remark || "—"}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

const fmt = (n: number | undefined) => (n == null ? "—" : String(n));
