import type { Role, RoleId, AlertType, AlertSeverity, MeterPoint } from "./types";

export const APP_NAME = "JalRakshak";
export const APP_TAGLINE =
  "Smart Monitoring for Individual Effluent Treatment Plants";

/* ---------------- Roles ---------------- */
export const ROLES: Role[] = [
  {
    id: "monitoring-admin",
    name: "Monitoring Body",
    description: "Regulatory authority. Full visibility across every individual ETP, reading, approval and report.",
    scope: "Super Admin · Sees Everything",
    icon: "ShieldCheck",
    accent: "#6366f1",
    permissions: ["*"],
  },
  {
    id: "etp",
    name: "ETP",
    description: "An industry running its own Effluent Treatment Plant. Self-registers and feeds the daily water-balance.",
    scope: "Individual ETP · Water Balance",
    icon: "Droplets",
    accent: "#0d9488",
    permissions: ["submit", "view-own", "register"],
  },
];

export const ADMIN_ROLE: RoleId = "monitoring-admin";

/* ---------------- Dashboard navigation ---------------- */
export interface NavItem {
  label: string;
  href: string;
  icon: string; // lucide name
  group?: string;
  roles: RoleId[];
}

const ALL: RoleId[] = ["monitoring-admin", "etp"];
const ADMIN: RoleId[] = ["monitoring-admin"];
const ETP: RoleId[] = ["etp"];

export const DASHBOARD_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", group: "Overview", roles: ALL },
  { label: "ETP Data Entry", href: "/dashboard/etp-entry", icon: "ClipboardCheck", group: "Overview", roles: ETP },
  { label: "Alerts", href: "/dashboard/alerts", icon: "BellRing", group: "Overview", roles: ETP },
  { label: "Help Center", href: "/dashboard/help", icon: "LifeBuoy", group: "Overview", roles: ETP },
  { label: "Industries", href: "/dashboard/industries", icon: "Factory", group: "Monitoring", roles: ADMIN },
  { label: "ETP Units", href: "/dashboard/etp", icon: "Droplets", group: "Monitoring", roles: ADMIN },
  { label: "Approvals", href: "/dashboard/approvals", icon: "CheckCircle2", group: "Governance", roles: ADMIN },
  { label: "Compliance", href: "/dashboard/compliance", icon: "ShieldCheck", group: "Governance", roles: ADMIN },
  { label: "Alerts", href: "/dashboard/alerts", icon: "BellRing", group: "Governance", roles: ADMIN },
];

// /dashboard/alerts is intentionally NOT admin-only: ETP operators may view their
// own unit's alerts there (the page scopes + hides admin actions by role).
export const ADMIN_ONLY_PATHS = [
  "/dashboard/industries",
  "/dashboard/etp",
  "/dashboard/approvals",
  "/dashboard/compliance",
  "/dashboard/reports",
];
export const ETP_ONLY_PATHS = ["/dashboard/etp-entry", "/dashboard/help", "/dashboard/onboarding"];

/** Whether a role may visit a dashboard path (used for redirect gating). */
export function canAccessPath(role: RoleId, pathname: string): boolean {
  // segment-aware match: "/dashboard/etp" must NOT swallow "/dashboard/etp-entry"
  const matches = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const inAdmin = ADMIN_ONLY_PATHS.some(matches);
  const inEtp = ETP_ONLY_PATHS.some(matches);
  if (role === "monitoring-admin") return !inEtp;
  return !inAdmin; // etp
}

/* ---------------- Flow meter points (at CETP) ---------------- */
export const METER_POINTS: MeterPoint[] = [
  "Raw Water",
  "Equalization",
  "ZLD Feed",
  "Disc Filter Feed",
  "UF",
  "RO",
  "MEE",
  "SEP",
  "Energy Meter",
];

export const READING_TIMES = [
  { value: "08:00", label: "08:00 AM (Morning)", shift: "morning" as const },
  { value: "20:00", label: "08:00 PM (Evening)", shift: "evening" as const },
];

/* ---------------- RSPCB prescribed daily meters (from the real client Excel) ----------------
   Source of truth: "7. MAYANK TEXOFIN JULY 2026.xlsx" (analysed in the feasibility report).
   12 water meters split exactly as the workbook's three water sheets (Daily / RO / MEE),
   3 energy meters (kWh sheet). Labels reproduced VERBATIM for print/PDF output; stable codes
   for storage. Water unit "M3", energy unit "Kwh". */
export type WaterGroup = "daily" | "ro" | "mee";

export interface WaterMeterDef {
  code: string;
  label: string; // verbatim Excel section label
  group: WaterGroup;
  /** true = maps to a retained legacy scalar field on EtpEntry (dashboards/CSV). */
  legacyKey?: "freshWaterConsumption" | "etpInlet" | "etpReuse" | "roInlet" | "roPermeate" | "roReject";
}

export const WATER_METERS: readonly WaterMeterDef[] = [
  // --- Daily Log sheet (4) ---
  { code: "RAW_FRESH_WATER", label: "Raw Fresh Water / Fresh Water Input", group: "daily", legacyKey: "freshWaterConsumption" },
  { code: "ETP_INLET_ALL_STREAMS", label: "ETP inlet Section-Total of all stream", group: "daily", legacyKey: "etpInlet" },
  { code: "TERTIARY_TREATED", label: "Tertiary Treated Section- Outlet", group: "daily" },
  { code: "ETP_DIRECT_REUSE", label: "ETP Treated directly Reuse", group: "daily", legacyKey: "etpReuse" },
  // --- RO sheet (5) ---
  { code: "RO_FEED_1_2", label: "RO FEED ( 1st & 2nd Stage )", group: "ro", legacyKey: "roInlet" },
  { code: "RO_PERMEATE_COMMON", label: "Total RO permeate Common Meter", group: "ro", legacyKey: "roPermeate" },
  { code: "RO_REJECT_1_2", label: "RO Reject Section-Total", group: "ro", legacyKey: "roReject" },
  { code: "RO_PERMEATE_3_4", label: "RO Permeate ( 3rd & 4th Stage )", group: "ro" },
  { code: "RO_REJECT_3_4", label: "RO Reject ( 3rd & 4th Stage )", group: "ro" },
  // --- MEE sheet (3) ---
  { code: "MEE_FEED", label: "Total MEE Feed", group: "mee" },
  { code: "MEE_CONDENSATE", label: "Total MEE Condensate", group: "mee" },
  { code: "MEE_REJECT", label: "Total MEE Reject", group: "mee" },
] as const;

export const WATER_GROUPS: { id: WaterGroup; label: string; unit: string }[] = [
  { id: "daily", label: "Daily Log — Fresh / ETP / Tertiary / Reuse", unit: "M3" },
  { id: "ro", label: "RO Section", unit: "M3" },
  { id: "mee", label: "MEE Section", unit: "M3" },
];

export interface EnergyMeterDef {
  code: string;
  label: string; // verbatim Excel section label
  panel: string; // Excel "Location of Meter"
}

export const ENERGY_METERS: readonly EnergyMeterDef[] = [
  { code: "ETP_POWER", label: "ETP inlet Section-Total of all stream", panel: "Main panel" },
  { code: "RO_POWER", label: "RO Reject Section-Total", panel: "RO plant panel" },
  { code: "MEE_POWER", label: "MEE Reject Section Total", panel: "MEE panel" },
] as const;

export type WaterMeterCode = (typeof WATER_METERS)[number]["code"];
export type EnergyMeterCode = (typeof ENERGY_METERS)[number]["code"];

/**
 * The Excel's RO "Grand Total" formula sums Feed + Reject(1&2) + Permeate(3&4) + Reject(3&4)
 * and EXCLUDES the common Permeate(1&2) meter (`RO_PERMEATE_COMMON`). Reproduced faithfully
 * behind this flag — the client should confirm whether it is deliberate or a sheet quirk.
 */
export const RO_GRAND_TOTAL_EXCLUDES_PERMEATE_COMMON = true;

/**
 * Non-blocking authorisation warning fires once cumulative dispatch reaches this fraction of
 * the registered Authorised quantity. Documented, configurable app setting — NOT a claimed
 * legal rule. ≥100% shows a critical over-authorisation warning; no automatic hard block.
 */
export const AUTHORISED_QUANTITY_WARNING_PERCENT = 80;

/**
 * Daily numeric standard (master prompt §4): up to 7 integer digits + 1 decimal place,
 * nonnegative, max 9999999.9. Applied to water/energy readings and kg waste quantities.
 */
export const DAILY_MAX_VALUE = 9999999.9;
export const DAILY_DECIMAL_REGEX = /^\d{0,7}(\.\d?)?$/;

/* ---------------- Alert metadata ---------------- */
export const ALERT_META: Record<
  AlertType,
  { label: string; icon: string; severity: AlertSeverity; color: string }
> = {
  "late-submission": { label: "Late Submission", icon: "Clock", severity: "medium", color: "#f59e0b" },
  "zero-reading": { label: "Zero Reading", icon: "MinusCircle", severity: "high", color: "#f87171" },
  "high-flow": { label: "High Flow", icon: "TrendingUp", severity: "high", color: "#fb923c" },
  "capacity-exceeded": { label: "Capacity Exceeded", icon: "AlertOctagon", severity: "critical", color: "#ef4444" },
  "non-reporting": { label: "Non Reporting", icon: "WifiOff", severity: "high", color: "#f87171" },
  "reading-mismatch": { label: "Reading Mismatch", icon: "GitCompareArrows", severity: "medium", color: "#fbbf24" },
  "repeated-reading": { label: "Repeated Reading", icon: "Repeat", severity: "medium", color: "#fbbf24" },
  "missing-photo": { label: "Missing Photo", icon: "ImageOff", severity: "low", color: "#94a3b8" },
  "rejected-entry": { label: "Rejected Entry", icon: "XCircle", severity: "high", color: "#f87171" },
  "time-tamper": { label: "Clock Tampering", icon: "AlarmClock", severity: "high", color: "#ef4444" },
  "help-request": { label: "Help Request", icon: "LifeBuoy", severity: "medium", color: "#0ea5e9" },
  "disciplinary": { label: "Notice", icon: "Megaphone", severity: "high", color: "#ef4444" },
};

export const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  low: "#94a3b8",
  medium: "#fbbf24",
  high: "#fb923c",
  critical: "#ef4444",
};

/* ---------------- Compliance thresholds ---------------- */
export const COMPLIANCE = {
  compliant: 85,
  warning: 70,
};

export function complianceStatus(score: number) {
  if (score >= COMPLIANCE.compliant) return "compliant" as const;
  if (score >= COMPLIANCE.warning) return "warning" as const;
  return "non-compliant" as const;
}

export const STATUS_COLOR = {
  compliant: "#10b981",
  warning: "#f59e0b",
  "non-compliant": "#ef4444",
} as const;

/* Hero / stat headline counters */
export const HERO_STATS = [
  { value: 2, suffix: "", label: "ETP Units Monitored" },
  { value: 7, suffix: "-stage", label: "Treatment Pipeline" },
  { value: 250, suffix: "+", label: "Daily Readings" },
  { value: 24, suffix: "×7", label: "Live Monitoring" },
];
