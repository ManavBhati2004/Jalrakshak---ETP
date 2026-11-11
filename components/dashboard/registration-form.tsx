"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import {
  Building2,
  Droplets,
  Check,
  FileText,
  Recycle,
  UserCheck,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  Save,
  Send,
  TriangleAlert,
  History,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { UnsavedChangesDialog } from "@/components/dashboard/unsaved-changes-dialog";
import { useDataStore } from "@/lib/store/data";
import { registerUnitWithLogin } from "@/lib/store/accounts";
import { writeOwnedIndustry } from "@/lib/data/firestore-storage";
import { toCanonicalKg } from "@/lib/data/etp-calc";
import { PASSWORD_RULES } from "@/lib/password-rules";
import { alphaOnly, capFirst, decimalFilter, digitsOnly } from "@/lib/input-filters";
import {
  changedRegistrationKeys,
  emptyRegistrationValues,
  fieldOf,
  hasDraftContent,
  industryToRegistrationValues,
  normalizeRegistrationValues,
  parseRegistrationNumber,
  registrationPatchFromValues,
  validateRegistration,
  draftDataFrom,
  type RegistrationKey,
  type RegistrationValues,
} from "@/lib/data/registration";
import {
  deleteRegistrationDraft,
  loadRegistrationDraft,
  markRegistrationSubmitted,
  registrationDraftExists,
  saveRegistrationDraft,
  saveRegistrationEdit,
} from "@/lib/data/registration-ops";
import { clearRecovery, readRecovery, writeRecovery } from "@/lib/data/registration-recovery";
import { useUnsavedChangesGuard } from "@/lib/hooks/use-unsaved-changes-guard";
import { REGISTRATION_STATUS_LABELS, type RegistrationReview, type RegistrationStatus } from "@/lib/types";
import { cn, formatDate, formatNumber } from "@/lib/utils";

/**
 * The Monitoring Body's registration form - the only way an ETP unit is created - in three modes:
 * - `new`: a fresh registration. Save as Draft at any point; Submit creates the unit and its login.
 * - `draft`: continue a saved draft (any officer's). Drafts never hold the login password.
 * - `edit`: change a registered unit's details. Only changed fields are saved, and the login is
 *   never touched. A rejected registration is resubmitted from here.
 * Mandatory checks apply only to the final submission; a draft is saved as it is.
 */
export type RegistrationFormMode = { kind: "new" } | { kind: "draft"; draftId: string } | { kind: "edit"; industryId: string };

type LoadPhase = "loading" | "ready" | "missing" | "error";

/** How many missing or invalid fields the banner names before "+N more", so a fresh form stays tidy. */
const ISSUES_SHOWN = 8;

export function RegistrationForm({
  mode,
  initial,
  editStatus,
  editReview,
}: {
  mode: RegistrationFormMode;
  /** Edit mode: the unit's values when the form opened. Read once, when the form mounts. */
  initial?: RegistrationValues;
  /** Edit mode: the unit's registration status, once known. */
  editStatus?: RegistrationStatus | null;
  editReview?: RegistrationReview | null;
}) {
  const router = useRouter();
  const registerIndustry = useDataStore((s) => s.registerIndustry);
  const industries = useDataStore((s) => s.industries);
  const editingId = mode.kind === "edit" ? mode.industryId : null;
  const unit = editingId ? industries.find((i) => i.id === editingId) : undefined;

  const { register, reset, getValues, watch, setFocus, formState } = useForm<RegistrationValues>({ defaultValues: initial ?? emptyRegistrationValues() });
  const values = watch();
  const { isDirty, touchedFields } = formState;

  const [showPw, setShowPw] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [showRequired, setShowRequired] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  const [loadPhase, setLoadPhase] = useState<LoadPhase>(mode.kind === "draft" ? "loading" : "ready");
  const [loadError, setLoadError] = useState("");
  const [draftInfo, setDraftInfo] = useState<{ id: string; savedAt: string; by: string } | null>(null);
  const [recoveryHandled, setRecoveryHandled] = useState(false);
  const [allIssues, setAllIssues] = useState(false);
  // The draft this form holds and the revision it was loaded at; read only in effects and handlers.
  const draftRef = useRef<{ id: string; rev: number } | null>(null);

  // ---- edit mode: what the form was opened with (the save refuses if the server moved from it) ----
  const [snapshot, setSnapshot] = useState<RegistrationValues | null>(editingId ? (initial ?? null) : null);
  const phase: LoadPhase = editingId ? (snapshot ? "ready" : "missing") : loadPhase;
  const unitDeleted = !!editingId && !!snapshot && !unit;

  // ---- draft mode: load the draft, unless it is the one this form just saved ----
  const draftId = mode.kind === "draft" ? mode.draftId : null;
  useEffect(() => {
    if (!draftId || draftRef.current?.id === draftId) return;
    let cancelled = false;
    void loadRegistrationDraft(draftId).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setLoadError(r.error);
        setLoadPhase("error");
        return;
      }
      if (!r.draft) {
        setLoadPhase("missing");
        return;
      }
      draftRef.current = { id: r.draft.id, rev: r.draft.rev };
      setDraftInfo({ id: r.draft.id, savedAt: r.draft.updatedAt, by: r.draft.updatedByEmail });
      reset(normalizeRegistrationValues(r.draft.data));
      setLoadPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [draftId, reset]);

  const recoveryKey = editingId ? `edit-${editingId}` : draftInfo ? `draft-${draftInfo.id}` : draftId ? `draft-${draftId}` : "new";

  // ---- checks ----
  const misIdTaken = useCallback(
    (misId: string) => industries.some((i) => i.id !== editingId && (i.misId ?? "").trim() === misId.trim()),
    [industries, editingId],
  );
  const check = validateRegistration(values, { mode: editingId ? "edit" : "new", misIdTaken });
  const changed = snapshot ? changedRegistrationKeys(snapshot, values) : [];
  const resubmit = !!editingId && editStatus === "REJECTED";
  const elsewhere = useMemo(() => {
    if (!snapshot || !unit) return [];
    return changedRegistrationKeys(snapshot, industryToRegistrationValues(unit)).map((k) => fieldOf(k).label);
  }, [snapshot, unit]);

  const touched = (k: RegistrationKey) => !!(touchedFields as Partial<Record<RegistrationKey, boolean>>)[k];
  const fieldError = (k: RegistrationKey): string | undefined => {
    const bad = check.invalid.find((i) => i.key === k);
    if (bad && (showRequired || touched(k))) return bad.message;
    const gap = check.missing.find((i) => i.key === k);
    return gap && showRequired ? gap.message : undefined;
  };

  // ---- recovery copy of unsaved changes (this tab only) ----
  const dataKey = JSON.stringify(draftDataFrom(values));
  useEffect(() => {
    if (phase !== "ready" || !isDirty || done) return;
    const t = setTimeout(() => writeRecovery(recoveryKey, getValues()), 500);
    return () => clearTimeout(t);
  }, [dataKey, isDirty, phase, done, recoveryKey, getValues]);
  const recovery = useMemo(() => {
    if (phase !== "ready" || recoveryHandled) return null;
    const copy = readRecovery(recoveryKey);
    if (!copy) return null;
    const restored = normalizeRegistrationValues(copy.data);
    const loaded = snapshot ?? getValues();
    return JSON.stringify(draftDataFrom(restored)) === JSON.stringify(draftDataFrom(loaded)) ? null : { at: copy.at, values: restored };
  }, [phase, recoveryHandled, recoveryKey, snapshot, getValues]);
  const restoreRecovery = () => {
    if (!recovery) return;
    // Restored as unsaved changes on top of what was loaded, so leaving still asks.
    reset({ ...recovery.values, password: getValues().password }, { keepDefaultValues: true });
    setRecoveryHandled(true);
    toast.success("Unsaved changes restored", { description: "Save them as a draft or submit when ready." });
  };
  const discardRecovery = () => {
    clearRecovery(recoveryKey);
    setRecoveryHandled(true);
  };

  // ---- leaving with unsaved changes ----
  const guard = useUnsavedChangesGuard(isDirty && phase === "ready" && !done && busy !== "submit");

  // ---- actions ----
  const saveDraft = async (): Promise<boolean> => {
    const v = getValues();
    if (!hasDraftContent(v)) {
      toast.error("Nothing to save yet", { description: "Fill in at least one field first." });
      return false;
    }
    setBusy("draft");
    const held = draftRef.current;
    const res = await saveRegistrationDraft({ id: held?.id ?? null, rev: held?.rev ?? 0, values: v });
    setBusy(null);
    if (!res.ok) {
      toast.error("Draft not saved", { description: res.error });
      return false;
    }
    draftRef.current = { id: res.id, rev: res.rev };
    clearRecovery(recoveryKey);
    setDraftInfo({ id: res.id, savedAt: new Date().toISOString(), by: "you" });
    setRecoveryHandled(true);
    reset(v); // what was saved is the new starting point
    toast.success("Draft saved", {
      description: v.password
        ? "Every Monitoring Body officer can continue it from Industries. The login password is never saved in a draft: enter it again before submitting."
        : "Every Monitoring Body officer can continue it from Industries.",
    });
    if (!held) router.replace(`/dashboard/industries/register?draft=${res.id}`, { scroll: false });
    return true;
  };

  const blocked = (): boolean => {
    const c = validateRegistration(getValues(), { mode: editingId ? "edit" : "new", misIdTaken });
    if (c.complete && confirmed) return false;
    setShowRequired(true);
    return true;
  };

  const submitNew = async () => {
    if (blocked()) return;
    const v = getValues();
    setBusy("submit");
    const held = draftRef.current;
    if (held && (await registrationDraftExists(held.id)) === false) {
      setBusy(null);
      toast.error("Registration not submitted", { description: "This draft was already submitted or deleted by another officer." });
      return;
    }
    const patch = registrationPatchFromValues(v);
    // Create the operator's login (secondary app, so the officer stays signed in), then the owned unit.
    const res = await registerUnitWithLogin({
      name: patch.ownerName,
      email: v.email.trim(),
      password: v.password,
      createIndustry: async (ownerUid) => {
        const created = registerIndustry({ ...patch, email: v.email.trim(), cetpId: null, registrationComplete: true });
        // Stamp ownerUid so the operator owns the doc. AWAITED: the rules only let the new profile
        // link to an industry whose ownerUid is that user, so the link must not race this write.
        await writeOwnedIndustry(useDataStore.getState(), created.id, ownerUid);
        return created;
      },
    });
    if (!res.ok) {
      setBusy(null);
      toast.error("Registration failed", { description: res.error });
      return;
    }
    // Best effort: without the record the unit still shows as Submitted.
    await markRegistrationSubmitted(res.created.id);
    let note = "";
    if (held) {
      draftRef.current = null;
      if (!(await deleteRegistrationDraft(held.id))) note = " Its draft could not be removed; delete it from Industries.";
    }
    clearRecovery(recoveryKey);
    reset(emptyRegistrationValues());
    setConfirmed(false);
    setShowRequired(false);
    setDraftInfo(null);
    setDone(res.created);
    setBusy(null);
    toast.success("Registration submitted", { description: `${res.created.name} (${res.created.id}) is awaiting approval. Its login was created.${note}` });
    if (held) router.replace("/dashboard/industries/register", { scroll: false });
  };

  const saveEdit = async () => {
    if (!editingId || !snapshot || blocked()) return;
    const v = getValues();
    const keys = changedRegistrationKeys(snapshot, v);
    setBusy("submit");
    const res = await saveRegistrationEdit(editingId, { values: v, snapshot, changed: keys, resubmit });
    setBusy(null);
    if (!res.ok) {
      toast.error(resubmit ? "Registration not resubmitted" : "Changes not saved", { description: res.error });
      return;
    }
    clearRecovery(recoveryKey);
    setSnapshot(v);
    reset(v);
    toast.success(resubmit ? "Registration resubmitted" : "Changes saved", {
      description: resubmit ? "It is back with the Monitoring Body for approval." : `${keys.length} field${keys.length === 1 ? "" : "s"} updated.`,
    });
    router.push(`/dashboard/industries?focus=${editingId}`);
  };

  // ---- inputs ----
  const filtered = (key: RegistrationKey, transform: (v: string) => string) => {
    const reg = register(key);
    return {
      ...reg,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        e.target.value = transform(e.target.value);
        return reg.onChange(e);
      },
    };
  };
  const text = (key: RegistrationKey, placeholder?: string) => (
    <input {...register(key)} maxLength={fieldOf(key).max} className={inputCls} placeholder={placeholder} />
  );
  const decimal = (key: RegistrationKey, placeholder = "0") => (
    <input {...filtered(key, (v) => decimalFilter(v))} inputMode="decimal" maxLength={fieldOf(key).max} className={inputCls} placeholder={placeholder} />
  );
  const date = (key: RegistrationKey) => <input type="date" {...register(key)} className={inputCls} />;

  // ---- states before the form ----
  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <Check className="h-6 w-6" />
        </div>
        <p className="mt-3 font-display text-lg font-bold text-foreground">Registration submitted</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {done.name} ({done.id}) was registered with its login and is <span className="font-semibold text-foreground">Submitted</span>, awaiting the
          Monitoring Body&apos;s approval on the Industries page.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setDone(null)}>
            Register another
          </Button>
          <Button asChild className="rounded-xl">
            <Link href={`/dashboard/industries?focus=${done.id}`}>Open in Industries</Link>
          </Button>
        </div>
      </div>
    );
  }
  if (phase !== "ready") {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        {phase === "loading" ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {editingId ? "Loading the unit…" : "Loading the draft…"}
          </span>
        ) : phase === "missing" ? (
          <>
            <p className="font-semibold text-slate-800">{editingId ? "That unit does not exist, or it was deleted." : "That draft no longer exists."}</p>
            <p className="mt-1">{editingId ? "" : "It was submitted or deleted, possibly by another officer."}</p>
            <Button asChild variant="outline" className="mt-4 rounded-xl">
              <Link href="/dashboard/industries">Back to Industries</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="font-semibold text-slate-800">The draft could not be loaded.</p>
            <p className="mt-1">{loadError}</p>
          </>
        )}
      </div>
    );
  }

  const perDay = parseRegistrationNumber(values.authorisedPerDayQuantity);
  const perYear = parseRegistrationNumber(values.authorisedPerYearQuantity);
  const kgLine = (q: ReturnType<typeof parseRegistrationNumber>, unitKey: "authorisedPerDayUnit" | "authorisedPerYearUnit", period: string) => {
    if (!q.ok || q.value == null) return null;
    const u = values[unitKey] === "KG" ? "KG" : "MT";
    return `${formatNumber(q.value)} ${u === "MT" ? "MT" : "kg"} per ${period} · stored as ${formatNumber(toCanonicalKg(q.value, u))} kg${u === "MT" ? " (MT × 1000)" : ""}`;
  };
  const pw = values.password ?? "";
  const issues = [...check.missing, ...check.invalid];
  const submitLabel = editingId ? (resubmit ? "Resubmit Registration" : "Save Changes") : "Submit Registration";
  const nothingToSave = !!editingId && !resubmit && changed.length === 0;
  const canSubmit = check.complete && confirmed && !busy && !unitDeleted && !nothingToSave && (!editingId || editStatus != null);

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-5" noValidate>
      {editingId ? (
        <EditContext status={editStatus} review={editReview} email={snapshot?.email ?? ""} deleted={unitDeleted} elsewhere={elsewhere} />
      ) : draftInfo ? (
        <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Save className="h-3.5 w-3.5" /> Draft · last saved {formatDate(draftInfo.savedAt, true)}
          {draftInfo.by && draftInfo.by !== "you" ? ` by ${draftInfo.by}` : ""}. Any Monitoring Body officer can continue it.
        </p>
      ) : null}

      {recovery && !isDirty ? (
        <div className="flex flex-col gap-2 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <History className="mt-0.5 h-4 w-4 shrink-0" /> Unsaved changes from {formatDate(recovery.at, true)} were found for this form.
          </span>
          <span className="flex shrink-0 gap-2">
            <Button type="button" size="sm" className="rounded-lg" onClick={restoreRecovery}>
              Restore them
            </Button>
            <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={discardRecovery}>
              Discard
            </Button>
          </span>
        </div>
      ) : null}

      {/* §3.1 Unit details */}
      <Section icon={<Building2 className="h-4 w-4 text-teal-600" />} title="1 · Unit Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name of unit" error={fieldError("name")}>
            {text("name", "e.g. Pali Road Processors")}
          </Field>
          <Field label="Owner Name" error={fieldError("ownerName")}>
            <input {...filtered("ownerName", (v) => capFirst(alphaOnly(v)))} maxLength={fieldOf("ownerName").max} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Address" error={fieldError("address")}>
            {text("address", "Full address")}
          </Field>
          <Field label="Area / Location" error={fieldError("area")}>
            <input {...filtered("area", alphaOnly)} maxLength={fieldOf("area").max} className={inputCls} placeholder="Industrial area or zone" />
          </Field>
          <Field label="Tehsil" error={fieldError("tehsil")}>
            <input {...filtered("tehsil", (v) => capFirst(alphaOnly(v)))} maxLength={fieldOf("tehsil").max} className={inputCls} placeholder="Tehsil" />
          </Field>
          <Field label="District" error={fieldError("district")}>
            <input {...filtered("district", (v) => capFirst(alphaOnly(v)))} maxLength={fieldOf("district").max} className={inputCls} placeholder="District" />
          </Field>
          <Field label="MIS ID (mandatory, unique)" error={fieldError("misId")}>
            {text("misId", "e.g. 69197")}
          </Field>
          <Field label="Mobile" error={fieldError("mobile")}>
            <input {...filtered("mobile", digitsOnly)} inputMode="numeric" maxLength={10} className={inputCls} placeholder="10-digit mobile number" />
          </Field>
          {editingId ? null : (
            <>
              <Field label="Email (unit login)" error={fieldError("email")}>
                {text("email", "plant@company.in")}
              </Field>
              <div className="sm:col-span-2">
                <Field label="Login Password (set for the unit)" error={fieldError("password")}>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      {...register("password")}
                      maxLength={fieldOf("password").max}
                      className={inputCls + " pr-10"}
                      placeholder="Set an initial password — share it with the unit"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {PASSWORD_RULES.map((r) => (
                      <li key={r.label} className={cn("flex items-center gap-1.5 text-xs", r.ok(pw) ? "text-emerald-600" : "text-slate-400")}>
                        {r.ok(pw) ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}
                        {r.label}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-slate-500">
                    The operator signs in with this email and password, which can be reset later from the unit&apos;s details. A draft never keeps the
                    password.
                  </p>
                </Field>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* §3.2 Consent details */}
      <Section icon={<FileText className="h-4 w-4 text-teal-600" />} title="2 · Consent Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Consent Order No." error={fieldError("consentOrderNo")}>
            {text("consentOrderNo", "e.g. 2021-2022/TCD/7197")}
          </Field>
          <Field label="Consent order date" error={fieldError("consentOrderDate")}>
            {date("consentOrderDate")}
          </Field>
          <Field label="Consent validity — from" error={fieldError("consentValidFrom")}>
            {date("consentValidFrom")}
          </Field>
          <Field label="Consent validity — to" error={fieldError("consentValidTo")}>
            {date("consentValidTo")}
          </Field>
        </div>
      </Section>

      {/* §3.3 Hazardous waste */}
      <Section icon={<Recycle className="h-4 w-4 text-teal-600" />} title="3 · Hazardous Waste Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HWM Authorization No." error={fieldError("hwmAuthNo")}>
            {text("hwmAuthNo", "e.g. RPCB/HWM/2023-2024/TCD/HSW/12")}
          </Field>
          <Field label="Authorization order date" error={fieldError("hwmAuthDate")}>
            {date("hwmAuthDate")}
          </Field>
          <Field label="Authorization validity — from" error={fieldError("hwmValidFrom")}>
            {date("hwmValidFrom")}
          </Field>
          <Field label="Authorization validity — to" error={fieldError("hwmValidTo")}>
            {date("hwmValidTo")}
          </Field>
          <Field label="Authorised Quantity per Day (optional)" error={fieldError("authorisedPerDayQuantity")}>
            <div className="flex gap-2">
              {decimal("authorisedPerDayQuantity", "e.g. 0.05")}
              <select {...register("authorisedPerDayUnit")} aria-label="Unit of the quantity per day" className={inputCls + " w-24 shrink-0"}>
                <option value="MT">MT</option>
                <option value="KG">kg</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-teal-600">{kgLine(perDay, "authorisedPerDayUnit", "day") ?? "Leave blank if the authorisation states no daily quantity."}</p>
          </Field>
          <Field label="Authorised Quantity per Year" error={fieldError("authorisedPerYearQuantity")}>
            <div className="flex gap-2">
              {decimal("authorisedPerYearQuantity", "e.g. 15.42")}
              <select {...register("authorisedPerYearUnit")} aria-label="Unit of the quantity per year" className={inputCls + " w-24 shrink-0"}>
                <option value="MT">MT</option>
                <option value="KG">kg</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-teal-600">{kgLine(perYear, "authorisedPerYearUnit", "year") ?? "Required. Not calculated from the daily quantity."}</p>
          </Field>
          <Field label="TSDF name" error={fieldError("tsdfName")}>
            {text("tsdfName", "TSDF facility name")}
          </Field>
          <Field label="TSDF full address" error={fieldError("tsdfAddress")}>
            {text("tsdfAddress", "Full TSDF address")}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Remarks (optional)" error={fieldError("hwmRemarks")}>
              <textarea
                {...register("hwmRemarks")}
                maxLength={fieldOf("hwmRemarks").max}
                rows={3}
                className={inputCls + " h-auto resize-y py-2"}
                placeholder="Additional information, clarifications or authorisation-related remarks"
              />
              <p className="mt-1 text-right text-[11px] text-slate-400">
                {(values.hwmRemarks ?? "").length}/{fieldOf("hwmRemarks").max}
              </p>
            </Field>
          </div>
        </div>
      </Section>

      {/* §3.4 Signatory */}
      <Section icon={<UserCheck className="h-4 w-4 text-teal-600" />} title="4 · Authorised Signatory">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name of authorised signatory" error={fieldError("signatoryName")}>
            {text("signatoryName", "Signatory name")}
          </Field>
          <Field label="Designation" error={fieldError("signatoryDesignation")}>
            {text("signatoryDesignation", "e.g. Prop. / Manager")}
          </Field>
        </div>
      </Section>

      {/* §3.5 Plant capacity */}
      <Section icon={<Droplets className="h-4 w-4 text-teal-600" />} title="5 · Plant Capacity (all in KLD)">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ETP capacity (KLD)" error={fieldError("etpCapacity")}>
            {decimal("etpCapacity")}
          </Field>
          <Field label="Maximum effluent generation (KLD)" error={fieldError("maxEffluentGeneration")}>
            {decimal("maxEffluentGeneration")}
          </Field>
          <Field label="MEE capacity (KLD)" error={fieldError("meeCapacity")}>
            {decimal("meeCapacity")}
          </Field>
          <Field label="RO Stage I (KLD)" error={fieldError("roStage1")}>
            {decimal("roStage1")}
          </Field>
          <Field label="RO Stage II (KLD)" error={fieldError("roStage2")}>
            {decimal("roStage2")}
          </Field>
          <Field label="RO Stage III (KLD)" error={fieldError("roStage3")}>
            {decimal("roStage3")}
          </Field>
          <Field label="RO Stage IV (KLD)" error={fieldError("roStage4")}>
            {decimal("roStage4")}
          </Field>
        </div>
      </Section>

      {/* Submission */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {!check.complete ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              {check.missing.length
                ? `To submit, complete ${check.missing.length} required field${check.missing.length === 1 ? "" : "s"}${check.invalid.length ? ` and fix ${check.invalid.length}` : ""}.`
                : `To submit, fix ${check.invalid.length} field${check.invalid.length === 1 ? "" : "s"}.`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {issues.slice(0, allIssues ? undefined : ISSUES_SHOWN).map((i) => (
                <button
                  key={`${i.key}:${i.message}`}
                  type="button"
                  onClick={() => {
                    setShowRequired(true);
                    setFocus(i.key);
                  }}
                  title={i.message}
                  className="rounded-full bg-white px-2.5 py-0.5 text-xs ring-1 ring-amber-300 hover:bg-amber-100"
                >
                  {i.label}
                </button>
              ))}
              {issues.length > ISSUES_SHOWN ? (
                <button
                  type="button"
                  onClick={() => setAllIssues((a) => !a)}
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold underline underline-offset-2 hover:bg-amber-100"
                >
                  {allIssues ? "Show fewer" : `+${issues.length - ISSUES_SHOWN} more`}
                </button>
              ) : null}
            </div>
            {!showRequired ? (
              <button type="button" onClick={() => setShowRequired(true)} className="mt-2 text-xs font-semibold underline underline-offset-2">
                Show missing fields
              </button>
            ) : null}
            <p className="mt-2 text-xs">{editingId ? "Changes are saved only once every field is complete." : "You can still Save as Draft and finish later."}</p>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              if (e.target.checked) setShowRequired(true);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-teal-600"
          />
          <span>I confirm that all registration details are complete and verified.</span>
        </label>
        {nothingToSave ? <p className="text-xs text-slate-500">No changes yet.</p> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          {editingId ? (
            <Button asChild variant="outline" size="lg" className="h-12 rounded-xl sm:w-40">
              <Link href={`/dashboard/industries?focus=${editingId}`}>Cancel</Link>
            </Button>
          ) : (
            <Button type="button" variant="outline" size="lg" disabled={!!busy} onClick={() => void saveDraft()} className="h-12 gap-2 rounded-xl sm:w-48">
              <Save className="h-4 w-4" /> {busy === "draft" ? "Saving…" : "Save as Draft"}
            </Button>
          )}
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void (editingId ? saveEdit() : submitNew())}
            size="lg"
            className="h-12 flex-1 gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-base font-semibold text-white hover:from-teal-600/90 hover:to-cyan-600/90"
          >
            {editingId && !resubmit ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {busy === "submit" ? (editingId ? "Saving…" : "Submitting…") : submitLabel}
          </Button>
        </div>
      </div>

      <UnsavedChangesDialog
        open={guard.pending}
        onStay={guard.stay}
        onLeave={() => {
          // Left on purpose: nothing to offer back next time.
          clearRecovery(recoveryKey);
          guard.leave();
        }}
        onSaveAndLeave={editingId ? undefined : saveDraft}
      />
    </form>
  );
}

/** Edit mode: the unit's status and anything that changed under the open form. */
function EditContext({
  status,
  review,
  email,
  deleted,
  elsewhere,
}: {
  status?: RegistrationStatus | null;
  review?: RegistrationReview | null;
  email: string;
  deleted: boolean;
  elsewhere: string[];
}) {
  return (
    <div className="space-y-2">
      {deleted ? (
        <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">This unit was deleted, so these changes can no longer be saved.</p>
      ) : null}
      {elsewhere.length && !deleted ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Changed elsewhere since you opened this form: {elsewhere.join(", ")}. Reload the page to see the current details.
        </p>
      ) : null}
      <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
        <p>
          Registration status:{" "}
          <span className="font-semibold text-slate-800">{status ? REGISTRATION_STATUS_LABELS[status] : "Loading…"}</span>
          {status === "REJECTED" && review?.remark ? <span className="block text-red-700">Rejected: {review.remark}</span> : null}
        </p>
        <p>
          Login email: <span className="font-semibold text-slate-800">{email || "—"}</span>
          <span className="block">The login is not changed here. Reset its password from the unit&apos;s details on Industries.</span>
        </p>
      </div>
    </div>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-400 focus:bg-white";

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-slate-800">
        {icon} {title}
      </h2>
      {children}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
