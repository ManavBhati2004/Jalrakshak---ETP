/* ============================================================
   JalRakshak — Domain Types
   ============================================================ */

export type RoleId = "monitoring-admin" | "etp";

export interface Role {
  id: RoleId;
  name: string;
  description: string;
  scope: string;
  icon: string; // lucide icon name
  accent: string; // hex
  permissions: string[];
}

export type CetpId = "balotra" | "jasol" | "bithuja";

export type NodeStatus = "normal" | "warning" | "critical";
export type FlowNodeType = "raw" | "treatment" | "recovery" | "energy";

export interface FlowNode {
  id: string;
  label: string;
  short: string;
  type: FlowNodeType;
  value: number;
  unit: string;
  status: NodeStatus;
}

export type IndustryStatus =
  | "active"
  | "pending"
  | "suspended"
  | "non-reporting";

export interface Industry {
  id: string;
  name: string;
  ownerName: string;
  area: string;
  address?: string;
  contactPerson: string;
  mobile: string;
  email: string;
  consentNumber: string;
  permittedKLD: number;
  status: IndustryStatus;
  cetpId: CetpId | null; // null => individual ETP
  isIndividualETP: boolean;
  complianceScore: number;
  etpCapacity: number;
  roCapacity: number;
  meeCapacity: number;
  // individual-ETP capacities (all KLD)
  maxEffluentGeneration?: number;
  roStage1?: number;
  roStage2?: number;
  roStage3?: number;
  roStage4?: number;
  // ---- RSPCB prescribed-return registration (master prompt §3 / Excel Compliance sheet, all optional/additive) ----
  misId?: string;
  tehsil?: string;
  district?: string;
  consentOrderNo?: string;
  consentOrderDate?: string; // date-only YYYY-MM-DD
  consentValidFrom?: string;
  consentValidTo?: string;
  hwmAuthNo?: string;
  hwmAuthDate?: string;
  hwmValidFrom?: string;
  hwmValidTo?: string;
  authorisedQuantityKg?: number; // canonical kg (MT converted ×1000 at input)
  authorisedSourceQuantity?: number; // original entered value (audit)
  authorisedSourceUnit?: "KG" | "MT"; // original entered unit (audit)
  tsdfName?: string;
  tsdfAddress?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  /** Durable first-time-registration completion marker; null/undefined => onboarding incomplete. */
  registrationCompletedAt?: string | null;
  /** Manual monthly compliance input: cloths production in meters, keyed by "YYYY-MM". */
  monthlyProduction?: Record<string, number>;
  lastReadingAt: string | null;
  alertsCount: number;
  registeredAt: string;
}

export type MeterPoint =
  | "Raw Water"
  | "Equalization"
  | "ZLD Feed"
  | "Disc Filter Feed"
  | "UF"
  | "RO"
  | "MEE"
  | "SEP"
  | "Energy Meter"
  | "ETP Water Balance";

export type ReadingStatus = "pending" | "approved" | "rejected";

/** One meter's daily record (RSPCB prescribed return): Total = Final − Initial (auto). */
export interface MeterReading {
  initial: number;
  final: number;
  total: number;
}

/** Day-wise hazardous-waste stock ledger (ETP sludge / MEE salt), all quantities in kg. */
export interface HwLedger {
  opening: number; // carried from the previous entry's closing
  generation: number;
  dateOfDisposal: string; // "" when nothing dispatched
  dispatch: number;
  manifestNo: string;
  closing: number; // = opening + generation − dispatch (auto)
  remark: string;
}

/** DRAFT = partial save; SUBMITTED = sent to the Monitoring-Body approval workflow. */
export type EntryStatus = "DRAFT" | "SUBMITTED";

/**
 * Daily entry for an individual ETP unit.
 *
 * Legacy flat scalars (in KL, `totalWaterIntake` etc.) are RETAINED so historical entries
 * and every existing dashboard/CSV keep working. The RSPCB prescribed-return structures are
 * ADDED as optional: 12 water meters (grouped daily/ro/mee) + 3 energy meters (each
 * initial/final/total) and two kg ledgers. New entries populate both — the legacy scalars are
 * derived from the water-meter totals. Water meters M3, energy Kwh, ledgers kg.
 */
export interface EtpEntry {
  id: string;
  industryId: string;
  industryName: string;
  date: string;
  // ---- legacy scalar water balance (retained; derived from meter totals on new entries) ----
  freshWaterConsumption: number;
  etpInlet: number;
  etpOutlet: number;
  etpReuse: number;
  roInlet: number;
  roReject: number;
  roPermeate: number;
  sludgeToTSDF: number; // legacy KL field — kept for audit; 0 on prescribed-return entries
  totalWaterIntake: number; // = freshWaterConsumption + etpReuse + roPermeate
  unit: "KL";
  status: ReadingStatus;
  submittedAt: string;
  // ---- RSPCB prescribed-return structures (optional/additive) ----
  water?: Record<string, MeterReading>; // 12 water meters (M3), keyed by meter code
  waterTotals?: Record<string, number>; // per-group grand totals: { daily, ro, mee }
  waterRemark?: string;
  energy?: Record<string, MeterReading>; // 3 energy meters (Kwh)
  energyRemark?: string;
  sludge?: HwLedger; // ETP sludge (kg)
  salt?: HwLedger; // ATFD/PAN salt, MEE section (kg)
  entryStatus?: EntryStatus; // DRAFT | SUBMITTED (append-only submit workflow)
  overrideReason?: string; // audit note when a missing-prior-day continuity override was authorised
}

export type ReadingShift = "morning" | "evening";

export interface FlowMeterReading {
  id: string;
  industryId: string;
  industryName: string;
  cetpId: CetpId | null;
  date: string; // ISO date
  readingTime: string; // "08:00" / "20:00" / custom
  shift: ReadingShift;
  isLate: boolean;
  meterPoint: MeterPoint;
  previousReading: number;
  currentReading: number;
  difference: number;
  unit: string;
  hasPhoto: boolean;
  operatorName: string;
  inspectorName: string;
  remarks: string;
  status: ReadingStatus;
  submittedAt: string;
}

export type ApprovalStage =
  | "submitted"
  | "verification"
  | "approved"
  | "rejected";

export interface ApprovalStep {
  stage: ApprovalStage;
  label: string;
  at: string | null;
  by: string | null;
  done: boolean;
}

export interface Approval {
  id: string;
  readingId: string;
  industryId: string;
  industryName: string;
  cetpId: CetpId | null;
  meterPoint: MeterPoint;
  difference: number;
  unit: string;
  hasPhoto: boolean;
  remarks: string;
  stage: ApprovalStage;
  submittedAt: string;
  reviewedAt: string | null;
  reviewer: string | null;
  alerts: AlertType[];
  timeline: ApprovalStep[];
}

export type AlertType =
  | "late-submission"
  | "zero-reading"
  | "high-flow"
  | "capacity-exceeded"
  | "non-reporting"
  | "reading-mismatch"
  | "repeated-reading"
  | "missing-photo"
  | "rejected-entry"
  | "time-tamper"
  | "help-request"
  | "disciplinary";

export type AlertSeverity = "low" | "medium" | "high" | "critical";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  industryId: string | null;
  industryName: string | null;
  cetpId: CetpId | null;
  title: string;
  message: string;
  createdAt: string;
  status: AlertStatus;
  relatedReadingId: string | null;
}

export type ComplianceStatus = "compliant" | "warning" | "non-compliant";

export interface TrendPoint {
  label: string;
  value?: number;
  [key: string]: string | number | undefined;
}

export interface ComplianceRecord {
  industryId: string;
  industryName: string;
  cetpId: CetpId | null;
  score: number;
  status: ComplianceStatus;
  submissionRate: number;
  alertCount: number;
  trend: TrendPoint[];
}

export interface EnergyLine {
  id: string;
  name: string;
  voltage: string; // "11 KV" / "33 KV"
  consumptionKWh: number;
  demandKVA: number;
  powerFactor: number;
  cetpId: CetpId | string;
  status: NodeStatus;
}

export interface EnergyData {
  lines: EnergyLine[];
  dailyTrend: TrendPoint[];
  consumptionByStage: TrendPoint[];
}

export interface CetpTrends {
  cetpId: CetpId;
  wastewater: TrendPoint[];
  compliance: TrendPoint[];
  flow: TrendPoint[];
}
