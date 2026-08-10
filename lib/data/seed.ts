import industriesRaw from "@/data/industries.json";
import type {
  Industry,
  FlowMeterReading,
  Approval,
  ApprovalStep,
  Alert,
  AlertType,
  ComplianceRecord,
  MeterPoint,
  TrendPoint,
  ReadingShift,
  EtpEntry,
} from "@/lib/types";
import { complianceStatus, ALERT_META } from "@/lib/constants";

export const industries = industriesRaw as Industry[];

export const DEMO_TODAY = "2026-06-20";

/* deterministic PRNG so server + client render identical seed data */
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dayISO(offsetDays: number, time = "08:00") {
  const base = new Date(`${DEMO_TODAY}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() - offsetDays);
  const [h, m] = time.split(":").map(Number);
  base.setUTCHours(h, m, 0, 0);
  return base.toISOString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const WEEKS = Array.from({ length: 12 }, (_, i) => `W${i + 1}`);

const CETP_METER_POINTS: MeterPoint[] = ["Raw Water", "Equalization", "UF", "RO", "MEE", "Energy Meter"];
const ETP_METER_POINTS: MeterPoint[] = ["Raw Water", "UF", "RO", "MEE"];

/* ------------------------------------------------------------------ */
/* Flow-meter readings                                                 */
/* ------------------------------------------------------------------ */
export function buildReadings(): FlowMeterReading[] {
  const readings: FlowMeterReading[] = [];
  let counter = 0;

  for (const ind of industries) {
    const rnd = mulberry32(hashStr(ind.id));
    const points = ind.isIndividualETP ? ETP_METER_POINTS : CETP_METER_POINTS;
    const nonReporting = ind.status === "non-reporting";
    const suspended = ind.status === "suspended";

    // how many recent days of data
    const days = nonReporting ? 0 : suspended ? 1 : 2;
    let base = Math.round(ind.permittedKLD * (8 + rnd() * 4)); // running meter total

    for (let d = days; d >= 1; d--) {
      for (const slot of ["08:00", "20:00"] as const) {
        const shift: ReadingShift = slot === "08:00" ? "morning" : "evening";
        const point = points[counter % points.length];
        const isEnergy = point === "Energy Meter";
        const flow = isEnergy
          ? Math.round(ind.permittedKLD * (1.6 + rnd() * 0.8)) // kWh-ish
          : Math.round(ind.permittedKLD * (0.42 + rnd() * 0.16));

        const prev = base;
        // occasional anomalies
        const zero = rnd() < 0.05 && !isEnergy;
        const spike = rnd() < 0.08;
        const cur = prev + (zero ? 0 : spike ? flow * 2 : flow);
        const diff = cur - prev;
        base = cur;

        const late = rnd() < 0.18;
        const readingTime = late ? (shift === "morning" ? "09:40" : "21:25") : slot;
        const hasPhoto = rnd() > 0.12;

        // status logic
        let status: FlowMeterReading["status"] = "approved";
        if (d === 1 && slot === "20:00") status = "pending";
        else if (rnd() < 0.08) status = "rejected";
        else if (rnd() < 0.14) status = "pending";

        readings.push({
          id: `R-${String(++counter).padStart(4, "0")}`,
          industryId: ind.id,
          industryName: ind.name,
          cetpId: ind.cetpId,
          date: dayISO(d).slice(0, 10),
          readingTime,
          shift,
          isLate: late,
          meterPoint: point,
          previousReading: prev,
          currentReading: cur,
          difference: diff,
          unit: isEnergy ? "kWh" : "KL",
          hasPhoto,
          operatorName: ind.contactPerson,
          inspectorName: rnd() > 0.4 ? "Insp. R. K. Meena" : "Insp. S. Choudhary",
          remarks: zero ? "Meter showed no movement." : spike ? "Higher discharge during shift." : "Routine reading.",
          status,
          submittedAt: dayISO(d, readingTime),
        });
      }
    }
  }
  return readings;
}

/* ------------------------------------------------------------------ */
/* Approvals — derived from non-approved + a few approved readings     */
/* ------------------------------------------------------------------ */
function timeline(stage: Approval["stage"], submittedAt: string, reviewedAt: string | null, reviewer: string | null): ApprovalStep[] {
  const verified = stage === "approved" || stage === "rejected" || stage === "verification";
  const decided = stage === "approved" || stage === "rejected";
  return [
    { stage: "submitted", label: "Submitted", at: submittedAt, by: "Operator", done: true },
    { stage: "verification", label: "Under Verification", at: verified ? reviewedAt ?? submittedAt : null, by: verified ? reviewer : null, done: verified },
    {
      stage: stage === "rejected" ? "rejected" : "approved",
      label: stage === "rejected" ? "Rejected" : "Approved",
      at: decided ? reviewedAt : null,
      by: decided ? reviewer : null,
      done: decided,
    },
  ];
}

export function buildApprovals(readings: FlowMeterReading[]): Approval[] {
  const approvals: Approval[] = [];
  let n = 0;
  for (const r of readings) {
    const rnd = mulberry32(hashStr(r.id));
    const includeApproved = r.status === "approved" && rnd() < 0.25;
    if (r.status === "approved" && !includeApproved) continue;

    const stage: Approval["stage"] =
      r.status === "rejected" ? "rejected" : r.status === "approved" ? "approved" : rnd() < 0.5 ? "verification" : "submitted";

    const alerts: AlertType[] = [];
    if (r.isLate) alerts.push("late-submission");
    if (r.difference === 0) alerts.push("zero-reading");
    if (!r.hasPhoto) alerts.push("missing-photo");

    const reviewer = stage === "submitted" ? null : "Insp. R. K. Meena";
    const reviewedAt = stage === "submitted" ? null : dayISO(0, "10:30");

    approvals.push({
      id: `A-${String(++n).padStart(4, "0")}`,
      readingId: r.id,
      industryId: r.industryId,
      industryName: r.industryName,
      cetpId: r.cetpId,
      meterPoint: r.meterPoint,
      difference: r.difference,
      unit: r.unit,
      hasPhoto: r.hasPhoto,
      remarks: r.remarks,
      stage,
      submittedAt: r.submittedAt,
      reviewedAt,
      reviewer,
      alerts,
      timeline: timeline(stage, r.submittedAt, reviewedAt, reviewer),
    });
  }
  return approvals;
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */
export function buildAlerts(readings: FlowMeterReading[]): Alert[] {
  const alerts: Alert[] = [];
  let n = 0;
  const add = (type: AlertType, ind: Industry | null, message: string, readingId: string | null) => {
    const meta = ALERT_META[type];
    alerts.push({
      id: `AL-${String(++n).padStart(4, "0")}`,
      type,
      severity: meta.severity,
      industryId: ind?.id ?? null,
      industryName: ind?.name ?? null,
      cetpId: ind?.cetpId ?? null,
      title: meta.label,
      message,
      createdAt: dayISO(Math.floor(n % 3), "07:30"),
      status: n % 5 === 0 ? "acknowledged" : "active",
      relatedReadingId: readingId,
    });
  };

  for (const ind of industries) {
    if (ind.status === "non-reporting") {
      add("non-reporting", ind, `${ind.name} has not reported in the last 48 hours.`, null);
    }
    if (ind.status === "suspended") {
      add("rejected-entry", ind, `${ind.name} has a suspended consent — entries on hold.`, null);
    }
  }

  for (const r of readings) {
    const ind = industries.find((i) => i.id === r.industryId) ?? null;
    if (r.difference === 0 && r.meterPoint !== "Energy Meter") {
      add("zero-reading", ind, `Zero flow recorded at ${r.meterPoint} for ${r.industryName}.`, r.id);
    } else if (ind && r.difference > ind.permittedKLD && r.meterPoint !== "Energy Meter") {
      add("capacity-exceeded", ind, `${r.industryName} exceeded permitted ${ind.permittedKLD} KLD at ${r.meterPoint}.`, r.id);
    } else if (ind && r.difference > ind.permittedKLD * 0.85 && r.meterPoint !== "Energy Meter") {
      add("high-flow", ind, `High flow (${r.difference} ${r.unit}) at ${r.meterPoint} for ${r.industryName}.`, r.id);
    }
    if (r.isLate) add("late-submission", ind, `Late ${r.shift} reading submitted by ${r.industryName}.`, r.id);
    if (!r.hasPhoto) add("missing-photo", ind, `Photo missing for ${r.meterPoint} reading at ${r.industryName}.`, r.id);
    if (r.status === "rejected") add("rejected-entry", ind, `Reading at ${r.meterPoint} for ${r.industryName} was rejected.`, r.id);
  }

  // keep a focused, prioritized set
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  return alerts.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]).slice(0, 26);
}

/* ------------------------------------------------------------------ */
/* Compliance records                                                  */
/* ------------------------------------------------------------------ */
export function buildCompliance(): ComplianceRecord[] {
  return industries.map((ind) => {
    const rnd = mulberry32(hashStr(ind.id + "comp"));
    const trend: TrendPoint[] = MONTHS.map((m, i) => {
      const drift = (rnd() - 0.5) * 10;
      const ramp = (i - MONTHS.length + 1) * 1.2;
      return { label: m, value: Math.max(35, Math.min(99, Math.round(ind.complianceScore + ramp + drift))) };
    });
    trend[trend.length - 1].value = ind.complianceScore;
    return {
      industryId: ind.id,
      industryName: ind.name,
      cetpId: ind.cetpId,
      score: ind.complianceScore,
      status: complianceStatus(ind.complianceScore),
      submissionRate: Math.max(40, Math.min(100, Math.round(ind.complianceScore + (rnd() - 0.4) * 12))),
      alertCount: ind.alertsCount,
      trend,
    };
  });
}

/* ------------------------------------------------------------------ */
/* ETP daily water-balance entries (individual ETP units)              */
/* ------------------------------------------------------------------ */
export function buildEtpEntries(): EtpEntry[] {
  const entries: EtpEntry[] = [];
  let n = 0;
  const etpUnits = industries.filter((i) => i.isIndividualETP);
  for (const ind of etpUnits) {
    const rnd = mulberry32(hashStr(ind.id + "etp"));
    for (let d = 3; d >= 1; d--) {
      const fresh = Math.round(ind.permittedKLD * (0.7 + rnd() * 0.25));
      const etpInlet = Math.round(ind.permittedKLD * (0.85 + rnd() * 0.15));
      const etpOutlet = Math.round(etpInlet * (0.88 + rnd() * 0.07));
      const etpReuse = Math.round(etpOutlet * (0.18 + rnd() * 0.1));
      const roInlet = Math.round(etpOutlet * (0.78 + rnd() * 0.1));
      const roPermeate = Math.round(roInlet * (0.62 + rnd() * 0.08));
      const roReject = Math.max(0, roInlet - roPermeate);
      const sludgeToTSDF = Math.round(ind.permittedKLD * (0.02 + rnd() * 0.03));
      entries.push({
        id: `E-${String(++n).padStart(4, "0")}`,
        industryId: ind.id,
        industryName: ind.name,
        date: dayISO(d).slice(0, 10),
        freshWaterConsumption: fresh,
        etpInlet,
        etpOutlet,
        etpReuse,
        roInlet,
        roReject,
        roPermeate,
        sludgeToTSDF,
        totalWaterIntake: fresh + etpReuse + roPermeate,
        unit: "KL",
        status: d === 1 ? "pending" : "approved",
        submittedAt: dayISO(d, "09:00"),
      });
    }
  }
  return entries;
}

export function buildEtpApprovals(entries: EtpEntry[]): Approval[] {
  let n = 5000;
  return entries
    .filter((e) => e.status !== "approved")
    .map((e) => {
      const stage: Approval["stage"] = "submitted";
      return {
        id: `A-${String(++n)}`,
        readingId: e.id,
        industryId: e.industryId,
        industryName: e.industryName,
        cetpId: null,
        meterPoint: "ETP Water Balance" as MeterPoint,
        difference: e.totalWaterIntake,
        unit: e.unit,
        hasPhoto: true,
        remarks: "Daily ETP water-balance entry.",
        stage,
        submittedAt: e.submittedAt,
        reviewedAt: null,
        reviewer: null,
        alerts: [],
        timeline: timeline(stage, e.submittedAt, null, null),
      };
    });
}

/* dashboard preview trends (home page) */
export function buildPreviewTrends() {
  const rnd = mulberry32(hashStr("preview"));
  return WEEKS.map((w, i) => ({
    label: w,
    wastewater: Math.round(36000 + i * 420 + (rnd() - 0.5) * 3000),
    compliance: Math.max(70, Math.min(98, Math.round(78 + i * 1.4 + (rnd() - 0.5) * 5))),
    flow: Math.round(30000 + i * 360 + (rnd() - 0.5) * 2400),
  }));
}
