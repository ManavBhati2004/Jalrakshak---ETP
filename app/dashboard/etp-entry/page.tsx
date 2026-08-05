"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Check, Send, Droplets, Zap, Trash2, Lock, TriangleAlert, Ban, Printer } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { EtpPrintSheets } from "@/components/dashboard/etp-print-sheets";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore } from "@/lib/store/data";
import { getServerTime } from "@/lib/data/server-time";
import {
  meterRowStatus,
  closingBalance,
  cumulativeDispatch,
  authorisedQuantityWarning,
  dispatchNeedsManifest as needsManifest,
  resolveCarryForward,
  round1,
} from "@/lib/data/etp-calc";
import type { AlertType, EtpEntry } from "@/lib/types";
import { ALERT_META, WATER_METERS, ENERGY_METERS, AUTHORISED_QUANTITY_WARNING_PERCENT } from "@/lib/constants";
import { formatNumber, formatDate } from "@/lib/utils";

type MeterState = { initial: string; final: string };
type LedgerState = {
  opening: number;
  generation: string;
  dateOfDisposal: string;
  dispatch: string;
  manifestNo: string;
  remark: string;
};

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
// Cumulative meter readings are free (can exceed 5 digits); daily kg figures are
// capped at 5 integer digits + 1 decimal ("up to one decimal place").
const numFilter = (s: string) => s.replace(/[^0-9.]/g, "");
const kgFilter = (s: string) => {
  const v = s.replace(/[^0-9.]/g, "");
  const [int = "", dec = ""] = v.split(".");
  const capped = int.slice(0, 5);
  return v.includes(".") ? `${capped}.${dec.slice(0, 1)}` : capped;
};

const emptyMeters = (keys: readonly { key: string }[]): Record<string, MeterState> =>
  Object.fromEntries(keys.map((k) => [k.key, { initial: "", final: "" }]));
const emptyLedger = (): LedgerState => ({ opening: 0, generation: "", dateOfDisposal: "", dispatch: "", manifestNo: "", remark: "" });

export default function EtpEntryPage() {
  const industryId = useAuthStore((s) => s.industryId);
  const uid = useAuthStore((s) => s.uid);
  const industries = useDataStore((s) => s.industries);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const submitEtpEntry = useDataStore((s) => s.submitEtpEntry);
  const raiseTamperAlert = useDataStore((s) => s.raiseTamperAlert);
  const industry = industries.find((i) => i.id === industryId);

  const [today, setToday] = useState("");
  const [water, setWater] = useState<Record<string, MeterState>>(() => emptyMeters(WATER_METERS));
  const [waterRemark, setWaterRemark] = useState("");
  const [energy, setEnergy] = useState<Record<string, MeterState>>(() => emptyMeters(ENERGY_METERS));
  const [energyRemark, setEnergyRemark] = useState("");
  const [sludge, setSludge] = useState<LedgerState>(emptyLedger);
  const [salt, setSalt] = useState<LedgerState>(emptyLedger);
  const [success, setSuccess] = useState<null | { entry: EtpEntry }>(null);

  const prior = useMemo(() => (industryId ? resolveCarryForward(etpEntries, industryId) : undefined), [etpEntries, industryId]);
  const hasPrior = !!(prior && prior.water); // structured prior needed to carry meter finals forward

  // Lock the date to the real current day (post-mount → hydration-safe).
  useEffect(() => {
    const n = new Date();
    setToday(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`);
  }, []);

  // Carry forward Initial readings / opening balances from the most recent entry.
  useEffect(() => {
    if (!prior) return;
    if (prior.water) {
      setWater(Object.fromEntries(WATER_METERS.map((m) => [m.key, { initial: String(prior.water?.[m.key]?.final ?? 0), final: "" }])));
    }
    if (prior.energy) {
      setEnergy(Object.fromEntries(ENERGY_METERS.map((m) => [m.key, { initial: String(prior.energy?.[m.key]?.final ?? 0), final: "" }])));
    }
    setSludge((s) => ({ ...s, opening: prior.sludge?.closing ?? 0 }));
    setSalt((s) => ({ ...s, opening: prior.salt?.closing ?? 0 }));
  }, [prior]);

  const setMeter = (which: "water" | "energy") => (key: string, field: "initial" | "final", value: string) => {
    const upd = (prev: Record<string, MeterState>) => ({ ...prev, [key]: { ...prev[key], [field]: numFilter(value) } });
    if (which === "water") setWater(upd);
    else setEnergy(upd);
  };

  const rowsFor = (keys: readonly { key: string; label: string }[], state: Record<string, MeterState>) =>
    keys.map((m) => {
      const s = meterRowStatus(state[m.key].initial, state[m.key].final);
      return { ...m, ...s, invalid: s.incomplete || s.belowInitial };
    });

  const waterRows = rowsFor(WATER_METERS, water);
  const energyRows = rowsFor(ENERGY_METERS, energy);
  const waterGrandTotal = round1(waterRows.reduce((s, r) => s + r.total, 0));
  const allRows = [...waterRows, ...energyRows];
  const anyMeterInvalid = allRows.some((r) => r.invalid);
  const anyBelowInitial = allRows.some((r) => r.belowInitial);
  const anyIncomplete = allRows.some((r) => r.incomplete);

  const totalOf = (key: string) => waterRows.find((r) => r.key === key)?.total ?? 0;
  const totalWaterIntake = round1(totalOf("freshWaterConsumption") + totalOf("etpReuse") + totalOf("roPermeate"));

  const sludgeClosing = closingBalance(sludge.opening, num(sludge.generation), num(sludge.dispatch));
  const saltClosing = closingBalance(salt.opening, num(salt.generation), num(salt.dispatch));
  const sludgeNeedsManifest = needsManifest(num(sludge.dispatch), sludge.manifestNo, sludge.dateOfDisposal);
  const saltNeedsManifest = needsManifest(num(salt.dispatch), salt.manifestNo, salt.dateOfDisposal);
  const closingNegative = sludgeClosing < 0 || saltClosing < 0;
  const blocked = anyMeterInvalid || sludgeNeedsManifest || saltNeedsManifest || closingNegative;

  // Warning as cumulative dispatch (sludge + salt, one authorised limit) approaches the authorised quantity.
  const projectedDispatch = industryId
    ? round1(
        cumulativeDispatch(etpEntries, industryId, "sludge") +
          cumulativeDispatch(etpEntries, industryId, "salt") +
          num(sludge.dispatch) +
          num(salt.dispatch),
      )
    : 0;
  const warnLevel = authorisedQuantityWarning(projectedDispatch, industry?.authorisedQuantityKg);

  const predicted: AlertType[] = [];
  if (totalWaterIntake === 0) predicted.push("zero-reading");
  if (industry && totalWaterIntake > industry.permittedKLD) predicted.push("capacity-exceeded");
  else if (industry && totalWaterIntake > industry.permittedKLD * 0.85) predicted.push("high-flow");

  const onSubmit = () => {
    if (!industryId || blocked) return;
    const meterInput = (keys: readonly { key: string }[], state: Record<string, MeterState>) =>
      Object.fromEntries(keys.map((m) => [m.key, { initial: num(state[m.key].initial), final: num(state[m.key].final) }]));
    const { entry, alerts } = submitEtpEntry({
      industryId,
      date: today,
      water: meterInput(WATER_METERS, water),
      waterRemark,
      energy: meterInput(ENERGY_METERS, energy),
      energyRemark,
      sludge: { opening: sludge.opening, generation: num(sludge.generation), dateOfDisposal: sludge.dateOfDisposal, dispatch: num(sludge.dispatch), manifestNo: sludge.manifestNo, remark: sludge.remark },
      salt: { opening: salt.opening, generation: num(salt.generation), dateOfDisposal: salt.dateOfDisposal, dispatch: num(salt.dispatch), manifestNo: salt.manifestNo, remark: salt.remark },
    });
    toast.success("Daily entry submitted", {
      description: `Total intake ${formatNumber(entry.totalWaterIntake)} m³ · sent for verification${alerts.length ? ` · ${alerts.length} alert(s)` : ""}.`,
    });
    setSuccess({ entry });

    // Best-effort clock-tamper check against trusted server time.
    if (uid) void verifyClock(uid, industryId);
  };

  // Compares the device clock with trusted Firestore server time; a large gap means
  // the operator may have altered their system date/time, so alert the Monitoring
  // Body with a description. Silent if server time is unavailable.
  const verifyClock = async (userId: string, indId: string) => {
    const clientMs = Date.now();
    const serverMs = await getServerTime(userId);
    if (serverMs == null) return;
    const driftMs = Math.abs(serverMs - clientMs);
    if (driftMs > 5 * 60 * 1000) {
      raiseTamperAlert(indId, new Date(clientMs).toISOString(), new Date(serverMs).toISOString(), Math.round(driftMs / 60000));
      toast.warning("Clock mismatch detected", {
        description: "Your device time differs from server time — the Monitoring Body has been notified.",
      });
    }
  };

  if (!industry) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="text-lg font-semibold text-foreground">No ETP unit linked to this session</p>
        <Link href="/login" className="text-sm font-semibold text-primary hover:underline">Sign in or register your unit</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${industry.name} · ETP Logbook`}
        title="Daily ETP Entry"
        description="One daily sheet: water (10 meters), energy (3 meters) and the ETP sludge / MEE-salt ledgers. Totals are auto-calculated and sent for verification."
      />

      {/* date + carry-forward note */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{today ? formatDate(today) : "…"}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Today · locked</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasPrior
            ? "Initial readings & opening balances carried forward from your last entry."
            : "First entry — enter each meter's current reading as the Initial value."}
        </p>
      </div>

      {/* WATER */}
      <MeterSection
        title="Daily Water Entry (M3)"
        icon={<Droplets className="h-4 w-4" />}
        unit="M3"
        meters={WATER_METERS}
        state={water}
        onChange={setMeter("water")}
        rows={waterRows}
        readonlyInitial={hasPrior}
        remark={waterRemark}
        onRemark={setWaterRemark}
        grandTotal={waterGrandTotal}
      />

      {/* ENERGY */}
      <MeterSection
        title="Daily Electricity / Energy Entry (Kwh)"
        icon={<Zap className="h-4 w-4" />}
        unit="Kwh"
        meters={ENERGY_METERS}
        state={energy}
        onChange={setMeter("energy")}
        rows={energyRows}
        readonlyInitial={hasPrior}
        remark={energyRemark}
        onRemark={setEnergyRemark}
      />

      {/* SLUDGE + SALT */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <SectionTitle icon={<Trash2 className="h-4 w-4" />}>Daily Sludge &amp; MEE-Salt Ledgers (kg)</SectionTitle>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LedgerCard
            title="ETP Sludge"
            noun="Sludge"
            state={sludge}
            setState={setSludge}
            closing={sludgeClosing}
            needsManifest={sludgeNeedsManifest}
            negative={sludgeClosing < 0}
          />
          <LedgerCard
            title="ATFD Salt (MEE Section) / PAN Salt (MEE)"
            noun="Salt"
            state={salt}
            setState={setSalt}
            closing={saltClosing}
            needsManifest={saltNeedsManifest}
            negative={saltClosing < 0}
          />
        </div>
        {warnLevel !== "none" && industry.authorisedQuantityKg ? (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm ${warnLevel === "exceeded" ? "border-red-500/40 bg-red-500/10 text-red-600" : "border-amber-500/40 bg-amber-500/10 text-amber-600"}`}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {warnLevel === "exceeded" ? "Cumulative dispatch has reached/exceeded" : `Cumulative dispatch is approaching (≥${AUTHORISED_QUANTITY_WARNING_PERCENT}% of)`}{" "}
              the authorised quantity ({formatNumber(industry.authorisedQuantityKg)} kg) — {formatNumber(projectedDispatch)} kg dispatched so far. Review before dispatching more.
            </span>
          </div>
        ) : null}
      </div>

      {/* summary + submit */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Calculator className="h-3.5 w-3.5" /> Total Water Intake (auto)
            </p>
            <p className="mt-1 font-mono text-3xl font-bold text-primary">
              {formatNumber(totalWaterIntake)} <span className="text-base font-medium text-muted-foreground">m³</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Fresh Water + ETP Reuse + RO Permeate · Permitted {formatNumber(industry.permittedKLD)} KLD</p>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Alerts on submit</p>
            {predicted.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-600">
                <Check className="h-4 w-4" /> No alerts — clean entry
              </p>
            ) : (
              <div className="space-y-1.5">
                {predicted.map((t) => (
                  <div key={t} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs" style={{ color: ALERT_META[t].color }}>
                    <TriangleAlert className="h-3.5 w-3.5" />
                    <span className="font-medium">{ALERT_META[t].label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {blocked && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Entry blocked.</span>{" "}
              {anyBelowInitial && "A Final reading is less than its Initial reading. "}
              {anyIncomplete && "Enter a Final reading for every meter that has an Initial reading. "}
              {(sludgeNeedsManifest || saltNeedsManifest) && "A dispatch needs a Manifest No. and a Date of disposal. "}
              {closingNegative && "A closing balance is negative. "}
            </span>
          </div>
        )}

        <Button onClick={onSubmit} disabled={blocked || !today} className="mt-4 h-11 w-full gap-2 rounded-xl text-base font-semibold">
          <Send className="h-4 w-4" />
          {blocked ? "Fix the highlighted fields to submit" : "Submit Daily Entry"}
        </Button>

        <AnimatePresence>
          {success && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <Check className="h-5 w-5" />
                <p className="font-semibold">Submitted for verification</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Total Water Intake {formatNumber(success.entry.totalWaterIntake)} m³ recorded. Track it in{" "}
                <Link href="/dashboard" className="font-semibold text-foreground hover:underline">your dashboard</Link>.
              </p>
              <Button variant="outline" onClick={() => window.print()} className="mt-3 h-9 gap-2 rounded-lg">
                <Printer className="h-4 w-4" /> Print regulator sheets (Save as PDF)
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* hidden on screen, shown only when printing */}
      {success && <EtpPrintSheets entry={success.entry} industry={industry} />}
    </div>
  );
}

/* ---------------- meter table ---------------- */
function MeterSection({
  title,
  icon,
  unit,
  meters,
  state,
  onChange,
  rows,
  readonlyInitial,
  remark,
  onRemark,
  grandTotal,
}: {
  title: string;
  icon: React.ReactNode;
  unit: string;
  meters: readonly { key: string; label: string }[];
  state: Record<string, MeterState>;
  onChange: (key: string, field: "initial" | "final", value: string) => void;
  rows: { key: string; total: number; invalid: boolean; incomplete: boolean; belowInitial: boolean }[];
  readonlyInitial: boolean;
  remark: string;
  onRemark: (v: string) => void;
  grandTotal?: number;
}) {
  const rowByKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <SectionTitle icon={icon}>{title}</SectionTitle>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Meter</th>
              <th className="w-28 pb-2 pr-3 font-medium">Initial Reading</th>
              <th className="w-28 pb-2 pr-3 font-medium">Final Reading</th>
              <th className="w-24 pb-2 font-medium">Total ({unit})</th>
            </tr>
          </thead>
          <tbody>
            {meters.map((m, i) => {
              const r = rowByKey[m.key];
              return (
                <tr key={m.key} className="border-t border-border/60 align-middle">
                  <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-3 text-foreground">{m.label}</td>
                  <td className="py-2 pr-3">
                    <input
                      inputMode="decimal"
                      value={state[m.key].initial}
                      onChange={(e) => onChange(m.key, "initial", e.target.value)}
                      readOnly={readonlyInitial}
                      className={`${cellCls}${readonlyInitial ? " bg-muted/40 text-muted-foreground" : ""}`}
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      inputMode="decimal"
                      value={state[m.key].final}
                      onChange={(e) => onChange(m.key, "final", e.target.value)}
                      className={`${cellCls}${r?.invalid ? " border-red-500/70 bg-red-500/5" : ""}`}
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2 font-mono font-semibold text-foreground">{formatNumber(r?.total ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
          {grandTotal != null && (
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={4} className="py-2 pr-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Grand Total
                </td>
                <td className="py-2 font-mono font-bold text-primary">
                  {formatNumber(grandTotal)} <span className="text-xs font-normal text-muted-foreground">{unit}</span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {rows.some((r) => r.belowInitial) && <p className="mt-2 text-xs text-red-500">Final reading cannot be less than Initial reading.</p>}
      {rows.some((r) => r.incomplete) && <p className="mt-1 text-xs text-red-500">Enter a Final reading for every meter that has an Initial reading.</p>}
      <div className="mt-3">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Remark</label>
        <input
          value={remark}
          onChange={(e) => onRemark(e.target.value)}
          className={inputCls}
          placeholder="Shutdown, meter out of order, power failure, maintenance, no production…"
        />
      </div>
    </div>
  );
}

/* ---------------- kg ledger ---------------- */
function LedgerCard({
  title,
  noun,
  state,
  setState,
  closing,
  needsManifest,
  negative,
}: {
  title: string;
  noun: string;
  state: LedgerState;
  setState: React.Dispatch<React.SetStateAction<LedgerState>>;
  closing: number;
  needsManifest: boolean;
  negative: boolean;
}) {
  const set = (field: keyof LedgerState, value: string) => setState((s) => ({ ...s, [field]: value }));
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <h4 className="font-display text-sm font-bold text-foreground">{title}</h4>
      <p className="mt-0.5 text-xs text-muted-foreground">Day-wise stock, in kg. Closing = Opening + Generation − Dispatch.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Opening Balance in kg (carried)">
          <div className={readonlyCls}>{formatNumber(state.opening)} kg</div>
        </Field>
        <Field label={`${noun} Generation in kg`}>
          <input inputMode="decimal" value={state.generation} onChange={(e) => set("generation", kgFilter(e.target.value))} className={inputCls} placeholder="0" />
        </Field>
        <Field label="Date of disposal">
          <input type="date" value={state.dateOfDisposal} onChange={(e) => set("dateOfDisposal", e.target.value)} className={inputCls} />
        </Field>
        <Field label={`${noun} Dispatch / Disposal in kg`}>
          <input inputMode="decimal" value={state.dispatch} onChange={(e) => set("dispatch", kgFilter(e.target.value))} className={inputCls} placeholder="0" />
        </Field>
        <Field label="Manifest No.">
          <input value={state.manifestNo} onChange={(e) => set("manifestNo", e.target.value)} className={inputCls} placeholder="Manifest / transporter no." />
        </Field>
        <Field label="Closing Balance in kg (auto)">
          <div className={`${readonlyCls}${negative ? " border-red-500/70 text-red-600" : ""}`}>{formatNumber(closing)} kg</div>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Remark">
          <input value={state.remark} onChange={(e) => set("remark", e.target.value)} className={inputCls} placeholder="Note (optional)" />
        </Field>
      </div>
      {needsManifest && <p className="mt-2 text-xs text-red-500">Dispatch requires a Manifest No. and a Date of disposal.</p>}
    </div>
  );
}

const cellCls =
  "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50";
const inputCls =
  "h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background";
const readonlyCls = "flex h-10 items-center rounded-xl border border-border bg-muted/40 px-3 text-sm font-medium text-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 border-b border-border pb-2 font-display text-sm font-bold uppercase tracking-wide text-foreground">
      {icon && <span className="text-primary">{icon}</span>}
      {children}
    </h3>
  );
}
