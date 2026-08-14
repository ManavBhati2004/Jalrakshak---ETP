/* ============================================================
   JalRakshak — exact RSPCB monthly workbook (.xlsx) generator
   Reproduces the client's Excel (7. MAYANK TEXOFIN JULY 2026.xlsx): 6 sheets
   (Daily water / RO / MEE / kWh / Sludge-Salt in MT / Compliance Report), one row per
   calendar day, per-section Initial/Final/Total, per-sheet Grand Total. Runs fully in the
   browser via xlsx-js-style (dynamically imported so it stays out of the main bundle).
   ============================================================ */

import type { EtpEntry, Industry } from "@/lib/types";
import { WATER_METERS, ENERGY_METERS, RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON } from "@/lib/constants";
import { round1 } from "@/lib/data/etp-calc";
import { monthEntries, ledgerRollup, monthlyWaterTotal, daysInMonth, manifestRows } from "@/lib/data/monthly";

type XLSXModule = typeof import("xlsx-js-style");
type Section = { label: string; code: string };
type Cell = string | number;

const kgToMt = (kg: number) => round1(kg / 1000 * 1000) / 1000; // keep 3-dp MT

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
const ENERGY_SECTIONS: Section[] = ENERGY_METERS.map((m) => ({ label: `${m.label} (${m.panel})`, code: m.code }));

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

  const authMt = industry.authorisedQuantityKg ? round1(industry.authorisedQuantityKg / 100) / 10 : industry.authorisedSourceQuantity ?? 0;
  const authRow: Cell[] = new Array(totalCols).fill("");
  authRow[0] = "Authorised Quantity";
  authRow[1] = `${authMt} MT`;
  authRow[7] = "Not configured";
  rows.push(authRow);

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
  ];
  ws["!cols"] = new Array(totalCols).fill(0).map((_, c) => ({ wch: c === 0 ? 14 : 13 }));

  const lastRow = rows.length - 1;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < totalCols; c++) {
      let style: object = S.cell;
      if (r === 0) style = S.title;
      else if (r >= 1 && r <= 3) style = c === 0 ? S.label : S.value;
      else if (r === 4 || r === 5) style = c === 0 ? S.label : S.section;
      else if (r === 6) style = S.header;
      else if (r === lastRow) style = S.total;
      setStyle(XLSX, ws, r, c, style);
    }
  }
  return ws;
}

/* ---------- compliance report sheet ---------- */
function complianceSheet(XLSX: XLSXModule, industry: Industry, monthly: EtpEntry[], month: string, cloths: number) {
  const rows: Cell[][] = [];
  const kv = (n: number | string, k: string, v: Cell) => rows.push([n, k, v]);
  rows.push(["Compliance Report — ETP Unit", "", ""]);
  kv(1, "Name of unit", industry.name);
  kv(2, "Unit ID (MIS)", industry.misId ?? "");
  kv(3, "Address", industry.address ?? industry.area ?? "");
  kv(4, "Email", industry.email);
  kv(5, "Mobile", industry.mobile);
  kv(6, "Consent Order No.", `${industry.consentOrderNo ?? ""}  (${industry.consentValidFrom ?? ""} to ${industry.consentValidTo ?? ""})`);
  kv(7, "HWM Authorization No.", `${industry.hwmAuthNo ?? ""}  (${industry.hwmValidFrom ?? ""} to ${industry.hwmValidTo ?? ""})`);
  kv(8, "Reporting month", month);
  kv(9, "Cloths Production – in meters (monthly)", cloths || 0);
  kv(10, "Raw Fresh Water (M3) — auto-summed", monthlyWaterTotal(monthly, "RAW_FRESH_WATER"));
  kv(11, "Raw Influent Generation (M3) — auto-summed", monthlyWaterTotal(monthly, "ETP_INLET_ALL_STREAMS"));

  rows.push(["", "", ""]);
  rows.push(["Details of ETP Sludge (MT)", "", ""]);
  rows.push(["Opening", "Generation", "Disposal", "Closing"]);
  const sR = ledgerRollup(monthly, "sludge");
  rows.push([kgToMt(sR.openingKg), kgToMt(sR.generationKg), kgToMt(sR.disposalKg), kgToMt(sR.closingKg)]);
  rows.push(["Details of ATFD Salt (MEE) (MT)", "", ""]);
  rows.push(["Opening", "Generation", "Disposal", "Closing"]);
  const tR = ledgerRollup(monthly, "salt");
  rows.push([kgToMt(tR.openingKg), kgToMt(tR.generationKg), kgToMt(tR.disposalKg), kgToMt(tR.closingKg)]);

  rows.push(["", "", ""]);
  rows.push(["Details of manifest", "", "", "", ""]);
  rows.push(["Date", "Manifest No.", "Type of waste", "Quantity (kg)"]);
  for (const m of manifestRows(monthly)) rows.push([m.date, m.manifestNo, m.wasteType, m.quantityKg]);
  rows.push(["", "", ""]);
  rows.push(["", "Name, Designation & Signature of Authorised Signatory:", `${industry.signatoryName ?? ""} (${industry.signatoryDesignation ?? ""})`]);

  const ws = XLSX.utils.aoa_to_sheet(rows) as Record<string, unknown>;
  ws["!cols"] = [{ wch: 30 }, { wch: 34 }, { wch: 30 }, { wch: 18 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  setStyle(XLSX, ws, 0, 0, S.title);
  return ws;
}

/** Build + download the exact RSPCB monthly workbook for a unit. */
export async function downloadMonthlyWorkbook(industry: Industry, entries: EtpEntry[], month: string, cloths: number) {
  const XLSX = await import("xlsx-js-style");
  const monthly = monthEntries(entries, industry.id, month);
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, meterSheet(XLSX, industry, monthly, month, { kind: "water", title: "Daily Log-Sheet book", unit: "M3", sections: DAILY_SECTIONS }), "Daily LogBook");
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
