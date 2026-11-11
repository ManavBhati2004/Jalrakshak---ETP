/* ============================================================
   Registering an ETP unit (Monitoring Body) - the pure core.

   No Firebase here. The registration form, its drafts, the edit of a registered unit and the
   CSV exports all go through these functions, and so do the unit tests. The form's checks live in
   one place (`validateRegistration`) so the Submit button, the missing-fields banner and the
   inline messages can never disagree.
   ============================================================ */

import { MAX_PASSWORD_LENGTH, PASSWORD_RULES } from "@/lib/password-rules";
import { DAILY_MAX_VALUE } from "@/lib/constants";
import { authorisedQuantities, round2, toCanonicalKg } from "@/lib/data/etp-calc";
import type { IndustrySlice } from "@/lib/data/firestore-storage";
import type { Industry, QuantityUnit, RegistrationReview, RegistrationStatus } from "@/lib/types";

export type RegistrationSection = "unit" | "consent" | "hwm" | "signatory" | "capacity";
type FieldKind = "text" | "alpha" | "date" | "mobile" | "email" | "password" | "quantity" | "unit" | "longtext" | "capacity" | "ro";

interface FieldDef {
  key: string;
  label: string;
  section: RegistrationSection;
  kind: FieldKind;
  /** Must be filled before the registration can be submitted. Drafts never check this. */
  required: boolean;
  /** The longest value accepted (the input's maxLength, and the drafts' rules). */
  max: number;
  /** The shortest non-empty value accepted. */
  min?: number;
}

/** Every field of the registration form, in form order. */
export const REGISTRATION_FIELDS = [
  { key: "name", label: "Name of unit", section: "unit", kind: "text", required: true, max: 200, min: 2 },
  { key: "ownerName", label: "Owner Name", section: "unit", kind: "alpha", required: true, max: 100 },
  { key: "address", label: "Address", section: "unit", kind: "text", required: true, max: 300, min: 4 },
  { key: "area", label: "Area / Location", section: "unit", kind: "alpha", required: true, max: 100 },
  { key: "tehsil", label: "Tehsil", section: "unit", kind: "text", required: true, max: 100, min: 2 },
  { key: "district", label: "District", section: "unit", kind: "text", required: true, max: 100, min: 2 },
  { key: "misId", label: "MIS ID", section: "unit", kind: "text", required: true, max: 50, min: 1 },
  { key: "mobile", label: "Mobile", section: "unit", kind: "mobile", required: true, max: 10 },
  { key: "email", label: "Email (unit login)", section: "unit", kind: "email", required: true, max: 200 },
  { key: "password", label: "Login Password", section: "unit", kind: "password", required: true, max: MAX_PASSWORD_LENGTH },
  { key: "consentOrderNo", label: "Consent Order No.", section: "consent", kind: "text", required: true, max: 100, min: 2 },
  { key: "consentOrderDate", label: "Consent order date", section: "consent", kind: "date", required: true, max: 10 },
  { key: "consentValidFrom", label: "Consent validity — from", section: "consent", kind: "date", required: true, max: 10 },
  { key: "consentValidTo", label: "Consent validity — to", section: "consent", kind: "date", required: true, max: 10 },
  { key: "hwmAuthNo", label: "HWM Authorization No.", section: "hwm", kind: "text", required: true, max: 100, min: 2 },
  { key: "hwmAuthDate", label: "Authorization order date", section: "hwm", kind: "date", required: true, max: 10 },
  { key: "hwmValidFrom", label: "Authorization validity — from", section: "hwm", kind: "date", required: true, max: 10 },
  { key: "hwmValidTo", label: "Authorization validity — to", section: "hwm", kind: "date", required: true, max: 10 },
  { key: "authorisedPerDayQuantity", label: "Authorised quantity per day", section: "hwm", kind: "quantity", required: false, max: 12 },
  { key: "authorisedPerDayUnit", label: "Unit of the quantity per day", section: "hwm", kind: "unit", required: false, max: 2 },
  { key: "authorisedPerYearQuantity", label: "Authorised quantity per year", section: "hwm", kind: "quantity", required: true, max: 12 },
  { key: "authorisedPerYearUnit", label: "Unit of the quantity per year", section: "hwm", kind: "unit", required: false, max: 2 },
  { key: "hwmRemarks", label: "Remarks", section: "hwm", kind: "longtext", required: false, max: 1000 },
  { key: "tsdfName", label: "TSDF name", section: "hwm", kind: "text", required: true, max: 200, min: 2 },
  { key: "tsdfAddress", label: "TSDF full address", section: "hwm", kind: "text", required: true, max: 300, min: 4 },
  { key: "signatoryName", label: "Name of authorised signatory", section: "signatory", kind: "text", required: true, max: 100, min: 2 },
  { key: "signatoryDesignation", label: "Designation", section: "signatory", kind: "text", required: true, max: 100, min: 1 },
  { key: "etpCapacity", label: "ETP capacity (KLD)", section: "capacity", kind: "capacity", required: true, max: 12 },
  { key: "maxEffluentGeneration", label: "Maximum effluent generation (KLD)", section: "capacity", kind: "capacity", required: true, max: 12 },
  { key: "meeCapacity", label: "MEE capacity (KLD)", section: "capacity", kind: "capacity", required: true, max: 12 },
  { key: "roStage1", label: "RO Stage I (KLD)", section: "capacity", kind: "ro", required: false, max: 12 },
  { key: "roStage2", label: "RO Stage II (KLD)", section: "capacity", kind: "ro", required: false, max: 12 },
  { key: "roStage3", label: "RO Stage III (KLD)", section: "capacity", kind: "ro", required: false, max: 12 },
  { key: "roStage4", label: "RO Stage IV (KLD)", section: "capacity", kind: "ro", required: false, max: 12 },
] as const satisfies readonly FieldDef[];

export type RegistrationKey = (typeof REGISTRATION_FIELDS)[number]["key"];
export type RegistrationValues = Record<RegistrationKey, string>;
export type RegistrationMode = "new" | "edit";

const FIELD = new Map<string, FieldDef>(REGISTRATION_FIELDS.map((f) => [f.key, f]));
export const fieldOf = (key: RegistrationKey): FieldDef => FIELD.get(key)!;

const UNIT_KEYS: readonly RegistrationKey[] = ["authorisedPerDayUnit", "authorisedPerYearUnit"];
/** A login is created once, at registration; an edit never touches it. */
const LOGIN_KEYS: readonly RegistrationKey[] = ["email", "password"];

/** What a draft may hold: every form field except the login password. The rules enforce the same list. */
export const REGISTRATION_DRAFT_KEYS: readonly RegistrationKey[] = REGISTRATION_FIELDS.map((f) => f.key).filter((k) => k !== "password");

export function emptyRegistrationValues(): RegistrationValues {
  const v = Object.fromEntries(REGISTRATION_FIELDS.map((f) => [f.key, ""])) as RegistrationValues;
  v.authorisedPerDayUnit = "MT";
  v.authorisedPerYearUnit = "MT";
  return v;
}

/** Every key present, as a string within its length limit: what the form can safely be loaded with. */
export function normalizeRegistrationValues(input: Readonly<Record<string, unknown>> | null | undefined): RegistrationValues {
  const out = emptyRegistrationValues();
  for (const f of REGISTRATION_FIELDS) {
    const raw = input?.[f.key];
    if (typeof raw === "string") out[f.key] = raw.slice(0, f.max);
    else if (typeof raw === "number" && Number.isFinite(raw)) out[f.key] = String(raw).slice(0, f.max);
  }
  for (const k of UNIT_KEYS) if (out[k] !== "MT" && out[k] !== "KG") out[k] = "MT";
  return out;
}

/* ---------------- Numbers ---------------- */

/**
 * A quantity or capacity under the numeric standard: up to 7 digits before the point and 2 after.
 * Blank is `null`; `positive` refuses 0.
 */
export function parseRegistrationNumber(raw: string, positive = true): { ok: true; value: number | null } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(v)) return { ok: false, error: "Enter a number" };
  const [int, dec = ""] = v.split(".");
  if (dec.length > 2) return { ok: false, error: "At most 2 decimal places" };
  const n = Number(v);
  if (int.replace(/^0+(?=\d)/, "").length > 7 || n > DAILY_MAX_VALUE) return { ok: false, error: "Too large" };
  if (positive && n <= 0) return { ok: false, error: "Must be greater than 0" };
  return { ok: true, value: round2(n) };
}

const numberOf = (raw: string): number | null => {
  const r = parseRegistrationNumber(raw, false);
  return r.ok ? r.value : null;
};

/* ---------------- Validation ---------------- */

export interface RegistrationIssue {
  key: RegistrationKey;
  label: string;
  message: string;
}

export interface RegistrationCheck {
  /** Required fields still empty. */
  missing: RegistrationIssue[];
  /** Filled fields whose value is not acceptable (format, range, uniqueness). */
  invalid: RegistrationIssue[];
  /** Nothing missing and nothing invalid: the registration may be submitted. */
  complete: boolean;
}

/** Messages in the order of PASSWORD_RULES. */
const PASSWORD_MESSAGES = ["At least 8 characters", "Add a letter", "Add a number", "Add a special character"];

/**
 * Check a registration. Nothing here blocks a draft: drafts are saved as they are. `misIdTaken`
 * says whether another unit already holds an MIS ID (the caller excludes the unit being edited).
 */
export function validateRegistration(
  values: RegistrationValues,
  ctx: { mode: RegistrationMode; misIdTaken?: (misId: string) => boolean },
): RegistrationCheck {
  const missing: RegistrationIssue[] = [];
  const invalid: RegistrationIssue[] = [];
  const bad = (f: FieldDef, message: string) => invalid.push({ key: f.key as RegistrationKey, label: f.label, message });

  for (const f of REGISTRATION_FIELDS as readonly FieldDef[]) {
    const key = f.key as RegistrationKey;
    if (ctx.mode === "edit" && LOGIN_KEYS.includes(key)) continue;
    const raw = values[key] ?? "";
    const v = f.kind === "password" ? raw : raw.trim();
    if (!v) {
      if (f.required) missing.push({ key, label: f.label, message: `${f.label} is required` });
      continue;
    }
    if (v.length > f.max) {
      bad(f, `At most ${f.max} characters`);
      continue;
    }
    switch (f.kind) {
      case "text":
        if (f.min && v.length < f.min) bad(f, `Enter at least ${f.min} characters`);
        break;
      case "alpha":
        if (!/^[A-Za-z ]{2,}$/.test(v)) bad(f, `${f.label} — alphabets only`);
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) bad(f, "Use a valid date");
        break;
      case "mobile":
        if (!/^\d{10}$/.test(v)) bad(f, "Enter a 10-digit mobile number");
        break;
      case "email":
        if (!/^\S+@\S+\.\S+$/.test(v)) bad(f, "Valid email required");
        break;
      case "password": {
        const failed = PASSWORD_RULES.findIndex((r) => !r.ok(v));
        if (failed !== -1) bad(f, PASSWORD_MESSAGES[failed] ?? PASSWORD_RULES[failed].label);
        break;
      }
      case "quantity":
      case "capacity": {
        const r = parseRegistrationNumber(v, true);
        if (!r.ok) bad(f, r.error);
        break;
      }
      case "ro": {
        const r = parseRegistrationNumber(v, false);
        if (!r.ok) bad(f, r.error);
        break;
      }
      case "unit":
        if (v !== "MT" && v !== "KG") bad(f, "Choose MT or kg");
        break;
      case "longtext":
        break;
    }
  }

  const range = (fromKey: RegistrationKey, toKey: RegistrationKey, message: string) => {
    const from = values[fromKey]?.trim();
    const to = values[toKey]?.trim();
    if (from && to && from > to && !invalid.some((i) => i.key === toKey)) invalid.push({ key: toKey, label: fieldOf(toKey).label, message });
  };
  range("consentValidFrom", "consentValidTo", "Consent validity-to must not be earlier than validity-from");
  range("hwmValidFrom", "hwmValidTo", "Authorization validity-to must not be earlier than validity-from");

  const misId = values.misId?.trim();
  if (misId && ctx.misIdTaken?.(misId) && !invalid.some((i) => i.key === "misId")) {
    invalid.push({ key: "misId", label: fieldOf("misId").label, message: "This MIS ID is already registered" });
  }

  return { missing, invalid, complete: missing.length === 0 && invalid.length === 0 };
}

/* ---------------- What a registration stores ---------------- */

/** The unit fields a registration sets, from its form values. Per-day is left out when blank. */
export type RegistrationPatch = Pick<
  Industry,
  | "name" | "ownerName" | "area" | "address" | "mobile" | "consentNumber" | "permittedKLD" | "etpCapacity" | "roCapacity" | "meeCapacity"
  | "maxEffluentGeneration" | "roStage1" | "roStage2" | "roStage3" | "roStage4" | "misId" | "tehsil" | "district"
  | "consentOrderNo" | "consentOrderDate" | "consentValidFrom" | "consentValidTo" | "hwmAuthNo" | "hwmAuthDate" | "hwmValidFrom" | "hwmValidTo"
  | "authorisedQuantityKg" | "authorisedSourceQuantity" | "authorisedSourceUnit" | "authorisedPerDayQuantity" | "authorisedPerDayUnit" | "authorisedPerDayKg"
  | "hwmRemarks" | "tsdfName" | "tsdfAddress" | "signatoryName" | "signatoryDesignation"
>;

/**
 * Build the unit's fields from a complete registration. The per-year quantity goes to the
 * long-standing authorised-quantity fields (so the sludge warning reads it unchanged); the per-day
 * one to its own fields. Neither is derived from the other.
 */
export function registrationPatchFromValues(values: RegistrationValues): RegistrationPatch {
  const t = (k: RegistrationKey) => (values[k] ?? "").trim();
  const unitOf = (k: RegistrationKey): QuantityUnit => (values[k] === "KG" ? "KG" : "MT");
  const perYear = numberOf(values.authorisedPerYearQuantity);
  const perDay = numberOf(values.authorisedPerDayQuantity);
  const yearUnit = unitOf("authorisedPerYearUnit");
  const dayUnit = unitOf("authorisedPerDayUnit");
  const maxEffluent = numberOf(values.maxEffluentGeneration) ?? 0;
  const ro1 = numberOf(values.roStage1) ?? 0;
  return {
    name: t("name"),
    ownerName: t("ownerName"),
    area: t("area"),
    address: t("address"),
    mobile: t("mobile"),
    tehsil: t("tehsil"),
    district: t("district"),
    misId: t("misId"),
    consentNumber: t("consentOrderNo"),
    consentOrderNo: t("consentOrderNo"),
    consentOrderDate: t("consentOrderDate"),
    consentValidFrom: t("consentValidFrom"),
    consentValidTo: t("consentValidTo"),
    hwmAuthNo: t("hwmAuthNo"),
    hwmAuthDate: t("hwmAuthDate"),
    hwmValidFrom: t("hwmValidFrom"),
    hwmValidTo: t("hwmValidTo"),
    authorisedSourceQuantity: perYear ?? undefined,
    authorisedSourceUnit: perYear != null ? yearUnit : undefined,
    authorisedQuantityKg: perYear != null ? toCanonicalKg(perYear, yearUnit) : undefined,
    authorisedPerDayQuantity: perDay ?? undefined,
    authorisedPerDayUnit: perDay != null ? dayUnit : undefined,
    authorisedPerDayKg: perDay != null ? toCanonicalKg(perDay, dayUnit) : undefined,
    hwmRemarks: t("hwmRemarks") || undefined,
    tsdfName: t("tsdfName"),
    tsdfAddress: t("tsdfAddress"),
    signatoryName: t("signatoryName"),
    signatoryDesignation: t("signatoryDesignation"),
    etpCapacity: numberOf(values.etpCapacity) ?? 0,
    maxEffluentGeneration: maxEffluent,
    permittedKLD: maxEffluent,
    meeCapacity: numberOf(values.meeCapacity) ?? 0,
    roStage1: ro1,
    roCapacity: ro1,
    roStage2: numberOf(values.roStage2) ?? 0,
    roStage3: numberOf(values.roStage3) ?? 0,
    roStage4: numberOf(values.roStage4) ?? 0,
  };
}

/** A registered unit as form values, for editing it. A unit from before the split shows its one quantity as per-year. */
export function industryToRegistrationValues(ind: Industry): RegistrationValues {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const q = authorisedQuantities(ind);
  return normalizeRegistrationValues({
    name: s(ind.name),
    ownerName: s(ind.ownerName),
    address: s(ind.address),
    area: s(ind.area),
    tehsil: s(ind.tehsil),
    district: s(ind.district),
    misId: s(ind.misId),
    // Older units hold it as "+91 90244 88110"; the form works in the 10 digits.
    mobile: s(ind.mobile).replace(/\D/g, "").slice(-10),
    email: s(ind.email),
    password: "",
    consentOrderNo: s(ind.consentOrderNo ?? ind.consentNumber),
    consentOrderDate: s(ind.consentOrderDate),
    consentValidFrom: s(ind.consentValidFrom),
    consentValidTo: s(ind.consentValidTo),
    hwmAuthNo: s(ind.hwmAuthNo),
    hwmAuthDate: s(ind.hwmAuthDate),
    hwmValidFrom: s(ind.hwmValidFrom),
    hwmValidTo: s(ind.hwmValidTo),
    authorisedPerDayQuantity: q.perDay ? String(q.perDay.quantity) : "",
    authorisedPerDayUnit: q.perDay?.unit ?? "MT",
    authorisedPerYearQuantity: q.perYear ? String(q.perYear.quantity) : "",
    authorisedPerYearUnit: q.perYear?.unit ?? "MT",
    hwmRemarks: s(ind.hwmRemarks),
    tsdfName: s(ind.tsdfName),
    tsdfAddress: s(ind.tsdfAddress),
    signatoryName: s(ind.signatoryName),
    signatoryDesignation: s(ind.signatoryDesignation),
    etpCapacity: s(ind.etpCapacity),
    maxEffluentGeneration: s(ind.maxEffluentGeneration ?? ind.permittedKLD),
    meeCapacity: s(ind.meeCapacity),
    roStage1: s(ind.roStage1 ?? ind.roCapacity),
    roStage2: s(ind.roStage2),
    roStage3: s(ind.roStage3),
    roStage4: s(ind.roStage4),
  });
}

/* ---------------- Editing a registered unit ---------------- */

/** Which unit fields each form field sets (a quantity and its unit set the same three). */
const STORED_FIELDS: Record<RegistrationKey, readonly (keyof Industry)[]> = {
  name: ["name"],
  ownerName: ["ownerName"],
  address: ["address"],
  area: ["area"],
  tehsil: ["tehsil"],
  district: ["district"],
  misId: ["misId"],
  mobile: ["mobile"],
  email: [],
  password: [],
  consentOrderNo: ["consentOrderNo", "consentNumber"],
  consentOrderDate: ["consentOrderDate"],
  consentValidFrom: ["consentValidFrom"],
  consentValidTo: ["consentValidTo"],
  hwmAuthNo: ["hwmAuthNo"],
  hwmAuthDate: ["hwmAuthDate"],
  hwmValidFrom: ["hwmValidFrom"],
  hwmValidTo: ["hwmValidTo"],
  authorisedPerDayQuantity: ["authorisedPerDayQuantity", "authorisedPerDayUnit", "authorisedPerDayKg"],
  authorisedPerDayUnit: ["authorisedPerDayQuantity", "authorisedPerDayUnit", "authorisedPerDayKg"],
  authorisedPerYearQuantity: ["authorisedSourceQuantity", "authorisedSourceUnit", "authorisedQuantityKg"],
  authorisedPerYearUnit: ["authorisedSourceQuantity", "authorisedSourceUnit", "authorisedQuantityKg"],
  hwmRemarks: ["hwmRemarks"],
  tsdfName: ["tsdfName"],
  tsdfAddress: ["tsdfAddress"],
  signatoryName: ["signatoryName"],
  signatoryDesignation: ["signatoryDesignation"],
  etpCapacity: ["etpCapacity"],
  maxEffluentGeneration: ["maxEffluentGeneration", "permittedKLD"],
  meeCapacity: ["meeCapacity"],
  roStage1: ["roStage1", "roCapacity"],
  roStage2: ["roStage2"],
  roStage3: ["roStage3"],
  roStage4: ["roStage4"],
};

const same = (a: string | undefined, b: string | undefined) => (a ?? "").trim() === (b ?? "").trim();

/** The form fields that differ from what the form was opened with (never the login). */
export function changedRegistrationKeys(base: RegistrationValues, current: RegistrationValues): RegistrationKey[] {
  return REGISTRATION_FIELDS.map((f) => f.key as RegistrationKey).filter((k) => !LOGIN_KEYS.includes(k) && !same(base[k], current[k]));
}

/**
 * Apply an edit to a unit's slice - the server's copy, read inside the saving transaction. Only the
 * fields the officer changed are written. If any of them was changed elsewhere since the form was
 * opened (the unit edits its own contact details on its profile), the edit is refused rather than
 * overwriting that change unseen.
 *
 * A rename updates the compliance record's name too. Past daily entries keep the name they were
 * filed under: rewriting them would invalidate open approvals and Logbook checks.
 */
export function applyRegistrationEdit(
  slice: IndustrySlice,
  edit: { values: RegistrationValues; snapshot: RegistrationValues; changed: readonly RegistrationKey[] },
): { ok: true; slice: IndustrySlice } | { ok: false; error: string } {
  const ind = slice.industry;
  if (!ind) return { ok: false, error: "That unit no longer exists." };
  const server = industryToRegistrationValues(ind);
  const moved = edit.changed.filter((k) => !same(server[k], edit.snapshot[k]));
  if (moved.length) {
    const labels = [...new Set(moved.map((k) => fieldOf(k).label))].join(", ");
    return { ok: false, error: `Changed elsewhere since you opened this form: ${labels}. Reload the page to see the current details, then make your change again.` };
  }
  const patch = registrationPatchFromValues(edit.values) as Partial<Record<keyof Industry, unknown>>;
  const next = { ...ind } as Record<string, unknown>;
  for (const k of edit.changed) {
    for (const f of STORED_FIELDS[k]) {
      const v = patch[f];
      if (v === undefined) delete next[f];
      else next[f] = v;
    }
  }
  const industry = next as unknown as Industry;
  const compliance = edit.changed.includes("name") && slice.compliance ? { ...slice.compliance, industryName: industry.name } : slice.compliance;
  return { ok: true, slice: { ...slice, industry, compliance } };
}

/* ---------------- Drafts ---------------- */

/** A draft's stored values: what was filled in, never the password, each within its limit. */
export function draftDataFrom(values: RegistrationValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of REGISTRATION_DRAFT_KEYS) {
    const v = values[k] ?? "";
    if (v.trim()) out[k] = v.slice(0, fieldOf(k).max);
  }
  return out;
}

/** Whether anything worth saving has been typed. The unit dropdowns always hold a value, so they don't count. */
export function hasDraftContent(values: RegistrationValues): boolean {
  return REGISTRATION_DRAFT_KEYS.some((k) => !UNIT_KEYS.includes(k) && (values[k] ?? "").trim() !== "");
}

/** The name a draft is listed under. */
export function draftTitle(values: Pick<RegistrationValues, "name">): string {
  return (values.name ?? "").trim().slice(0, 200) || "Untitled registration";
}

/** How many of the form's fields a draft has filled, for the drafts list. */
export function draftProgress(data: Readonly<Record<string, string>>): { filled: number; total: number } {
  const counted = REGISTRATION_DRAFT_KEYS.filter((k) => !UNIT_KEYS.includes(k));
  return { filled: counted.filter((k) => (data[k] ?? "").trim() !== "").length, total: counted.length };
}

/* ---------------- Status ---------------- */

/**
 * A registered unit's status. The Monitoring Body's review record decides it; a unit with none yet
 * (registered before reviews existed) counts as Submitted while pending, Approved otherwise.
 */
export function registrationStatusOf(ind: Pick<Industry, "status">, review: RegistrationReview | null | undefined): RegistrationStatus {
  if (review) return review.status;
  return ind.status === "pending" ? "SUBMITTED" : "APPROVED";
}

/** The status changes the rules allow. `from` is the review record's status, or null when there is none. */
export function canMoveRegistration(from: RegistrationStatus | null, to: RegistrationStatus): boolean {
  if (from === null) return true;
  return (from === "SUBMITTED" && (to === "APPROVED" || to === "REJECTED")) || (from === "REJECTED" && to === "SUBMITTED");
}

/** Approving makes a pending unit active, so the existing counts and filters see it. Anything else stays. */
export function approveInSlice(slice: IndustrySlice): IndustrySlice | null {
  if (!slice.industry || slice.industry.status !== "pending") return null;
  return { ...slice, industry: { ...slice.industry, status: "active" } };
}

/* ---------------- CSV ---------------- */

/** The industry CSV columns - fixed, so a unit lacking a field never drops that column for every unit. */
export const INDUSTRY_CSV_COLUMNS = [
  "id", "name", "ownerName", "area", "address", "contactPerson", "mobile", "email", "consentNumber", "permittedKLD", "status",
  "cetpId", "isIndividualETP", "complianceScore", "etpCapacity", "roCapacity", "meeCapacity", "maxEffluentGeneration",
  "roStage1", "roStage2", "roStage3", "roStage4", "misId", "tehsil", "district", "consentOrderNo", "consentOrderDate",
  "consentValidFrom", "consentValidTo", "hwmAuthNo", "hwmAuthDate", "hwmValidFrom", "hwmValidTo",
  "authorisedQuantityKg", "authorisedSourceQuantity", "authorisedSourceUnit",
  "authorisedPerDayQuantity", "authorisedPerDayUnit", "authorisedPerDayKg", "hwmRemarks",
  "tsdfName", "tsdfAddress", "signatoryName", "signatoryDesignation", "registrationCompletedAt", "customColumns",
  "lastReadingAt", "alertsCount", "registeredAt",
] as const satisfies readonly (keyof Industry)[];

export function industryCsvRow(ind: Industry): Record<string, string | number | boolean> {
  const row: Record<string, string | number | boolean> = {};
  for (const c of INDUSTRY_CSV_COLUMNS) {
    if (c === "customColumns") {
      row[c] = (ind.customColumns ?? []).map((col) => col.name).join("; ");
      continue;
    }
    const v = ind[c];
    row[c] = v == null ? "" : typeof v === "object" ? "" : (v as string | number | boolean);
  }
  return row;
}
