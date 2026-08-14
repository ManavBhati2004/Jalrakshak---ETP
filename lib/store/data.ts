import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { firestoreStorage, type StoreData } from "@/lib/data/firestore-storage";
import type {
  Industry,
  FlowMeterReading,
  Approval,
  Alert,
  AlertType,
  AlertSeverity,
  ComplianceRecord,
  ApprovalStage,
  MeterPoint,
  CetpId,
  EtpEntry,
  MeterReading,
  EntryStatus,
} from "@/lib/types";
import {
  industries as seedIndustries,
  buildReadings,
  buildApprovals,
  buildAlerts,
  buildCompliance,
  buildEtpEntries,
  buildEtpApprovals,
} from "@/lib/data/seed";
import { ALERT_META, complianceStatus, WATER_METERS } from "@/lib/constants";
import { toMeterReading, groupGrandTotals, toLedger, round1 } from "@/lib/data/etp-calc";

export interface ReadingInput {
  industryId: string;
  meterPoint: MeterPoint;
  date: string;
  readingTime: string;
  previousReading: number;
  currentReading: number;
  unit: string;
  hasPhoto: boolean;
  operatorName: string;
  inspectorName: string;
  remarks: string;
}

export interface RegisterInput {
  name: string;
  ownerName: string;
  area: string;
  address?: string;
  mobile: string;
  email: string;
  consentNumber: string;
  permittedKLD: number;
  etpCapacity: number;
  roCapacity: number;
  meeCapacity: number;
  cetpId: CetpId | null;
  maxEffluentGeneration?: number;
  roStage1?: number;
  roStage2?: number;
  roStage3?: number;
  roStage4?: number;
  // RSPCB prescribed-return registration (master §3, all optional)
  misId?: string;
  tehsil?: string;
  district?: string;
  consentOrderNo?: string;
  consentOrderDate?: string;
  consentValidFrom?: string;
  consentValidTo?: string;
  hwmAuthNo?: string;
  hwmAuthDate?: string;
  hwmValidFrom?: string;
  hwmValidTo?: string;
  authorisedQuantityKg?: number;
  authorisedSourceQuantity?: number;
  authorisedSourceUnit?: "KG" | "MT";
  tsdfName?: string;
  tsdfAddress?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  /** When true, stamps `registrationCompletedAt` (the five-section onboarding is complete). */
  registrationComplete?: boolean;
}

export interface MeterInput {
  initial: number;
  final: number;
}
export interface LedgerInput {
  opening: number;
  generation: number;
  dateOfDisposal: string;
  dispatch: number;
  manifestNo: string;
  remark: string;
}
/** Structured RSPCB prescribed-return daily input (12 water + 3 energy meters, 2 kg ledgers). */
export interface EtpEntryInput {
  industryId: string;
  date: string;
  status: EntryStatus; // DRAFT (partial save) | SUBMITTED (to approval workflow)
  water: Record<string, MeterInput>;
  waterRemark: string;
  energy: Record<string, MeterInput>;
  energyRemark: string;
  sludge: LedgerInput;
  salt: LedgerInput;
}

interface DataState {
  industries: Industry[];
  readings: FlowMeterReading[];
  etpEntries: EtpEntry[];
  approvals: Approval[];
  alerts: Alert[];
  compliance: ComplianceRecord[];
  submitReading: (input: ReadingInput) => { reading: FlowMeterReading; alerts: AlertType[] };
  submitEtpEntry: (input: EtpEntryInput) => { entry: EtpEntry; alerts: AlertType[] };
  raiseEtpInletAlert: (industryId: string, etpInlet: number) => void;
  raiseTamperAlert: (industryId: string, clientISO: string, serverISO: string, driftMinutes: number) => void;
  reportIssue: (industryId: string, category: string, message: string) => void;
  sendDisciplinaryAlert: (industryId: string, message: string, severity: AlertSeverity) => void;
  decideApproval: (id: string, decision: "approved" | "rejected", reviewer: string) => void;
  registerIndustry: (input: RegisterInput) => Industry;
  completeRegistration: (industryId: string, patch: Partial<RegisterInput>) => void;
  acknowledgeAlert: (id: string) => void;
  resolveAlert: (id: string) => void;
  resetData: () => void;
}

const seed = (): StoreData => {
  const readings = buildReadings();
  const etpEntries = buildEtpEntries();
  return {
    industries: seedIndustries.map((i) => ({ ...i })),
    readings,
    etpEntries,
    approvals: [...buildEtpApprovals(etpEntries), ...buildApprovals(readings)],
    alerts: buildAlerts(readings),
    compliance: buildCompliance(),
  };
};

/** The full local seed dataset — used by StoreHydrator to bootstrap the
 *  per-industry documents on the first regulator sign-in against an empty project. */
export function buildSeedState(): StoreData {
  return seed();
}

function nowISO() {
  return new Date().toISOString();
}

function isLateFor(readingTime: string) {
  const [h, m] = readingTime.split(":").map(Number);
  const minutes = h * 60 + m;
  // morning window closes 08:30, evening window closes 20:30
  if (minutes < 12 * 60) return minutes > 8 * 60 + 30;
  return minutes > 20 * 60 + 30;
}

export const useDataStore = create<DataState>()(
  persist(
    (set, get) => ({
      ...seed(),

      submitReading: (input) => {
        const ind = get().industries.find((i) => i.id === input.industryId);
        const difference = input.currentReading - input.previousReading;
        const shift = Number(input.readingTime.split(":")[0]) < 12 ? "morning" : "evening";
        const isLate = isLateFor(input.readingTime);
        const id = `R-${Date.now().toString(36).toUpperCase()}`;
        const submittedAt = nowISO();

        const reading: FlowMeterReading = {
          id,
          industryId: input.industryId,
          industryName: ind?.name ?? "Unknown",
          cetpId: ind?.cetpId ?? null,
          date: input.date,
          readingTime: input.readingTime,
          shift,
          isLate,
          meterPoint: input.meterPoint,
          previousReading: input.previousReading,
          currentReading: input.currentReading,
          difference,
          unit: input.unit,
          hasPhoto: input.hasPhoto,
          operatorName: input.operatorName,
          inspectorName: input.inspectorName,
          remarks: input.remarks,
          status: "pending",
          submittedAt,
        };

        // derive alerts
        const fired: AlertType[] = [];
        if (isLate) fired.push("late-submission");
        if (difference === 0 && input.meterPoint !== "Energy Meter") fired.push("zero-reading");
        if (ind && difference > ind.permittedKLD && input.meterPoint !== "Energy Meter") fired.push("capacity-exceeded");
        else if (ind && difference > ind.permittedKLD * 0.85 && input.meterPoint !== "Energy Meter") fired.push("high-flow");
        if (!input.hasPhoto) fired.push("missing-photo");

        const newAlerts: Alert[] = fired.map((type, idx) => ({
          id: `AL-${id}-${idx}`,
          type,
          severity: ALERT_META[type].severity,
          industryId: input.industryId,
          industryName: ind?.name ?? null,
          cetpId: ind?.cetpId ?? null,
          title: ALERT_META[type].label,
          message: `${ALERT_META[type].label} on ${input.meterPoint} reading for ${ind?.name ?? "industry"}.`,
          createdAt: submittedAt,
          status: "active",
          relatedReadingId: id,
        }));

        const approval: Approval = {
          id: `A-${Date.now().toString(36).toUpperCase()}`,
          readingId: id,
          industryId: input.industryId,
          industryName: ind?.name ?? "Unknown",
          cetpId: ind?.cetpId ?? null,
          meterPoint: input.meterPoint,
          difference,
          unit: input.unit,
          hasPhoto: input.hasPhoto,
          remarks: input.remarks,
          stage: "submitted",
          submittedAt,
          reviewedAt: null,
          reviewer: null,
          alerts: fired,
          timeline: [
            { stage: "submitted", label: "Submitted", at: submittedAt, by: input.operatorName, done: true },
            { stage: "verification", label: "Under Verification", at: null, by: null, done: false },
            { stage: "approved", label: "Approved", at: null, by: null, done: false },
          ],
        };

        set((s) => ({
          readings: [reading, ...s.readings],
          approvals: [approval, ...s.approvals],
          alerts: [...newAlerts, ...s.alerts],
          industries: s.industries.map((i) =>
            i.id === input.industryId ? { ...i, lastReadingAt: submittedAt, alertsCount: i.alertsCount + fired.length } : i,
          ),
        }));

        return { reading, alerts: fired };
      },

      submitEtpEntry: (input) => {
        const ind = get().industries.find((i) => i.id === input.industryId);
        const isSubmit = input.status === "SUBMITTED";
        const submittedAt = nowISO();

        // Build structured prescribed-return readings (authoritative totals).
        const water: Record<string, MeterReading> = {};
        for (const code of Object.keys(input.water)) water[code] = toMeterReading(input.water[code].initial, input.water[code].final);
        const energy: Record<string, MeterReading> = {};
        for (const code of Object.keys(input.energy)) energy[code] = toMeterReading(input.energy[code].initial, input.energy[code].final);
        const waterTotals = groupGrandTotals(water);
        const sludge = toLedger(input.sludge);
        const salt = toLedger(input.salt);

        // Derive the retained legacy scalars from the water-meter totals (dashboards/CSV).
        const legacy = (key: string) => {
          const def = WATER_METERS.find((m) => m.legacyKey === key);
          return def ? water[def.code]?.total ?? 0 : 0;
        };
        const freshWaterConsumption = legacy("freshWaterConsumption");
        const etpInlet = legacy("etpInlet");
        const etpReuse = legacy("etpReuse");
        const roInlet = legacy("roInlet");
        const roReject = legacy("roReject");
        const roPermeate = legacy("roPermeate");
        const totalWaterIntake = round1(freshWaterConsumption + etpReuse + roPermeate);

        // One parent record per unit/date: reuse the id of any existing entry (draft → submit).
        const prior = get().etpEntries.find((e) => e.industryId === input.industryId && e.date === input.date);
        const id = prior?.id ?? `E-${Date.now().toString(36).toUpperCase()}`;

        const entry: EtpEntry = {
          id,
          industryId: input.industryId,
          industryName: ind?.name ?? "Unknown",
          date: input.date,
          freshWaterConsumption,
          etpInlet,
          etpOutlet: 0, // legacy field — no prescribed meter maps to it
          etpReuse,
          roInlet,
          roReject,
          roPermeate,
          sludgeToTSDF: 0, // legacy KL field — replaced by the kg sludge ledger
          totalWaterIntake,
          unit: "KL",
          status: "pending",
          submittedAt,
          water,
          waterTotals,
          waterRemark: input.waterRemark,
          energy,
          energyRemark: input.energyRemark,
          sludge,
          salt,
          entryStatus: input.status,
        };

        // Alerts + the Monitoring-Body approval are created only on SUBMIT (never on drafts).
        const fired: AlertType[] = [];
        if (isSubmit) {
          if (totalWaterIntake === 0) fired.push("zero-reading");
          if (ind && totalWaterIntake > ind.permittedKLD) fired.push("capacity-exceeded");
          else if (ind && totalWaterIntake > ind.permittedKLD * 0.85) fired.push("high-flow");
        }

        const newAlerts: Alert[] = fired.map((type, idx) => ({
          id: `AL-${id}-${idx}`,
          type,
          severity: ALERT_META[type].severity,
          industryId: input.industryId,
          industryName: ind?.name ?? null,
          cetpId: null,
          title: ALERT_META[type].label,
          message: `${ALERT_META[type].label} on ETP daily entry for ${ind?.name ?? "unit"}.`,
          createdAt: submittedAt,
          status: "active",
          relatedReadingId: id,
        }));

        const approval: Approval | null = isSubmit
          ? {
              id: `A-${Date.now().toString(36).toUpperCase()}`,
              readingId: id,
              industryId: input.industryId,
              industryName: ind?.name ?? "Unknown",
              cetpId: null,
              meterPoint: "ETP Water Balance",
              difference: totalWaterIntake,
              unit: "KL",
              hasPhoto: true,
              remarks: "Daily ETP prescribed-return entry.",
              stage: "submitted",
              submittedAt,
              reviewedAt: null,
              reviewer: null,
              alerts: fired,
              timeline: [
                { stage: "submitted", label: "Submitted", at: submittedAt, by: ind?.contactPerson ?? "Operator", done: true },
                { stage: "verification", label: "Under Verification", at: null, by: null, done: false },
                { stage: "approved", label: "Approved", at: null, by: null, done: false },
              ],
            }
          : null;

        set((s) => {
          const etpEntries = [entry, ...s.etpEntries.filter((e) => !(e.industryId === input.industryId && e.date === input.date))];
          const approvals = approval
            ? [approval, ...s.approvals.filter((a) => a.readingId !== id)]
            : s.approvals.filter((a) => a.readingId !== id);
          return {
            etpEntries,
            approvals,
            alerts: [...newAlerts, ...s.alerts],
            industries: s.industries.map((i) =>
              i.id === input.industryId && isSubmit
                ? { ...i, lastReadingAt: submittedAt, alertsCount: i.alertsCount + fired.length }
                : i,
            ),
          };
        });

        return { entry, alerts: fired };
      },

      // Fired from the ETP entry form when ETP Inlet exceeds the sanctioned ETP
      // capacity. The entry itself is blocked client-side, so this raises a
      // standalone capacity-exceeded alert to the Monitoring Body (no approval).
      raiseEtpInletAlert: (industryId, etpInlet) => {
        const ind = get().industries.find((i) => i.id === industryId);
        if (!ind) return;
        const createdAt = nowISO();
        const alert: Alert = {
          id: `AL-${Date.now().toString(36)}-INLET`,
          type: "capacity-exceeded",
          severity: ALERT_META["capacity-exceeded"].severity,
          industryId,
          industryName: ind.name,
          cetpId: null,
          title: ALERT_META["capacity-exceeded"].label,
          message: `ETP Inlet ${etpInlet} m³ exceeds sanctioned ETP capacity ${ind.etpCapacity} KLD for ${ind.name}.`,
          createdAt,
          status: "active",
          relatedReadingId: null,
        };
        set((s) => ({
          alerts: [alert, ...s.alerts],
          industries: s.industries.map((i) =>
            i.id === industryId ? { ...i, alertsCount: i.alertsCount + 1 } : i,
          ),
        }));
      },

      // Fired from the ETP entry form when the device clock disagrees with trusted
      // server time — a possible attempt to back/forward-date an entry. Raises a
      // descriptive time-tamper alert to the Monitoring Body.
      raiseTamperAlert: (industryId, clientISO, serverISO, driftMinutes) => {
        const ind = get().industries.find((i) => i.id === industryId);
        const createdAt = nowISO();
        const alert: Alert = {
          id: `AL-${Date.now().toString(36)}-TAMPER`,
          type: "time-tamper",
          severity: ALERT_META["time-tamper"].severity,
          industryId,
          industryName: ind?.name ?? null,
          cetpId: null,
          title: ALERT_META["time-tamper"].label,
          message: `Possible date/time tampering by ${ind?.name ?? "unit"}: the device clock (${clientISO}) differs from trusted server time (${serverISO}) by ~${driftMinutes} min at submission.`,
          createdAt,
          status: "active",
          relatedReadingId: null,
        };
        set((s) => ({
          alerts: [alert, ...s.alerts],
          industries: s.industries.map((i) => (i.id === industryId ? { ...i, alertsCount: i.alertsCount + 1 } : i)),
        }));
      },

      // ETP → Monitoring Body: an operator reports an issue from the Help Center.
      // The alert is written into the operator's OWN slice; the admin (who reads
      // every slice) sees it in the Alert Center.
      reportIssue: (industryId, category, message) => {
        const ind = get().industries.find((i) => i.id === industryId);
        const createdAt = nowISO();
        const alert: Alert = {
          id: `AL-${Date.now().toString(36)}-HELP`,
          type: "help-request",
          severity: ALERT_META["help-request"].severity,
          industryId,
          industryName: ind?.name ?? null,
          cetpId: null,
          title: `Help request · ${category}`,
          message,
          createdAt,
          status: "active",
          relatedReadingId: null,
        };
        set((s) => ({
          alerts: [alert, ...s.alerts],
          industries: s.industries.map((i) => (i.id === industryId ? { ...i, alertsCount: i.alertsCount + 1 } : i)),
        }));
      },

      // Monitoring Body → an ETP: a disciplinary / advisory notice. Written into the
      // TARGET unit's slice (the admin may write any slice), so the operator sees it
      // live in their own Alerts.
      sendDisciplinaryAlert: (industryId, message, severity) => {
        const ind = get().industries.find((i) => i.id === industryId);
        const createdAt = nowISO();
        const alert: Alert = {
          id: `AL-${Date.now().toString(36)}-NOTICE`,
          type: "disciplinary",
          severity,
          industryId,
          industryName: ind?.name ?? null,
          cetpId: null,
          title: "Notice from Monitoring Body",
          message,
          createdAt,
          status: "active",
          relatedReadingId: null,
        };
        set((s) => ({
          alerts: [alert, ...s.alerts],
          industries: s.industries.map((i) => (i.id === industryId ? { ...i, alertsCount: i.alertsCount + 1 } : i)),
        }));
      },

      decideApproval: (id, decision, reviewer) => {
        const reviewedAt = nowISO();
        set((s) => {
          const approval = s.approvals.find((a) => a.id === id);
          const stage: ApprovalStage = decision;
          const extraAlerts: Alert[] =
            decision === "rejected" && approval
              ? [
                  {
                    id: `AL-${Date.now().toString(36)}`,
                    type: "rejected-entry" as AlertType,
                    severity: ALERT_META["rejected-entry"].severity,
                    industryId: approval.industryId,
                    industryName: approval.industryName,
                    cetpId: approval.cetpId,
                    title: ALERT_META["rejected-entry"].label,
                    message: `Reading at ${approval.meterPoint} for ${approval.industryName} was rejected by ${reviewer}.`,
                    createdAt: reviewedAt,
                    status: "active",
                    relatedReadingId: approval.readingId,
                  },
                ]
              : [];

          return {
            approvals: s.approvals.map((a) =>
              a.id === id
                ? {
                    ...a,
                    stage,
                    reviewedAt,
                    reviewer,
                    timeline: [
                      { ...a.timeline[0], done: true },
                      { stage: "verification", label: "Under Verification", at: reviewedAt, by: reviewer, done: true },
                      {
                        stage,
                        label: decision === "approved" ? "Approved" : "Rejected",
                        at: reviewedAt,
                        by: reviewer,
                        done: true,
                      },
                    ],
                  }
                : a,
            ),
            readings: s.readings.map((r) =>
              approval && r.id === approval.readingId ? { ...r, status: decision } : r,
            ),
            etpEntries: s.etpEntries.map((e) =>
              approval && e.id === approval.readingId ? { ...e, status: decision } : e,
            ),
            alerts: [...extraAlerts, ...s.alerts],
          };
        });
      },

      registerIndustry: (input) => {
        // Derive the next id from the highest existing IND-### number (not the
        // array length) so ids never collide with seed ids or after a merge.
        const maxNum = get().industries.reduce((max, i) => {
          const n = parseInt(String(i.id).replace(/\D/g, ""), 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        const id = `IND-${String(maxNum + 1).padStart(3, "0")}`;
        const score = 75;
        const industry: Industry = {
          id,
          name: input.name,
          ownerName: input.ownerName,
          area: input.area,
          address: input.address,
          contactPerson: input.ownerName,
          mobile: input.mobile,
          email: input.email,
          consentNumber: input.consentNumber,
          permittedKLD: input.permittedKLD,
          status: "pending",
          cetpId: input.cetpId,
          isIndividualETP: input.cetpId === null,
          complianceScore: score,
          etpCapacity: input.etpCapacity,
          roCapacity: input.roCapacity,
          meeCapacity: input.meeCapacity,
          maxEffluentGeneration: input.maxEffluentGeneration,
          roStage1: input.roStage1,
          roStage2: input.roStage2,
          roStage3: input.roStage3,
          roStage4: input.roStage4,
          // RSPCB prescribed-return registration fields (master §3)
          misId: input.misId,
          tehsil: input.tehsil,
          district: input.district,
          consentOrderNo: input.consentOrderNo,
          consentOrderDate: input.consentOrderDate,
          consentValidFrom: input.consentValidFrom,
          consentValidTo: input.consentValidTo,
          hwmAuthNo: input.hwmAuthNo,
          hwmAuthDate: input.hwmAuthDate,
          hwmValidFrom: input.hwmValidFrom,
          hwmValidTo: input.hwmValidTo,
          authorisedQuantityKg: input.authorisedQuantityKg,
          authorisedSourceQuantity: input.authorisedSourceQuantity,
          authorisedSourceUnit: input.authorisedSourceUnit,
          tsdfName: input.tsdfName,
          tsdfAddress: input.tsdfAddress,
          signatoryName: input.signatoryName,
          signatoryDesignation: input.signatoryDesignation,
          registrationCompletedAt: input.registrationComplete ? new Date().toISOString() : null,
          lastReadingAt: null,
          alertsCount: 0,
          registeredAt: new Date().toISOString(),
        };
        set((s) => ({
          industries: [industry, ...s.industries],
          compliance: [
            {
              industryId: id,
              industryName: input.name,
              cetpId: input.cetpId,
              score,
              status: complianceStatus(score),
              submissionRate: 0,
              alertCount: 0,
              trend: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"].map((m) => ({ label: m, value: score })),
            },
            ...s.compliance,
          ],
        }));
        return industry;
      },

      // Onboarding gate: fill the RSPCB registration fields on an EXISTING unit and stamp
      // completion so the operator's dashboard/daily-entry unlocks.
      completeRegistration: (industryId, patch) => {
        set((s) => ({
          industries: s.industries.map((i) =>
            i.id === industryId
              ? {
                  ...i,
                  name: patch.name ?? i.name,
                  ownerName: patch.ownerName ?? i.ownerName,
                  contactPerson: patch.ownerName ?? i.contactPerson,
                  area: patch.area ?? i.area,
                  address: patch.address ?? i.address,
                  mobile: patch.mobile ?? i.mobile,
                  email: patch.email ?? i.email,
                  consentNumber: patch.consentNumber ?? i.consentNumber,
                  permittedKLD: patch.permittedKLD ?? i.permittedKLD,
                  etpCapacity: patch.etpCapacity ?? i.etpCapacity,
                  roCapacity: patch.roCapacity ?? i.roCapacity,
                  meeCapacity: patch.meeCapacity ?? i.meeCapacity,
                  maxEffluentGeneration: patch.maxEffluentGeneration ?? i.maxEffluentGeneration,
                  roStage1: patch.roStage1 ?? i.roStage1,
                  roStage2: patch.roStage2 ?? i.roStage2,
                  roStage3: patch.roStage3 ?? i.roStage3,
                  roStage4: patch.roStage4 ?? i.roStage4,
                  misId: patch.misId ?? i.misId,
                  tehsil: patch.tehsil ?? i.tehsil,
                  district: patch.district ?? i.district,
                  consentOrderNo: patch.consentOrderNo ?? i.consentOrderNo,
                  consentOrderDate: patch.consentOrderDate ?? i.consentOrderDate,
                  consentValidFrom: patch.consentValidFrom ?? i.consentValidFrom,
                  consentValidTo: patch.consentValidTo ?? i.consentValidTo,
                  hwmAuthNo: patch.hwmAuthNo ?? i.hwmAuthNo,
                  hwmAuthDate: patch.hwmAuthDate ?? i.hwmAuthDate,
                  hwmValidFrom: patch.hwmValidFrom ?? i.hwmValidFrom,
                  hwmValidTo: patch.hwmValidTo ?? i.hwmValidTo,
                  authorisedQuantityKg: patch.authorisedQuantityKg ?? i.authorisedQuantityKg,
                  authorisedSourceQuantity: patch.authorisedSourceQuantity ?? i.authorisedSourceQuantity,
                  authorisedSourceUnit: patch.authorisedSourceUnit ?? i.authorisedSourceUnit,
                  tsdfName: patch.tsdfName ?? i.tsdfName,
                  tsdfAddress: patch.tsdfAddress ?? i.tsdfAddress,
                  signatoryName: patch.signatoryName ?? i.signatoryName,
                  signatoryDesignation: patch.signatoryDesignation ?? i.signatoryDesignation,
                  registrationCompletedAt: new Date().toISOString(),
                }
              : i,
          ),
        }));
      },

      acknowledgeAlert: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "acknowledged" } : a)) })),
      resolveAlert: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "resolved" } : a)) })),

      resetData: () => set({ ...seed() }),
    }),
    {
      name: "jalrakshak-data",
      version: 9,
      skipHydration: true,
      storage: createJSONStorage(() => firestoreStorage),
      // v9 ADDITIVELY layers the RSPCB prescribed-return structures (12 water + 3 energy
      // meters, kg sludge/salt ledgers, per-group totals, draft/submit status) + the expanded
      // registration onto the retained legacy scalar shape. Reseed anything older than v9.
      migrate: (persisted, version) => (version < 9 ? seed() : persisted) as DataState,
    },
  ),
);

/* ---------------- Derived selectors ---------------- */
export interface DashboardMetrics {
  totalIndustries: number;
  pendingApprovals: number;
  rejectedEntries: number;
  nonReporting: number;
  activeAlerts: number;
}

/**
 * Time-synced daily intake for an ETP unit — keyed on the stored entry DATE
 * (local YYYY-MM-DD), so "today" rolls into "yesterday" automatically when the
 * calendar day changes. Missing days count as 0.
 */
export function dailyIntake(entries: EtpEntry[], todayStr: string, yesterdayStr: string) {
  const today = entries.find((e) => e.date === todayStr)?.totalWaterIntake ?? 0;
  const yesterday = entries.find((e) => e.date === yesterdayStr)?.totalWaterIntake ?? 0;
  return { today, yesterday, difference: today - yesterday };
}

export function selectMetrics(s: DataState): DashboardMetrics {
  return {
    totalIndustries: s.industries.length,
    pendingApprovals: s.approvals.filter((a) => a.stage === "submitted" || a.stage === "verification").length,
    rejectedEntries: s.approvals.filter((a) => a.stage === "rejected").length,
    nonReporting: s.industries.filter((i) => i.status === "non-reporting").length,
    activeAlerts: s.alerts.filter((a) => a.status === "active").length,
  };
}
