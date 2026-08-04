import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number, opts?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-IN", opts).format(n);
}

export function formatKLD(n: number) {
  return `${formatNumber(n)} KLD`;
}

/** Display label for a stored unit — water volume "KL" is shown as "m³" (energy "kWh" unchanged). */
export const displayUnit = (u: string) => (u === "KL" ? "m³" : u);

export function compactNumber(n: number) {
  return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatDate(iso: string | null, withTime = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

/** Filename-safe local timestamp, e.g. "2026-06-20_14-05-33". */
export function timeStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Append the download date+time to a CSV base name → "base-2026-06-20_14-05-33.csv". */
export function stampedName(base: string) {
  return `${base}-${timeStamp()}.csv`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/**
 * Serialize an array of row objects to CSV text. Hardened against CSV / formula
 * injection: any cell whose text begins with a formula trigger (=, +, -, @, tab
 * or CR) is prefixed with a single quote so spreadsheet apps (Excel / Sheets /
 * LibreOffice) treat it as literal text and never evaluate it. All values are
 * wrapped in double quotes with embedded quotes doubled.
 */
export function toCSV(rows: Record<string, unknown>[]) {
  if (!rows.length) return "No data";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}
