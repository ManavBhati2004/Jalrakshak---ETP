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
  MeterReading,
  HwLedger,
} from "@/lib/types";
import { complianceStatus, ALERT_META, WATER_METERS, ENERGY_METERS } from "@/lib/constants";
import { groupGrandTotals, round1 } from "@/lib/data/etp-calc";

export const DEMO_TODAY = "2026-08-14";

/** Enrich the raw seed units with realistic RSPCB prescribed-return registration fields
 *  (from the Balotra cluster / the Mayank Texofin Excel) so the authorisation warning,
 *  onboarding prefill and Compliance context work out of the box. Marked registration-complete
 *  so the demo operator is not gated (the onboarding gate still fires for any incomplete unit). */
export const industries: Industry[] = (industriesRaw as Industry[]).map((i, idx) => ({
  ...i,
  misId: i.misId ?? `${69197 + idx * 3568}`,
  tehsil: i.tehsil ?? "Balotra",
  district: i.district ?? "Barmer",
  consentOrderNo: i.consentOrderNo ?? `2021-2022/TCD/${7197 + idx * 43}`,
  consentOrderDate: i.consentOrderDate ?? "2021-12-01",
  consentValidFrom: i.consentValidFrom ?? "2021-12-01",
  consentValidTo: i.consentValidTo ?? "2026-11-30",
  hwmAuthNo: i.hwmAuthNo ?? `RPCB/HWM/2023-2024/TCD/HSW/${12 + idx}`,
  hwmAuthDate: i.hwmAuthDate ?? "2022-07-01",
  hwmValidFrom: i.hwmValidFrom ?? "2022-07-01",
  hwmValidTo: i.hwmValidTo ?? "2027-06-30",
  authorisedSourceQuantity: i.authorisedSourceQuantity ?? 15.42,
  authorisedSourceUnit: i.authorisedSourceUnit ?? "MT",
  authorisedQuantityKg: i.authorisedQuantityKg ?? 15420,
  tsdfName: i.tsdfName ?? "Balotra Waste Management Project (Ramky Enviro Engineers Ltd.)",
  tsdfAddress:
    i.tsdfAddress ??
    "Survey No. & Plot No. 1114/274/13 & 1115/274/14, Village Kher, Teh. Pachpadra, Barmer (Raj.)",
  signatoryName: i.signatoryName ?? i.ownerName,
  signatoryDesignation: i.signatoryDesignation ?? "Prop.",
  registrationCompletedAt: i.registrationCompletedAt ?? i.registeredAt,
}));

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

/** A full month of daily rows per unit, like the client Excel logbook. */
const SEED_DAYS = 31;

/** Per-meter realistic ranges taken from the client Excel (`7. MAYANK TEXOFIN JULY 2026`):
 *  `init` = opening cumulative reading, `min`/`max` = the daily Total band (M³ for water,
 *  kWh for energy). RO/MEE meters are legitimately small; the big streams are large. */
const WATER_SEED: Record<string, { init: number; min: number; max: number }> = {
  RAW_FRESH_WATER: { init: 14198, min: 15, max: 32 },
  ETP_INLET_ALL_STREAMS: { init: 684654, min: 90, max: 180 },
  TERTIARY_TREATED: { init: 268259, min: 90, max: 175 },
  ETP_DIRECT_REUSE: { init: 205495, min: 85, max: 165 },
  RO_FEED_1_2: { init: 43710, min: 6, max: 13 },
  RO_PERMEATE_COMMON: { init: 37034, min: 5, max: 10 },
  RO_REJECT_1_2: { init: 6608, min: 1, max: 2.5 },
  RO_PERMEATE_3_4: { init: 0, min: 0, max: 3.6 },
  RO_REJECT_3_4: { init: 0, min: 0, max: 3 },
  MEE_FEED: { init: 2546, min: 0, max: 9 },
  MEE_CONDENSATE: { init: 2114, min: 0, max: 8 },
  MEE_REJECT: { init: 419, min: 0, max: 1 },
};
const ENERGY_SEED: Record<string, { init: number; min: number; max: number }> = {
  ETP_POWER: { init: 774601, min: 130, max: 290 },
  RO_POWER: { init: 41302, min: 8, max: 25 },
  MEE_POWER: { init: 6890, min: 0, max: 42 },
};

export function buildEtpEntries(): EtpEntry[] {
  const entries: EtpEntry[] = [];
  let n = 0;
  const etpUnits = industries.filter((i) => i.isIndividualETP);
  for (const ind of etpUnits) {
    const rnd = mulberry32(hashStr(ind.id + "etp"));

    // Cumulative meter bases (carry-forward: next-day Initial = prior-day Final), seeded from
    // the Excel opening readings with a small per-unit offset so units differ but stay realistic.
    const waterBase: Record<string, number> = {};
    for (const m of WATER_METERS) waterBase[m.code] = round1(WATER_SEED[m.code].init * (0.96 + rnd() * 0.08));
    const energyBase: Record<string, number> = {};
    for (const e of ENERGY_METERS) energyBase[e.code] = round1(ENERGY_SEED[e.code].init * (0.96 + rnd() * 0.08));
    let sludgeOpening = round1(12000 + rnd() * 800); // kg (~12.0–12.8 MT, like the Excel)
    let saltOpening = round1(800 + rnd() * 80); // kg (~0.80–0.88 MT)

    // Two sludge dispatch days spread across the month (with manifest + disposal date).
    const dispatchDays = new Set([SEED_DAYS - 10, SEED_DAYS - 22]);

    for (let d = SEED_DAYS - 1; d >= 0; d--) {
      const date = dayISO(d).slice(0, 10);
      const off = (SEED_DAYS - 1 - d) % 7 === 6; // every 7th day → weekly off (no production)

      const water: Record<string, MeterReading> = {};
      for (const m of WATER_METERS) {
        const cfg = WATER_SEED[m.code];
        const initial = waterBase[m.code];
        const flow = off ? 0 : round1(cfg.min + rnd() * (cfg.max - cfg.min));
        const final = round1(initial + flow);
        water[m.code] = { initial, final, total: round1(final - initial) };
        waterBase[m.code] = final;
      }
      const waterTotals = groupGrandTotals(water);

      const energy: Record<string, MeterReading> = {};
      for (const e of ENERGY_METERS) {
        const cfg = ENERGY_SEED[e.code];
        const initial = energyBase[e.code];
        const flow = off ? 0 : round1(cfg.min + rnd() * (cfg.max - cfg.min));
        const final = round1(initial + flow);
        energy[e.code] = { initial, final, total: round1(final - initial) };
        energyBase[e.code] = final;
      }

      // Sludge ledger (kg): daily generation, two dispatch days; salt accumulates (kg).
      const sludgeGen = off ? 0 : round1(150 + rnd() * 160);
      const sludgeDispatch = dispatchDays.has(d) ? round1(sludgeOpening * 0.45) : 0;
      const sludge: HwLedger = {
        opening: sludgeOpening,
        generation: sludgeGen,
        dateOfDisposal: sludgeDispatch > 0 ? date : "",
        dispatch: sludgeDispatch,
        manifestNo: sludgeDispatch > 0 ? `MF-${ind.misId ?? ind.id}-${SEED_DAYS - d}` : "",
        closing: round1(sludgeOpening + sludgeGen - sludgeDispatch),
        remark: "",
      };
      sludgeOpening = sludge.closing;

      const saltGen = off ? 0 : round1(5 + rnd() * 8);
      const salt: HwLedger = {
        opening: saltOpening,
        generation: saltGen,
        dateOfDisposal: "",
        dispatch: 0,
        manifestNo: "",
        closing: round1(saltOpening + saltGen),
        remark: "",
      };
      saltOpening = salt.closing;

      // Legacy scalars derived from the mapped water meters.
      const legacy = (key: string) => {
        const def = WATER_METERS.find((m) => m.legacyKey === key);
        return def ? water[def.code].total : 0;
      };
      const fresh = legacy("freshWaterConsumption");
      const etpInlet = legacy("etpInlet");
      const etpReuse = legacy("etpReuse");
      const roInlet = legacy("roInlet");
      const roReject = legacy("roReject");
      const roPermeate = legacy("roPermeate");

      entries.push({
        id: `E-${String(++n).padStart(4, "0")}`,
        industryId: ind.id,
        industryName: ind.name,
        date,
        freshWaterConsumption: fresh,
        etpInlet,
        etpOutlet: 0,
        etpReuse,
        roInlet,
        roReject,
        roPermeate,
        sludgeToTSDF: 0,
        totalWaterIntake: round1(fresh + etpReuse + roPermeate),
        unit: "KL",
        status: d === 0 ? "pending" : "approved", // most recent day awaits review
        submittedAt: dayISO(d, "09:00"),
        water,
        waterTotals,
        waterRemark: off ? "Weekly off — no production" : "",
        energy,
        energyRemark: "",
        sludge,
        salt,
        entryStatus: "SUBMITTED",
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
