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
export const ETP_ONLY_PATHS = ["/dashboard/etp-entry"];

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
