"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Calculator, Check, Send, Droplets, Zap, Trash2, Lock, TriangleAlert, Ban, Save, FileWarning, Plus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/store/auth";
import { useDataStore } from "@/lib/store/data";
import { getServerTime } from "@/lib/data/server-time";
import {
  meterRowStatus,
  groupGrandTotals,
  closingBalance,
  dispatchNeedsManifest as needsManifest,
  dispatchExceedsStock,
  resolveCarryForward,
  authorisationUsage,
  authorisedQuantityWarning,
  parseDailyValue,
  previousCalendarDay,
  round1,
} from "@/lib/data/etp-calc";
import type { EtpEntry, EntryStatus } from "@/lib/types";
import { WATER_METERS, ENERGY_METERS, WATER_GROUPS, AUTHORISED_QUANTITY_WARNING_PERCENT } from "@/lib/constants";
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
// Numeric standard: ≤7 integer digits + ≤1 decimal, nonnegative (master §4).
const numFilter = (s: string) => {
  let v = s.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
  const [int = "", dec = ""] = v.split(".");
  const capInt = int.slice(0, 7);
  return v.includes(".") ? `${capInt}.${dec.slice(0, 1)}` : capInt;
};

const emptyMeters = (keys: readonly { code: string }[]): Record<string, MeterState> =>
  Object.fromEntries(keys.map((k) => [k.code, { initial: "", final: "" }]));
const emptyLedger = (): LedgerState => ({ opening: 0, generation: "", dateOfDisposal: "", dispatch: "", manifestNo: "", remark: "" });

export default function EtpEntryPage() {
  const industryId = useAuthStore((s) => s.industryId);
  const uid = useAuthStore((s) => s.uid);
  const industries = useDataStore((s) => s.industries);
  const etpEntries = useDataStore((s) => s.etpEntries);
  const submitEtpEntry = useDataStore((s) => s.submitEtpEntry);
  const addCustomColumn = useDataStore((s) => s.addCustomColumn);
  const raiseTamperAlert = useDataStore((s) => s.raiseTamperAlert);
  const industry = industries.find((i) => i.id === industryId);

  const [today, setToday] = useState("");
  const [water, setWater] = useState<Record<string, MeterState>>(() => emptyMeters(WATER_METERS));
  const [waterRemark, setWaterRemark] = useState("");
  const [energy, setEnergy] = useState<Record<string, MeterState>>(() => emptyMeters(ENERGY_METERS));
  const [energyRemark, setEnergyRemark] = useState("");
  // Operator-defined extra columns. Definitions live on this unit's Industry record, so they
  // are tenant-scoped: a column added here can never surface on another unit's sheet.
  const customColumns = useMemo(() => [...(industry?.customColumns ?? [])].sort((a, b) => a.order - b.order), [industry?.customColumns]);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [showAddColumn, setShowAddColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [sludge, setSludge] = useState<LedgerState>(emptyLedger);
  const [salt, setSalt] = useState<LedgerState>(emptyLedger);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [success, setSuccess] = useState<null | { entry: EtpEntry; status: EntryStatus }>(null);

  // Lock the date to the real current day (post-mount → hydration-safe).
  useEffect(() => {
    const n = new Date();
    setToday(`${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`);
  }, []);

  const carry = useMemo(
    () => (industryId && today ? resolveCarryForward(etpEntries, industryId, today) : undefined),
    [etpEntries, industryId, today],
  );
  // Most-recent prior entry (used to seed initials when the immediately-previous day is missing).
  const mostRecentPrior = useMemo(() => {
    if (!industryId || !today) return undefined;
    return etpEntries
      .filter((e) => e.industryId === industryId && e.date < today)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  }, [etpEntries, industryId, today]);

  const priorDay = carry?.priorDay;
  const lockInitials = !!priorDay?.water; // carried from an immediately-previous day → locked
  const carrySource = priorDay ?? mostRecentPrior;

  // Prefill Initial readings / opening balances from the carry source. Prefilled initials go
  // through numFilter so an oversized legacy reading can't seed an out-of-range value. Keyed on
  // the stable carrySource reference (NOT the freshly-rebuilt `carry` object) so a same-day
  // submit does not re-run this and wipe the operator's just-entered finals.
  useEffect(() => {
    if (!industryId || !today) return;
    if (carrySource?.water) {
      setWater(Object.fromEntries(WATER_METERS.map((m) => [m.code, { initial: numFilter(String(carrySource.water?.[m.code]?.final ?? 0)), final: "" }])));
    } else {
      setWater(emptyMeters(WATER_METERS));
    }
    if (carrySource?.energy) {
      setEnergy(Object.fromEntries(ENERGY_METERS.map((m) => [m.code, { initial: numFilter(String(carrySource.energy?.[m.code]?.final ?? 0)), final: "" }])));
    } else {
      setEnergy(emptyMeters(ENERGY_METERS));
    }
    setSludge((s) => ({ ...s, opening: carrySource?.sludge?.closing ?? 0 }));
    setSalt((s) => ({ ...s, opening: carrySource?.salt?.closing ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrySource, industryId, today]);

  const setMeter = (which: "water" | "energy") => (code: string, field: "initial" | "final", value: string) => {
    const upd = (prev: Record<string, MeterState>) => ({ ...prev, [code]: { ...prev[code], [field]: numFilter(value) } });
    if (which === "water") setWater(upd);
    else setEnergy(upd);
  };

  const waterRows = WATER_METERS.map((m) => ({ ...m, ...meterRowStatus(water[m.code].initial, water[m.code].final) }));
  const energyRows = ENERGY_METERS.map((m) => ({ ...m, ...meterRowStatus(energy[m.code].initial, energy[m.code].final) }));
  const allRows = [...waterRows, ...energyRows];

  // Per-group water grand totals (Excel: RO excludes the common permeate meter).
  const waterReadings = Object.fromEntries(waterRows.map((r) => [r.code, { initial: num(water[r.code].initial), final: num(water[r.code].final), total: r.total }]));
  const groupTotals = groupGrandTotals(waterReadings);

  const anyBelowInitial = allRows.some((r) => r.belowInitial);
  const anyIncomplete = allRows.some((r) => r.incomplete);
  const finalsMissing =
    waterRows.some((r) => water[r.code].final.trim() === "") || energyRows.some((r) => energy[r.code].final.trim() === "");

  const sludgeClosing = closingBalance(sludge.opening, num(sludge.generation), num(sludge.dispatch));
  const saltClosing = closingBalance(salt.opening, num(salt.generation), num(salt.dispatch));
  const sludgeNeedsManifest = needsManifest(num(sludge.dispatch), sludge.manifestNo, sludge.dateOfDisposal);
  const saltNeedsManifest = needsManifest(num(salt.dispatch), salt.manifestNo, salt.dateOfDisposal);
  const sludgeOverStock = dispatchExceedsStock(sludge.opening, num(sludge.generation), num(sludge.dispatch));
  const saltOverStock = dispatchExceedsStock(salt.opening, num(salt.generation), num(salt.dispatch));
  const closingNegative = sludgeClosing < 0 || saltClosing < 0;

  // Continuity: a missing immediately-previous day blocks submit unless overridden with a reason.
  const missingPriorDay = !!carry?.missingPriorDay;
  const continuityBlocked = missingPriorDay && !(override && overrideReason.trim().length > 3);

  // Hard numeric-standard gate (≤7 int digits, ≤1 decimal, ≥0, ≤9,999,999.9) — the real
  // validator, applied to entered/prefilled values so garbage can never be persisted.
  const rangeError = (s: string) => s.trim() !== "" && !!parseDailyValue(s).error;
  const anyOutOfRange =
    waterRows.some((r) => rangeError(water[r.code].initial) || rangeError(water[r.code].final)) ||
    energyRows.some((r) => rangeError(energy[r.code].initial) || rangeError(energy[r.code].final)) ||
    rangeError(sludge.generation) || rangeError(sludge.dispatch) || rangeError(salt.generation) || rangeError(salt.dispatch);

  // Today's entry is already submitted → Save Draft would downgrade it; only allow a re-submit.
  const todayEntry = industryId ? etpEntries.find((e) => e.industryId === industryId && e.date === today) : undefined;
  const todaySubmitted = todayEntry?.entryStatus === "SUBMITTED";

  /**
   * Displayed value for a custom column: the operator's in-progress edit if there is one,
   * otherwise today's saved value. A column with nothing stored stays BLANK - never 0 - so
   * entries recorded before the column existed remain valid and are never back-filled.
   */
  const customValue = (id: string) => {
    const edited = custom[id];
    if (edited !== undefined) return edited;
    const saved = todayEntry?.custom?.[id];
    return saved == null ? "" : String(saved);
  };

  const onAddColumn = () => {
    if (!industryId) return;
    const res = addCustomColumn(industryId, newColumnName);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setNewColumnName("");
    setShowAddColumn(false);
    toast.success("Column added", { description: res.column.name });
  };

  // Structural problems block BOTH draft-save and submit; `anyIncomplete`/`finalsMissing`/
  // continuity are submit-only (a draft may be partial).
  const structuralBlocked =
    anyBelowInitial || anyOutOfRange || sludgeNeedsManifest || saltNeedsManifest || sludgeOverStock || saltOverStock || closingNegative;
  const blocked = structuralBlocked || anyIncomplete;
  const submitBlocked = blocked || finalsMissing || continuityBlocked;

  // Authorisation usage for ETP sludge (over the HWM validity window; drafts excluded).
  const priorSludgeDispatch = useMemo(() => {
    if (!industryId) return 0;
    return round1(
      etpEntries
        .filter(
          (e) =>
            e.industryId === industryId &&
            e.date !== today &&
            e.entryStatus !== "DRAFT" &&
            e.status !== "rejected" &&
            (!industry?.hwmValidFrom || e.date >= industry.hwmValidFrom) &&
            (!industry?.hwmValidTo || e.date <= industry.hwmValidTo),
        )
        .reduce((s, e) => s + (e.sludge?.dispatch ?? 0), 0),
    );
  }, [etpEntries, industryId, today, industry?.hwmValidFrom, industry?.hwmValidTo]);
  const projectedSludge = round1(priorSludgeDispatch + num(sludge.dispatch));
  const usage = authorisationUsage(projectedSludge, industry?.authorisedQuantityKg);
  const warnLevel = authorisedQuantityWarning(projectedSludge, industry?.authorisedQuantityKg);

  const buildInput = (status: EntryStatus) => ({
    industryId: industryId as string,
    date: today,
    status,
    water: Object.fromEntries(WATER_METERS.map((m) => [m.code, { initial: num(water[m.code].initial), final: num(water[m.code].final) }])),
    waterRemark,
    energy: Object.fromEntries(ENERGY_METERS.map((m) => [m.code, { initial: num(energy[m.code].initial), final: num(energy[m.code].final) }])),
    energyRemark,
    sludge: { opening: sludge.opening, generation: num(sludge.generation), dateOfDisposal: sludge.dateOfDisposal, dispatch: num(sludge.dispatch), manifestNo: sludge.manifestNo, remark: sludge.remark },
    salt: { opening: salt.opening, generation: num(salt.generation), dateOfDisposal: salt.dateOfDisposal, dispatch: num(salt.dispatch), manifestNo: salt.manifestNo, remark: salt.remark },
    custom: customColumns.length
      ? Object.fromEntries(customColumns.map((c) => [c.id, customValue(c.id).trim() ? num(customValue(c.id)) : null]))
      : undefined,
    overrideReason: missingPriorDay && override ? overrideReason.trim() : undefined,
  });

  const onSaveDraft = () => {
    if (!industryId) return;
    if (todaySubmitted) {
      toast.error("Today's entry is already submitted", { description: "Use Submit to file a correction instead of saving a draft." });
      return;
    }
    if (structuralBlocked) {
      toast.error("Fix the highlighted fields before saving a draft");
      return;
    }
    const { entry } = submitEtpEntry(buildInput("DRAFT"));
    toast.success("Draft saved", { description: "Your partial entry is saved. It is not sent for verification or counted in reports." });
    setSuccess({ entry, status: "DRAFT" });
  };

  const onSubmit = () => {
    if (!industryId || submitBlocked) return;
    const { entry, alerts } = submitEtpEntry(buildInput("SUBMITTED"));
    const totalWater = round1((entry.waterTotals?.daily ?? 0) + (entry.waterTotals?.ro ?? 0) + (entry.waterTotals?.mee ?? 0));
    toast.success("Daily entry submitted", {
      description: `Water total ${formatNumber(totalWater)} m³ · sent for verification${alerts.length ? ` · ${alerts.length} alert(s)` : ""}.`,
    });
    setSuccess({ entry, status: "SUBMITTED" });
    if (uid) void verifyClock(uid, industryId);
  };

  const verifyClock = async (userId: string, indId: string) => {
    const clientMs = Date.now();
    const serverMs = await getServerTime(userId);
    if (serverMs == null) return;
    const driftMs = Math.abs(serverMs - clientMs);
    if (driftMs > 5 * 60 * 1000) {
      raiseTamperAlert(indId, new Date(clientMs).toISOString(), new Date(serverMs).toISOString(), Math.round(driftMs / 60000));
      toast.warning("Clock mismatch detected", { description: "Your device time differs from server time — the Monitoring Body has been notified." });
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
        eyebrow={`${industry.name} · ETP Logbook · MIS ID ${industry.misId ?? "—"}`}
        title="Daily ETP Entry"
        description="One daily sheet: water (12 meters), electricity (3 meters) and the ETP sludge / MEE-salt ledgers. Save a draft anytime; submit for Monitoring-Body verification."
      />

      {/* date + carry-forward status */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-foreground">{today ? formatDate(today) : "…"}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Today · locked</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {lockInitials
            ? "Initial readings & opening balances carried forward from yesterday (locked)."
            : carry?.isFirstEver
              ? "First entry — enter each meter's current reading as the Initial (baseline)."
              : "Yesterday's entry is missing — Initials are prefilled from your last entry; submission needs a continuity override."}
        </p>
      </div>

      {/* continuity block */}
      {missingPriorDay && (
        <div className="rounded-2xl border border-amber-400/60 bg-amber-50 p-4 text-sm text-amber-800">
          <p className="flex items-center gap-2 font-semibold">
            <FileWarning className="h-4 w-4" /> Missing previous day
          </p>
          <p className="mt-1 text-amber-700">
            There is no entry for {today ? formatDate(previousCalendarDay(today)) : "yesterday"}. Create a zero-consumption entry for missed days with a remark, or authorise an override to submit anyway.
          </p>
          <label className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-800">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Authorise continuity override (records a reason)
          </label>
          {override && (
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className={inputCls + " mt-2"}
              placeholder="Reason for the gap (e.g. plant shutdown 3–9 Aug, festival closure)…"
            />
          )}
        </div>
      )}

      {/* WATER — 3 Excel groups */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <SectionTitle icon={<Droplets className="h-4 w-4" />}>Daily Water Entry (M3)</SectionTitle>
        <div className="mt-4 space-y-6">
          {WATER_GROUPS.map((g) => (
            <MeterTable
              key={g.id}
              caption={g.label}
              unit={g.unit}
              meters={WATER_METERS.filter((m) => m.group === g.id)}
              state={water}
              rows={waterRows}
              onChange={setMeter("water")}
              readonlyInitial={lockInitials}
              grandTotal={groupTotals[g.id]}
            />
          ))}
        </div>
        <RemarkField value={waterRemark} onChange={setWaterRemark} />
      </div>

      {/* ENERGY */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <SectionTitle icon={<Zap className="h-4 w-4" />}>Daily Electricity / Energy Entry (Kwh)</SectionTitle>
        <div className="mt-4">
          <MeterTable
            caption="Energy panels"
            unit="Kwh"
            meters={ENERGY_METERS.map((m) => ({ code: m.code, label: m.label }))}
            state={energy}
            rows={energyRows}
            onChange={setMeter("energy")}
            readonlyInitial={lockInitials}
          />
        </div>
        <RemarkField value={energyRemark} onChange={setEnergyRemark} />
      </div>

      {/* SLUDGE + SALT */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <SectionTitle icon={<Trash2 className="h-4 w-4" />}>Daily Sludge &amp; MEE-Salt Ledgers (kg)</SectionTitle>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <LedgerCard title="Daily ETP Sludge Entry" noun="Sludge" state={sludge} setState={setSludge} closing={sludgeClosing} needsManifest={sludgeNeedsManifest} overStock={sludgeOverStock} negative={sludgeClosing < 0} />
          <LedgerCard title="ATFD Salt (MEE Section) / PAN Salt (MEE)" noun="Salt" state={salt} setState={setSalt} closing={saltClosing} needsManifest={saltNeedsManifest} overStock={saltOverStock} negative={saltClosing < 0} authNote="Authorisation quantity not configured for MEE salt." />
        </div>
        {usage.configured ? (
          <div className={`mt-3 rounded-xl border p-3 text-sm ${warnLevel === "exceeded" ? "border-red-500/40 bg-red-500/10 text-red-600" : warnLevel === "approaching" ? "border-amber-500/40 bg-amber-500/10 text-amber-600" : "border-border bg-muted/30 text-muted-foreground"}`}>
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="h-4 w-4" /> ETP Sludge authorisation usage
            </p>
            <p className="mt-1">
              {formatNumber(usage.usedKg)} / {formatNumber(usage.authorisedKg)} kg dispatched ({formatNumber(usage.percent)}%) · {formatNumber(usage.remainingKg)} kg remaining.
              {warnLevel === "exceeded" && " Over the authorised quantity — review before dispatching more."}
              {warnLevel === "approaching" && ` Approaching the ${AUTHORISED_QUANTITY_WARNING_PERCENT}% threshold.`}
            </p>
          </div>
        ) : null}
      </div>

      {/* CUSTOM COLUMNS — operator-defined, appended AFTER every built-in section */}
      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={<Plus className="h-4 w-4" />}>Custom Columns</SectionTitle>
          <Button variant="outline" onClick={() => setShowAddColumn((v) => !v)} className="h-9 gap-1.5 rounded-xl">
            <Plus className="h-4 w-4" /> Add Column
          </Button>
        </div>

        {showAddColumn ? (
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="new-column-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Column Name
              </label>
              <input
                id="new-column-name"
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value.slice(0, 60))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddColumn();
                  }
                }}
                placeholder="e.g. Boiler Blowdown"
                className={inputCls}
              />
            </div>
            <Button onClick={onAddColumn} className="h-10 gap-1.5 rounded-xl">
              <Save className="h-4 w-4" /> Save
            </Button>
          </div>
        ) : null}

        {customColumns.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No custom columns yet. Use <span className="font-medium text-foreground">Add Column</span> to create one for this unit.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="border-b border-border pb-2 pr-3 font-medium">#</th>
                  <th className="border-b border-border pb-2 pr-3 font-medium">Column</th>
                  <th className="border-b border-border pb-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {customColumns.map((c, i) => (
                  <tr key={c.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                    {/* Rendered as text by React — a column name is never treated as HTML. */}
                    <td className="py-2 pr-3 font-medium text-foreground">{c.name}</td>
                    <td className="py-2">
                      <input
                        inputMode="decimal"
                        aria-label={c.name}
                        value={customValue(c.id)}
                        onChange={(e) => setCustom((prev) => ({ ...prev, [c.id]: numFilter(e.target.value) }))}
                        className={inputCls + " max-w-40"}
                        placeholder="—"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* summary + submit */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {WATER_GROUPS.map((g) => (
            <div key={g.id} className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Calculator className="h-3.5 w-3.5" /> {g.id.toUpperCase()} Grand Total
              </p>
              <p className="mt-1 font-mono text-2xl font-bold text-primary">
                {formatNumber(groupTotals[g.id])} <span className="text-sm font-medium text-muted-foreground">m³</span>
              </p>
            </div>
          ))}
        </div>

        {submitBlocked && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600">
            <Ban className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">Submission blocked.</span>{" "}
              {anyBelowInitial && "A Final reading is less than its Initial reading. "}
              {anyIncomplete && "Every meter with an Initial needs a Final. "}
              {finalsMissing && "Enter a Final reading for every meter. "}
              {(sludgeNeedsManifest || saltNeedsManifest) && "A dispatch needs a Manifest No. and a Date of disposal. "}
              {(sludgeOverStock || saltOverStock) && "A dispatch exceeds available stock. "}
              {closingNegative && "A closing balance is negative. "}
              {continuityBlocked && "Yesterday's entry is missing — authorise a continuity override with a reason. "}
              You can still Save Draft.
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onSaveDraft} disabled={!today || todaySubmitted || structuralBlocked} className="h-11 flex-1 gap-2 rounded-xl text-base font-semibold">
            <Save className="h-4 w-4" /> {todaySubmitted ? "Already submitted" : "Save Draft"}
          </Button>
          <Button onClick={onSubmit} disabled={submitBlocked || !today} className="h-11 flex-1 gap-2 rounded-xl text-base font-semibold">
            <Send className="h-4 w-4" /> {submitBlocked ? "Fix the highlighted fields" : "Submit Daily Entry"}
          </Button>
        </div>

        <AnimatePresence>
          {success && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
              <div className="flex items-center gap-2 text-emerald-600">
                <Check className="h-5 w-5" />
                <p className="font-semibold">{success.status === "DRAFT" ? "Draft saved" : "Submitted for verification"}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {success.status === "DRAFT"
                  ? "Your draft is saved for today — finish and submit to send it to the Monitoring Body. "
                  : "Recorded and sent for verification. "}
                Track it in <Link href="/dashboard" className="font-semibold text-foreground hover:underline">your dashboard</Link>.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------- meter table ---------------- */
function MeterTable({
  caption,
  unit,
  meters,
  state,
  rows,
  onChange,
  readonlyInitial,
  grandTotal,
}: {
  caption: string;
  unit: string;
  meters: readonly { code: string; label: string }[];
  state: Record<string, MeterState>;
  rows: { code: string; total: number; incomplete: boolean; belowInitial: boolean }[];
  onChange: (code: string, field: "initial" | "final", value: string) => void;
  readonlyInitial: boolean;
  grandTotal?: number;
}) {
  const rowByCode = Object.fromEntries(rows.map((r) => [r.code, r]));
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{caption}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">#</th>
              <th className="pb-2 pr-3 font-medium">Meter</th>
              <th className="w-32 pb-2 pr-3 font-medium">Initial Reading</th>
              <th className="w-32 pb-2 pr-3 font-medium">Final Reading</th>
              <th className="w-24 pb-2 font-medium">Total ({unit})</th>
            </tr>
          </thead>
          <tbody>
            {meters.map((m, i) => {
              const r = rowByCode[m.code];
              const invalid = r?.incomplete || r?.belowInitial;
              return (
                <tr key={m.code} className="border-t border-border/60 align-middle">
                  <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-3 text-foreground">{m.label}</td>
                  <td className="py-2 pr-3">
                    <input
                      inputMode="decimal"
                      value={state[m.code].initial}
                      onChange={(e) => onChange(m.code, "initial", e.target.value)}
                      readOnly={readonlyInitial}
                      className={`${cellCls}${readonlyInitial ? " bg-muted/40 text-muted-foreground" : ""}`}
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      inputMode="decimal"
                      value={state[m.code].final}
                      onChange={(e) => onChange(m.code, "final", e.target.value)}
                      className={`${cellCls}${invalid ? " border-red-500/70 bg-red-500/5" : ""}`}
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
  overStock,
  negative,
  authNote,
}: {
  title: string;
  noun: string;
  state: LedgerState;
  setState: React.Dispatch<React.SetStateAction<LedgerState>>;
  closing: number;
  needsManifest: boolean;
  overStock: boolean;
  negative: boolean;
  authNote?: string;
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
          <input inputMode="decimal" value={state.generation} onChange={(e) => set("generation", numFilter(e.target.value))} className={inputCls} placeholder="0" />
        </Field>
        <Field label="Date of disposal">
          <input type="date" value={state.dateOfDisposal} onChange={(e) => set("dateOfDisposal", e.target.value)} className={inputCls} />
        </Field>
        <Field label={`${noun} Dispatch / Disposal in kg`}>
          <input inputMode="decimal" value={state.dispatch} onChange={(e) => set("dispatch", numFilter(e.target.value))} className={inputCls} placeholder="0" />
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
      {overStock && <p className="mt-1 text-xs text-red-500">Dispatch cannot exceed Opening + Generation.</p>}
      {authNote && <p className="mt-2 text-xs text-muted-foreground">{authNote}</p>}
    </div>
  );
}

const cellCls =
  "h-9 w-full rounded-lg border border-border bg-background px-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50";
const inputCls =
  "h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background";
const readonlyCls = "flex h-10 items-center rounded-xl border border-border bg-muted/40 px-3 text-sm font-medium text-foreground";

function RemarkField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-3">
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Remark</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder="Shutdown, meter out of order, power failure, maintenance, no production…" />
    </div>
  );
}

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
