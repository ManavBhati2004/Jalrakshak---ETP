import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { firestoreStorage, type StoreData } from "@/lib/data/firestore-storage";
import type {
  Industry,
  FlowMeterReading,
  Approval,
  Alert,
  AlertType,
  ComplianceRecord,
  ApprovalStage,
  MeterPoint,
  CetpId,
  EtpEntry,
  MeterReading,
  SludgeLedger,
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
import { ALERT_META, complianceStatus, WATER_METERS, ENERGY_METERS } from "@/lib/constants";

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
  // RSPCB prescribed-return fields (Fateh spec §1)
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
  authorisedQuantityKg?: number;
  tsdfName?: string;
  tsdfAddress?: string;
  signatoryName?: string;
  signatoryDesignation?: string;
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
export interface EtpEntryInput {
  industryId: string;
  date: string;
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
  decideApproval: (id: string, decision: "approved" | "rejected", reviewer: string) => void;
  registerIndustry: (input: RegisterInput) => Industry;
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
        const id = `E-${Date.now().toString(36).toUpperCase()}`;
        const submittedAt = nowISO();

        const toMeter = (m: MeterInput): MeterReading => ({
          initial: m.initial,
          final: m.final,
          total: Math.max(0, m.final - m.initial),
        });
        const water: Record<string, MeterReading> = {};
        for (const k of Object.keys(input.water)) water[k] = toMeter(input.water[k]);
        const energy: Record<string, MeterReading> = {};
        for (const k of Object.keys(input.energy)) energy[k] = toMeter(input.energy[k]);
        const waterGrandTotal = Object.values(water).reduce((sum, m) => sum + m.total, 0);

        const toLedger = (l: LedgerInput): SludgeLedger => ({
          opening: l.opening,
          generation: l.generation,
          dateOfDisposal: l.dateOfDisposal,
          dispatch: l.dispatch,
          manifestNo: l.manifestNo,
          closing: l.opening + l.generation - l.dispatch,
          remark: l.remark,
        });
        const sludge = toLedger(input.sludge);
        const salt = toLedger(input.salt);

        // Derived legacy summary from the water-meter totals.
        const freshWaterConsumption = water.rawFreshWater?.total ?? 0;
        const etpInlet = water.etpInlet?.total ?? 0;
        const etpReuse = water.etpTreatedReuse?.total ?? 0;
        const roInlet = water.roFeed?.total ?? 0;
        const roReject = water.roReject?.total ?? 0;
        const roPermeate = water.roPermeate?.total ?? 0;
        const totalWaterIntake = freshWaterConsumption + etpReuse + roPermeate;

        const entry: EtpEntry = {
          id,
          industryId: input.industryId,
          industryName: ind?.name ?? "Unknown",
          date: input.date,
          water,
          waterGrandTotal,
          waterRemark: input.waterRemark,
          energy,
          energyRemark: input.energyRemark,
          sludge,
          salt,
          freshWaterConsumption,
          etpInlet,
          etpReuse,
          roInlet,
          roReject,
          roPermeate,
          totalWaterIntake,
          unit: "KL",
          status: "pending",
          submittedAt,
        };

        const fired: AlertType[] = [];
        if (totalWaterIntake === 0) fired.push("zero-reading");
        if (ind && totalWaterIntake > ind.permittedKLD) fired.push("capacity-exceeded");
        else if (ind && totalWaterIntake > ind.permittedKLD * 0.85) fired.push("high-flow");

        const newAlerts: Alert[] = fired.map((type, idx) => ({
          id: `AL-${id}-${idx}`,
          type,
          severity: ALERT_META[type].severity,
          industryId: input.industryId,
          industryName: ind?.name ?? null,
          cetpId: null,
          title: ALERT_META[type].label,
          message: `${ALERT_META[type].label} on ETP water-balance for ${ind?.name ?? "unit"}.`,
          createdAt: submittedAt,
          status: "active",
          relatedReadingId: id,
        }));

        const approval: Approval = {
          id: `A-${Date.now().toString(36).toUpperCase()}`,
          readingId: id,
          industryId: input.industryId,
          industryName: ind?.name ?? "Unknown",
          cetpId: null,
          meterPoint: "ETP Water Balance",
          difference: totalWaterIntake,
          unit: "KL",
          hasPhoto: true,
          remarks: "Daily ETP water-balance entry.",
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
        };

        set((s) => ({
          etpEntries: [entry, ...s.etpEntries],
          approvals: [approval, ...s.approvals],
          alerts: [...newAlerts, ...s.alerts],
          industries: s.industries.map((i) =>
            i.id === input.industryId ? { ...i, lastReadingAt: submittedAt, alertsCount: i.alertsCount + fired.length } : i,
          ),
        }));

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
          tehsil: input.tehsil,
          district: input.district,
          misId: input.misId,
          consentOrderNo: input.consentOrderNo,
          consentOrderDate: input.consentOrderDate,
          consentValidFrom: input.consentValidFrom,
          consentValidTo: input.consentValidTo,
          hwmAuthNo: input.hwmAuthNo,
          hwmAuthDate: input.hwmAuthDate,
          hwmValidFrom: input.hwmValidFrom,
          hwmValidTo: input.hwmValidTo,
          authorisedQuantityKg: input.authorisedQuantityKg,
          tsdfName: input.tsdfName,
          tsdfAddress: input.tsdfAddress,
          signatoryName: input.signatoryName,
          signatoryDesignation: input.signatoryDesignation,
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

      acknowledgeAlert: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "acknowledged" } : a)) })),
      resolveAlert: (id) =>
        set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "resolved" } : a)) })),

      resetData: () => set({ ...seed() }),
    }),
    {
      name: "jalrakshak-data",
      version: 5,
      skipHydration: true,
      storage: createJSONStorage(() => firestoreStorage),
      // v5 rebuilt EtpEntry to the RSPCB prescribed shape (10 water + 3 energy
      // meters with initial/final/total, plus kg sludge/salt ledgers). Any older
      // persisted shape is incompatible, so reset it to the current seed.
      migrate: (persisted, version) => (version < 5 ? seed() : persisted) as DataState,
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

/** Most recent prior entry for a unit (by date) — source of the carry-forward readings. */
export function latestEntryFor(entries: EtpEntry[], industryId: string): EtpEntry | undefined {
  return entries
    .filter((e) => e.industryId === industryId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.submittedAt.localeCompare(a.submittedAt)))[0];
}

/** Flatten ETP entries to labelled CSV rows (nested meters → one column each). */
export function etpEntryExportRows(entries: EtpEntry[]): Record<string, unknown>[] {
  return entries.map((e) => {
    const row: Record<string, unknown> = { Date: e.date };
    for (const m of WATER_METERS) row[`${m.label} (M3)`] = e.water?.[m.key]?.total ?? 0;
    row["Water Grand Total (M3)"] = e.waterGrandTotal;
    for (const m of ENERGY_METERS) row[`${m.label} (kWh)`] = e.energy?.[m.key]?.total ?? 0;
    row["Sludge Generated (kg)"] = e.sludge?.generation ?? 0;
    row["Sludge Dispatched (kg)"] = e.sludge?.dispatch ?? 0;
    row["Sludge Closing (kg)"] = e.sludge?.closing ?? 0;
    row["Salt Generated (kg)"] = e.salt?.generation ?? 0;
    row["Salt Dispatched (kg)"] = e.salt?.dispatch ?? 0;
    row["Salt Closing (kg)"] = e.salt?.closing ?? 0;
    row["Total Water Intake (M3)"] = e.totalWaterIntake;
    row["Water Remark"] = e.waterRemark ?? "";
    row["Status"] = e.status;
    row["Submitted At"] = e.submittedAt;
    return row;
  });
}

/** Cumulative dispatched quantity (kg) for a ledger across a unit's history. */
export function cumulativeDispatch(entries: EtpEntry[], industryId: string, ledger: "sludge" | "salt"): number {
  return entries.filter((e) => e.industryId === industryId).reduce((sum, e) => sum + (e[ledger]?.dispatch ?? 0), 0);
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
