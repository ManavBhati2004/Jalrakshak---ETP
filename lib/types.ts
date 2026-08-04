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

/** Daily water-balance entry for an individual ETP unit. All values in KL. */
export interface EtpEntry {
  id: string;
  industryId: string;
  industryName: string;
  date: string;
  freshWaterConsumption: number;
  etpInlet: number;
  etpOutlet: number;
  etpReuse: number;
  roInlet: number;
  roReject: number;
  roPermeate: number;
  sludgeToTSDF: number;
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
