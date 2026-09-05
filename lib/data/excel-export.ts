/* ============================================================
   JalRakshak — exact RSPCB monthly workbook (.xlsx) generator
   Reproduces the client's Excel (7. MAYANK TEXOFIN JULY 2026.xlsx): 6 sheets
   (Daily water / RO / MEE / kWh / Sludge-Salt in MT / Compliance Report), one row per
   calendar day, per-section Initial/Final/Total, per-sheet Grand Total. Runs fully in the
   browser via xlsx-js-style (dynamically imported so it stays out of the main bundle).
   ============================================================ */

import type { EtpEntry, Industry } from "@/lib/types";
import { WATER_METERS, ENERGY_METERS, RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON } from "@/lib/constants";
import { round1, kgToMt, toCanonicalKg } from "@/lib/data/etp-calc";
import { monthEntries, ledgerRollup, monthlyWaterTotal, monthlyWaterTotalOf, TRADE_EFFLUENT_RECYCLED_CODES, daysInMonth, manifestRows } from "@/lib/data/monthly";

type XLSXModule = typeof import("xlsx-js-style");
type Section = { label: string; code: string };
type Cell = string | number;

/* ---------- styles ---------- */
const B = { style: "thin", color: { rgb: "B4B4B4" } };
const border = { top: B, bottom: B, left: B, right: B };
const centerWrap = { horizontal: "center", vertical: "center", wrapText: true };
const S = {
  title: { font: { bold: true, sz: 13 }, alignment: { horizontal: "center", vertical: "center" } },
  label: { font: { bold: true, sz: 9 }, alignment: { vertical: "center", wrapText: true }, border, fill: { fgColor: { rgb: "F5F7FB" } } },
  value: { font: { sz: 9 }, alignment: { vertical: "center", wrapText: true }, border },
  section: { font: { bold: true, sz: 9 }, alignment: centerWrap, fill: { fgColor: { rgb: "E3ECF7" } }, border },
  header: { font: { bold: true, sz: 8 }, alignment: centerWrap, fill: { fgColor: { rgb: "EEF2FF" } }, border },
  cell: { font: { sz: 9 }, alignment: { horizontal: "center", vertical: "center" }, border },
  total: { font: { bold: true, sz: 9 }, alignment: { horizontal: "center", vertical: "center" }, fill: { fgColor: { rgb: "F3F6FA" } }, border },
};

/* ---------- section configs (from the meter registry, Excel order) ---------- */
const DAILY_SECTIONS: Section[] = WATER_METERS.filter((m) => m.group === "daily").map((m) => ({ label: m.label, code: m.code }));
const RO_SECTIONS: Section[] = WATER_METERS.filter((m) => m.group === "ro").map((m) => ({ label: m.label, code: m.code }));
const MEE_SECTIONS: Section[] = WATER_METERS.filter((m) => m.group === "mee").map((m) => ({ label: m.label, code: m.code }));
const ENERGY_SECTIONS: Section[] = ENERGY_METERS.map((m) => ({ label: m.label, code: m.code }));

function setStyle(XLSX: XLSXModule, ws: Record<string, unknown>, r: number, c: number, style: object) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: "s", v: "" };
  (ws[addr] as { s?: object }).s = style;
}

/* ---------- meter sheet (water / energy) ---------- */
function meterSheet(
  XLSX: XLSXModule,
  industry: Industry,
  monthly: EtpEntry[],
  month: string,
  cfg: { kind: "water" | "energy"; title: string; unit: string; sections: Section[]; excludeCodes?: string[] },
) {
  const cols = cfg.sections.length;
  const totalCols = 1 + cols * 4 + 1;
  const rows: Cell[][] = [];

  rows.push([cfg.title]); // 0
  rows.push(["Name", industry.name]); // 1
  rows.push(["Address", industry.address ?? industry.area ?? ""]); // 2
  rows.push(["MIS ID", industry.misId ?? ""]); // 3

  const sectionRow: Cell[] = new Array(totalCols).fill("");
  sectionRow[0] = "Section";
  cfg.sections.forEach((s, i) => (sectionRow[1 + i * 4] = s.label));
  rows.push(sectionRow); // 4

  const head: Cell[] = ["Date/Month/Year"];
  cfg.sections.forEach(() => head.push("Time", `Initial Reading in ${cfg.unit}`, `Final Reading in ${cfg.unit}`, `Total in ${cfg.unit}`));
  head.push("Grand Total");
  rows.push(head); // 5

  const days = daysInMonth(month);
  const perSection = new Array(cols).fill(0);
  let grandSum = 0;
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const e = monthly.find((x) => x.date === date);
    const readings = e?.[cfg.kind];
    const row: Cell[] = [date];
    let rowGrand = 0;
    cfg.sections.forEach((s, i) => {
      const m = readings?.[s.code];
      row.push("", m?.initial ?? "", m?.final ?? "", m?.total ?? "");
      if (m) {
        perSection[i] = round1(perSection[i] + m.total);
        if (!cfg.excludeCodes?.includes(s.code)) rowGrand = round1(rowGrand + m.total);
      }
    });
    row.push(e ? rowGrand : "");
    if (e) grandSum = round1(grandSum + rowGrand);
    rows.push(row);
  }

  const totalRow: Cell[] = new Array(totalCols).fill("");
  totalRow[0] = "Monthly Total";
  cfg.sections.forEach((_, i) => (totalRow[1 + i * 4 + 3] = perSection[i]));
  totalRow[totalCols - 1] = grandSum;
  rows.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(rows) as Record<string, unknown>;
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: totalCols - 1 } },
    { s: { r: 3, c: 1 }, e: { r: 3, c: totalCols - 1 } },
    ...cfg.sections.map((_, i) => ({ s: { r: 4, c: 1 + i * 4 }, e: { r: 4, c: 1 + i * 4 + 3 } })),
  ];
  ws["!merges"] = merges;
  ws["!cols"] = new Array(totalCols).fill(0).map((_, c) => ({ wch: c === 0 ? 14 : 12 }));

  const lastRow = rows.length - 1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < totalCols; c++) {
      let style: object = S.cell;
      if (r === 0) style = S.title;
      else if (r >= 1 && r <= 3) style = c === 0 ? S.label : S.value;
      else if (r === 4) style = c === 0 ? S.label : S.section;
      else if (r === 5) style = S.header;
      else if (r === lastRow) style = S.total;
      setStyle(XLSX, ws, r, c, style);
    }
  }
  return ws;
}

/* ---------- ledger sheet (sludge + salt, MT) ---------- */
function ledgerSheet(XLSX: XLSXModule, industry: Industry, monthly: EtpEntry[], month: string) {
  const totalCols = 1 + 6 + 6;
  const rows: Cell[][] = [];
  rows.push(["Monthly Log Book"]);
  rows.push(["Name", industry.name]);
  rows.push(["Address", industry.address ?? industry.area ?? ""]);
  rows.push(["MIS ID", industry.misId ?? ""]);

  const secRow: Cell[] = new Array(totalCols).fill("");
  secRow[0] = "Section";
  secRow[1] = "ETP Sludge";
  secRow[7] = "ATFD Salt (MEE Section) / PAN Salt (MEE)";
  rows.push(secRow);

  // Authorised quantity → MT via the canonical kg (never treats a raw KG source value as MT).
  const authKg =
    industry.authorisedQuantityKg ??
    (industry.authorisedSourceQuantity != null ? toCanonicalKg(industry.authorisedSourceQuantity, industry.authorisedSourceUnit ?? "MT") : 0);
  const authRow: Cell[] = new Array(totalCols).fill("");
  authRow[0] = "Authorised Quantity";
  authRow[1] = authKg ? `${kgToMt(authKg)} MT` : "Not configured";
  authRow[7] = "Not configured";
  rows.push(authRow);

  // Change 5 - the month's disposal total, nested directly under the authorised quantity it is
  // measured against. Reuses the single ledgerRollup below; no second disposal formula.
  const dispRow: Cell[] = new Array(totalCols).fill("");
  dispRow[0] = "Sum of Disposal During Month";
  dispRow[1] = `${kgToMt(ledgerRollup(monthly, "sludge").disposalKg)} MT`;
  dispRow[7] = `${kgToMt(ledgerRollup(monthly, "salt").disposalKg)} MT`;
  rows.push(dispRow);

  const ledgerCols = ["Opening Balance in MT", "Generation During Month in MT", "Date of disposal", "Disposal during month in MT", "Manifest No.", "Closing stock in MT"];
  rows.push(["Date/Month/Year", ...ledgerCols, ...ledgerCols]);

  const days = daysInMonth(month);
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${String(d).padStart(2, "0")}`;
    const e = monthly.find((x) => x.date === date);
    const s = e?.sludge;
    const t = e?.salt;
    rows.push([
      date,
      s ? kgToMt(s.opening) : "", s ? kgToMt(s.generation) : "", s?.dateOfDisposal ?? "", s ? kgToMt(s.dispatch) : "", s?.manifestNo ?? "", s ? kgToMt(s.closing) : "",
      t ? kgToMt(t.opening) : "", t ? kgToMt(t.generation) : "", t?.dateOfDisposal ?? "", t ? kgToMt(t.dispatch) : "", t?.manifestNo ?? "", t ? kgToMt(t.closing) : "",
    ]);
  }

  const sR = ledgerRollup(monthly, "sludge");
  const tR = ledgerRollup(monthly, "salt");
  rows.push([
    "Monthly Total",
    kgToMt(sR.openingKg), kgToMt(sR.generationKg), "", kgToMt(sR.disposalKg), "", kgToMt(sR.closingKg),
    kgToMt(tR.openingKg), kgToMt(tR.generationKg), "", kgToMt(tR.disposalKg), "", kgToMt(tR.closingKg),
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows) as Record<string, unknown>;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 1 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: totalCols - 1 } },
    { s: { r: 3, c: 1 }, e: { r: 3, c: totalCols - 1 } },
    { s: { r: 4, c: 1 }, e: { r: 4, c: 6 } },
    { s: { r: 4, c: 7 }, e: { r: 4, c: 12 } },
    { s: { r: 5, c: 1 }, e: { r: 5, c: 6 } },
    { s: { r: 5, c: 7 }, e: { r: 5, c: 12 } },
    { s: { r: 6, c: 1 }, e: { r: 6, c: 6 } },
    { s: { r: 6, c: 7 }, e: { r: 6, c: 12 } },
  ];
  ws["!cols"] = new Array(totalCols).fill(0).map((_, c) => ({ wch: c === 0 ? 14 : 13 }));

  const lastRow = rows.length - 1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < totalCols; c++) {
      let style: object = S.cell;
      if (r === 0) style = S.title;
      else if (r >= 1 && r <= 3) style = c === 0 ? S.label : S.value;
      else if (r === 4 || r === 5 || r === 6) style = c === 0 ? S.label : S.section;
      else if (r === 7) style = S.header;
      else if (r === lastRow) style = S.total;
      setStyle(XLSX, ws, r, c, style);
    }
  }
  return ws;
}

/* ---------- compliance report sheet ----------
   EXACT reproduction of the client's prescribed format (sheet "Compliance Report 5" of
   7. MAYANK TEXOFIN JULY 2026.xlsx). Six columns; the client's own row numbering, which
   genuinely jumps 13 -> 22 -> 24 -> 25; and their static wording kept VERBATIM, typos
   included ("Uit ID", "Consent oredr no.", "Manifeast no", "Authoeized Signatory").      */

/** "2021-12-01" -> "01/12/2021"; anything else passes through untouched. */
function dmy(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

const LEDGER_HEADS = [
  "Opening Balance as on 1 day of the month in MT",
  "Generation During Month in MT",
  "Disposal During Month in MT",
  "Closing stock of sludge on the last day of month in MT",
];

function complianceSheet(XLSX: XLSXModule, industry: Industry, monthly: EtpEntry[], month: string, cloths: number) {
  const COLS = 6;
  const rows: Cell[][] = [];
  /** Push one row, left-padded to the full six columns. */
  const push = (...cells: Cell[]) => {
    const r: Cell[] = new Array(COLS).fill("");
    cells.forEach((v, i) => {
      r[i] = v;
    });
    rows.push(r);
  };

  const days = daysInMonth(month);
  const [yy, mm] = month.split("-");
  const range = `01/${mm}/${yy} to ${String(days).padStart(2, "0")}/${mm}/${yy}`;
  const validity = (a?: string, b?: string) => (dmy(a) && dmy(b) ? `${dmy(a)} to ${dmy(b)}` : dmy(a) || dmy(b) || "");

  push("Compliance Report ETP Unit");
  push(1, "Name of unit", industry.name);
  push(2, "Uit ID", industry.misId ?? "");
  push(3, "Address", industry.address ?? industry.area ?? "");
  push(4, "Email", industry.email);
  push(5, "Mobile", industry.mobile);
  push(6, "Consent oredr no.", industry.consentOrderNo ?? industry.consentNumber ?? "", "order date", validity(industry.consentValidFrom, industry.consentValidTo), "Validity");
  push(7, "Authorization no.", industry.hwmAuthNo ?? "", "order date", validity(industry.hwmValidFrom, industry.hwmValidTo), "Validity");
  push(8, "Production (Monthly)(From 1st day of month to last day of month)", cloths ? `${cloths} METERS` : "");
  push(9, "Raw water Monthly", "Consumption", "", "Source", "");
  // Source is not captured anywhere in the app - left blank rather than fabricated.
  push("", "", monthlyWaterTotal(monthly, "RAW_FRESH_WATER"), "M3", "", "");
  // Sigma "ETP Inlet Section - Total of All Stream" (one field label, NOT a subtraction).
  push(10, "Trade Effluent Generation", `${monthlyWaterTotal(monthly, "ETP_INLET_ALL_STREAMS")} M3`);
  // Direct Reuse + RO Permeate 1&2 + RO Permeate 3&4 + MEE Condensate.
  push(11, "Trade effluent recycled M3", `${monthlyWaterTotalOf(monthly, TRADE_EFFLUENT_RECYCLED_CODES)} M3`);
  // Not measured by this application; the template's own static wording.
  push(12, "Boiler/Thermopack*", "Monitoring results");
  push(13, "AAQM*", "Monitoring results");

  const sR = ledgerRollup(monthly, "sludge");
  const tR = ledgerRollup(monthly, "salt");
  const sludgeSecRow = rows.length;
  push(22, "Details of ETP Sludge");
  const sludgeHeadRow = rows.length;
  push(23, "Date", ...LEDGER_HEADS);
  push("", range, kgToMt(sR.openingKg), kgToMt(sR.generationKg), sR.disposalKg ? kgToMt(sR.disposalKg) : "", kgToMt(sR.closingKg));
  push(); // the template carries two blank spacer rows here -
  push(); // reproduced so the row positions match the regulator's form exactly.
  const saltSecRow = rows.length;
  push(24, "Details of MEE salt");
  const saltHeadRow = rows.length;
  push("", "Date", ...LEDGER_HEADS);
  push("", range, kgToMt(tR.openingKg), kgToMt(tR.generationKg), tR.disposalKg ? kgToMt(tR.disposalKg) : "", kgToMt(tR.closingKg));

  const manifestSecRow = rows.length;
  push("", "Details of manifest");
  const manifestHeadRow = rows.length;
  push(25, "S No.", "Date", "Manifeast no", "Type of waste", "Quantity");
  const manifests = manifestRows(monthly);
  if (manifests.length === 0) {
    // The template itself carries one placeholder sludge row - keep the shape.
    push("", 1, "", "", "ETP SLUDGE", "");
  } else {
    manifests.forEach((m, i) => push("", i + 1, dmy(m.date), m.manifestNo, m.wasteType, kgToMt(m.quantityKg)));
  }
  push(); // two more template spacer rows before the signatory line
  push();
  const signRow = rows.length;
  push(`Name, Designation and Signature of Authoeized Signatory${industry.signatoryName ? ` - ${industry.signatoryName}${industry.signatoryDesignation ? ` (${industry.signatoryDesignation})` : ""}` : ""}`);

  const ws = XLSX.utils.aoa_to_sheet(rows) as Record<string, unknown>;
  ws["!cols"] = [{ wch: 6 }, { wch: 42 }, { wch: 26 }, { wch: 22 }, { wch: 26 }, { wch: 30 }];

  const full = (r: number) => ({ s: { r, c: 0 }, e: { r, c: COLS - 1 } });
  const valueSpan = (r: number) => ({ s: { r, c: 2 }, e: { r, c: COLS - 1 } });
  const labelSpan = (r: number) => ({ s: { r, c: 1 }, e: { r, c: COLS - 1 } });
  const RAW_HEAD = 9; // "9 | Raw water Monthly" spans this row and the next
  ws["!merges"] = [
    full(0),
    ...[1, 2, 3, 4, 5].map(valueSpan), // rows 1-5 values span C:F
    valueSpan(8), // production
    { s: { r: RAW_HEAD, c: 0 }, e: { r: RAW_HEAD + 1, c: 0 } }, // "9" spans the two raw-water rows
    { s: { r: RAW_HEAD, c: 1 }, e: { r: RAW_HEAD + 1, c: 1 } }, // "Raw water Monthly" likewise
    { s: { r: RAW_HEAD, c: 2 }, e: { r: RAW_HEAD, c: 3 } }, // Consumption -> C:D
    { s: { r: RAW_HEAD, c: 4 }, e: { r: RAW_HEAD, c: 5 } }, // Source -> E:F
    ...[11, 12, 13, 14].map(valueSpan), // trade effluent x2, boiler, AAQM
    labelSpan(sludgeSecRow),
    labelSpan(saltSecRow),
    labelSpan(manifestSecRow),
    full(signRow),
  ];

  const headRows = new Set([RAW_HEAD, sludgeHeadRow, saltHeadRow, manifestHeadRow]);
  const sectionRows = new Set([sludgeSecRow, saltSecRow, manifestSecRow]);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < COLS; c++) {
      let style: object = S.value;
      if (r === 0 || r === signRow) style = S.title;
      else if (headRows.has(r)) style = S.header;
      else if (sectionRows.has(r)) style = S.section;
      else if (c === 0 || c === 1) style = S.label;
      setStyle(XLSX, ws, r, c, style);
    }
  }
  return ws;
}

/** Build + download the exact RSPCB monthly workbook for a unit. */
export async function downloadMonthlyWorkbook(industry: Industry, entries: EtpEntry[], month: string, cloths: number) {
  const XLSX = await import("xlsx-js-style");
  const monthly = monthEntries(entries, industry.id, month);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, meterSheet(XLSX, industry, monthly, month, { kind: "water", title: "DAILY ETP LOG SHEET BOOK", unit: "M3", sections: DAILY_SECTIONS }), "Daily LogBook");
  XLSX.utils.book_append_sheet(
    wb,
    meterSheet(XLSX, industry, monthly, month, { kind: "water", title: "Daily Log-Sheet book (RO)", unit: "M3", sections: RO_SECTIONS, excludeCodes: RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON ? ["RO_PERMEATE_COMMON"] : [] }),
    "RO",
  );
  XLSX.utils.book_append_sheet(wb, meterSheet(XLSX, industry, monthly, month, { kind: "water", title: "Daily Log-Sheet book (MEE)", unit: "M3", sections: MEE_SECTIONS }), "MEE");
  XLSX.utils.book_append_sheet(wb, meterSheet(XLSX, industry, monthly, month, { kind: "energy", title: "Daily Kwh Log Book", unit: "Kwh", sections: ENERGY_SECTIONS }), "Daily Kwh Log Book");
  XLSX.utils.book_append_sheet(wb, ledgerSheet(XLSX, industry, monthly, month), "Sludge,Salt Log Book");
  XLSX.utils.book_append_sheet(wb, complianceSheet(XLSX, industry, monthly, month, cloths), "Compliance Report");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${industry.misId ?? industry.id}_${month}_RSPCB_Return.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
