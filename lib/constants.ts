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
export const ETP_ONLY_PATHS = ["/dashboard/etp-entry", "/dashboard/help"];

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

/* ---------------- RSPCB prescribed-return daily meters (Fateh spec §5–§6) ----------------
   Labels are reproduced VERBATIM from the prescribed sheet. Keys reuse the existing
   scalar identifiers for the 6 existing streams (meters 1,2,3,5,6,7); meters 4,8,9,10
   are new. Water unit M3, energy unit kWh. */
export const WATER_METERS = [
  { key: "freshWaterConsumption", label: "Raw Fresh Water / Fresh Water Input", existing: true },
  { key: "etpInlet", label: "ETP inlet Section-Total of all stream", existing: true },
  { key: "etpReuse", label: "ETP Treated directly Reuse", existing: true },
  { key: "tertiaryTreated", label: "Tertiary Treated Section-Total", existing: false },
  { key: "roInlet", label: "RO Section Total Feed", existing: true },
  { key: "roPermeate", label: "Total RO permeate Common Meter", existing: true },
  { key: "roReject", label: "RO Reject Section-Total", existing: true },
  { key: "meeFeed", label: "MEE Feed Section Total", existing: false },
  { key: "meeCondensate", label: "Total MEE Condensate / MEE Condensate Reuse", existing: false },
  { key: "meeReject", label: "MEE Reject Section Total", existing: false },
] as const;

export const ENERGY_METERS = [
  { key: "etpInletEnergy", label: "ETP inlet Section-Total of all stream" },
  { key: "roRejectEnergy", label: "RO Reject Section-Total" },
  { key: "meeRejectEnergy", label: "MEE Reject Section Total" },
] as const;

export type WaterMeterKey = (typeof WATER_METERS)[number]["key"];
export type EnergyMeterKey = (typeof ENERGY_METERS)[number]["key"];

/** Keys mapping to legacy EtpEntry scalar fields (derived from these meter totals). */
export const WATER_LEGACY_KEYS = ["freshWaterConsumption", "etpInlet", "etpReuse", "roInlet", "roPermeate", "roReject"] as const;

/**
 * Non-blocking warning fires once cumulative dispatch reaches this fraction of the
 * registered Authorised quantity (kg). The Fateh brief says "approaches" without a
 * number — 80% is a documented default; change here to adjust globally.
 */
export const AUTHORISED_QUANTITY_WARNING_PERCENT = 80;

/**
 * How the 10 water meters split across the two regulator print sheets. The brief
 * requires two sheets but doesn't define the split — meters 1–5 / 6–10 is a
 * documented default (0-indexed slice bounds).
 */
export const WATER_SHEET_GROUPS: [number, number][] = [
  [0, 5], // Water Sheet 1: meters 1–5
  [5, 10], // Water Sheet 2: meters 6–10
];

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
