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

/**
 * A user-defined extra column on the Daily ETP Entry sheet. Definitions live on the unit's own
 * `Industry` record, so they are tenant-scoped for free: a column added by unit A can never be
 * read by unit B (firestore.rules already isolates `industries/{id}`). `id` is the permanent
 * storage key; `name` is only ever a display label and may be re-used freely across units.
 */
export interface CustomColumnDef {
  id: string;
  name: string;
  order: number;
  createdAt?: string;
  /** Unit shown in the Total header and the Excel headers. Absent on columns defined
   *  before units existed — read it through `customColumnUnit()`, never directly. */
  unit?: string;
}

/** Unit for a custom column, defaulting to the water sections' M3 for older definitions. */
export const DEFAULT_CUSTOM_COLUMN_UNIT = "M3";

/**
 * The four RSPCB compliance documents a unit keeps on file. The codes are the Firestore
 * document ids under `industries/{id}/docs/{docType}`, so they are permanent storage keys —
 * rename the LABEL freely, never the code.
 */
export type EtpDocumentType = "CTE" | "CTO" | "AUTHORIZATION" | "NOTICE";

export const ETP_DOCUMENT_TYPES: readonly { code: EtpDocumentType; label: string; hint: string }[] = [
  { code: "CTE", label: "CTE — Consent to Establish", hint: "Consent to Establish certificate" },
  { code: "CTO", label: "CTO — Consent to Operate", hint: "Consent to Operate certificate" },
  { code: "AUTHORIZATION", label: "Authorization", hint: "Hazardous-waste authorisation" },
  { code: "NOTICE", label: "Recent Notice", hint: "Most recent notice received" },
] as const;

/**
 * Metadata for one uploaded PDF. The bytes themselves live in a `chunks` subcollection
 * beneath this document — deliberately NOT inside the tenant's `json` blob, which is
 * rewritten in full on every store mutation and live-streamed to the regulator.
 */
export interface EtpDocumentMeta {
  docType: EtpDocumentType;
  filename: string;
  size: number; // bytes of the original PDF
  contentType: string;
  /** Identifies the current set of chunks; a replace writes a NEW id before dropping the old. */
  uploadId: string;
  chunkCount: number;
  uploadedAt: string; // ISO
  uploadedByUid: string;
  /** Only a complete upload is assembled by readers — a torn upload is never served. */
  complete: boolean;
}

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
  /** Operator-defined extra Daily ETP Entry columns. Absent on units that never added one. */
  customColumns?: CustomColumnDef[];
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
  /**
   * Daily TOTAL per custom column, keyed by `CustomColumnDef.id`. Derived from `customMeters`
   * (Final − Initial) exactly as the legacy water scalars above are derived from `water`, so
   * every existing dashboard/CSV/Excel reader keeps working unchanged. On entries filed before
   * custom columns became meters this holds the raw value the operator typed.
   *
   * Optional and sparse: historical entries predate any column and stay valid - a missing key
   * renders blank, NOT 0.
   */
  custom?: Record<string, number | null>;
  /**
   * Initial/Final/Total per custom column, keyed by `CustomColumnDef.id` - the same shape the
   * water and energy sections use. Sparse: a column the operator left blank that day has NO
   * key here, so nothing is ever reported as a measured zero. Entries filed before this key
   * existed carry only the `custom` scalar; their Initial/Final are genuinely unknown and must
   * stay blank rather than be back-filled.
   */
  customMeters?: Record<string, MeterReading>;
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
