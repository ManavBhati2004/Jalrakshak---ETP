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
  // ---- RSPCB prescribed-return registration fields (Fateh spec §1) ----
  tehsil?: string;
  district?: string;
  misId?: string;
  consentOrderNo?: string;
  consentOrderDate?: string;
  consentValidFrom?: string;
  consentValidTo?: string;
  hwmAuthNo?: string;
  hwmAuthDate?: string;
  hwmValidFrom?: string;
  hwmValidTo?: string;
  authorisedQuantityKg?: number; // hazardous-waste authorised quantity, stored in kg
  tsdfName?: string;
  tsdfAddress?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  lastReadingAt: string | null;
  alertsCount: number;
  registeredAt: string;
}

/** One meter's daily record: Total = Final − Initial (auto). */
export interface MeterReading {
  initial: number;
  final: number;
  total: number;
}

/** Day-wise hazardous-waste ledger row, all quantities in kg. */
export interface SludgeLedger {
  opening: number; // carried from the previous entry's closing
  generation: number;
  dateOfDisposal: string; // "" when nothing dispatched
  dispatch: number;
  manifestNo: string;
  closing: number; // = opening + generation − dispatch (auto)
  remark: string;
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

/**
 * Daily entry for an individual ETP unit, aligned to the RSPCB prescribed return
 * (Fateh spec §2–§4): 10 water meters + 3 energy meters (each initial/final/total)
 * and two kg ledgers (ETP sludge + MEE salt). Legacy summary scalars are derived
 * from the water-meter totals so existing dashboards/CSV keep working.
 * Water meters are in M3, energy in kWh, ledgers in kg.
 */
export interface EtpEntry {
  id: string;
  industryId: string;
  industryName: string;
  date: string;
  // structured meter readings (keyed by the meter keys in lib/constants)
  water: Record<string, MeterReading>; // 10 water meters (M3)
  waterGrandTotal: number; // auto-sum of all water totals
  waterRemark: string;
  energy: Record<string, MeterReading>; // 3 energy meters (kWh)
  energyRemark: string;
  sludge: SludgeLedger; // ETP sludge (kg)
  salt: SludgeLedger; // ATFD / PAN salt, MEE section (kg)
  // ---- derived legacy summary (water-meter totals) ----
  freshWaterConsumption: number; // water.rawFreshWater.total
  etpInlet: number; // water.etpInlet.total
  etpReuse: number; // water.etpTreatedReuse.total
  roInlet: number; // water.roFeed.total
  roReject: number; // water.roReject.total
  roPermeate: number; // water.roPermeate.total
  totalWaterIntake: number; // = freshWaterConsumption + etpReuse + roPermeate
  unit: "KL";
  status: ReadingStatus;
  submittedAt: string;
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
  | "time-tamper";

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
