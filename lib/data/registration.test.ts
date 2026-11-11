import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REGISTRATION_FIELDS,
  REGISTRATION_DRAFT_KEYS,
  INDUSTRY_CSV_COLUMNS,
  emptyRegistrationValues,
  normalizeRegistrationValues,
  validateRegistration,
  parseRegistrationNumber,
  registrationPatchFromValues,
  industryToRegistrationValues,
  changedRegistrationKeys,
  applyRegistrationEdit,
  draftDataFrom,
  hasDraftContent,
  draftTitle,
  draftProgress,
  registrationStatusOf,
  canMoveRegistration,
  approveInSlice,
  industryCsvRow,
  fieldOf,
  type RegistrationValues,
} from "@/lib/data/registration";
import type { IndustrySlice } from "@/lib/data/firestore-storage";
import type { Industry, RegistrationReview } from "@/lib/types";

const complete = (over: Partial<RegistrationValues> = {}): RegistrationValues => ({
  ...emptyRegistrationValues(),
  name: "Pali Road Processors",
  ownerName: "Test Owner",
  address: "Plot 1, Test Industrial Area",
  area: "Test Area",
  tehsil: "Balotra",
  district: "Balotra",
  misId: "69197",
  mobile: "9876543210",
  email: "unit@test.local",
  password: "Sample#Pass1",
  consentOrderNo: "2026/TEST/1",
  consentOrderDate: "2026-01-01",
  consentValidFrom: "2026-01-01",
  consentValidTo: "2030-12-31",
  hwmAuthNo: "RPCB/HWM/TEST/1",
  hwmAuthDate: "2026-01-01",
  hwmValidFrom: "2026-01-01",
  hwmValidTo: "2030-12-31",
  authorisedPerYearQuantity: "15.42",
  authorisedPerYearUnit: "MT",
  tsdfName: "Test TSDF",
  tsdfAddress: "TSDF Road, Test",
  signatoryName: "Test Signatory",
  signatoryDesignation: "Manager",
  etpCapacity: "500",
  maxEffluentGeneration: "450",
  meeCapacity: "100",
  ...over,
});

const NEW = { mode: "new" as const };
const keysOf = (issues: { key: string }[]) => issues.map((i) => i.key);

/** A unit as registered before the per-day / per-year split (seed-like). */
const legacyUnit = (over: Partial<Industry> = {}): Industry => ({
  id: "IND-019",
  name: "Pali Road Processors",
  ownerName: "Ravi Kumar",
  area: "Balotra",
  address: "Plot 7, Balotra Industrial Area",
  contactPerson: "Suresh",
  mobile: "+91 90244 88110",
  email: "unit@test.local",
  consentNumber: "2021-2022/TCD/7197",
  permittedKLD: 450,
  status: "active",
  cetpId: null,
  isIndividualETP: true,
  complianceScore: 82,
  etpCapacity: 500,
  roCapacity: 300,
  meeCapacity: 100,
  maxEffluentGeneration: 450,
  roStage1: 300,
  roStage2: 200,
  roStage3: 0,
  roStage4: 0,
  misId: "69197",
  tehsil: "Balotra",
  district: "Balotra",
  consentOrderNo: "2021-2022/TCD/7197",
  consentOrderDate: "2022-07-01",
  consentValidFrom: "2022-07-01",
  consentValidTo: "2027-06-30",
  hwmAuthNo: "RPCB/HWM/2023-2024/TCD/HSW/12",
  hwmAuthDate: "2022-07-01",
  hwmValidFrom: "2022-07-01",
  hwmValidTo: "2027-06-30",
  authorisedQuantityKg: 15420,
  authorisedSourceQuantity: 15.42,
  authorisedSourceUnit: "MT",
  tsdfName: "Balotra TSDF",
  tsdfAddress: "Ramky, Balotra",
  signatoryName: "Ravi Kumar",
  signatoryDesignation: "Proprietor",
  customColumns: [{ id: "CC-1", name: "Softener", unit: "KL" } as never],
  lastReadingAt: null,
  alertsCount: 0,
  registeredAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const sliceOf = (industry: Industry | null): IndustrySlice => ({
  industry,
  readings: [],
  etpEntries: [],
  approvals: [],
  alerts: [],
  compliance: industry
    ? ({ industryId: industry.id, industryName: industry.name, cetpId: null, score: 82, status: "compliant", submissionRate: 0, alertCount: 0, trend: [] } as never)
    : null,
});

describe("validateRegistration — mandatory only at final submission", () => {
  it("a complete registration passes, with no per-day quantity", () => {
    const c = validateRegistration(complete(), NEW);
    expect(c.missing).toEqual([]);
    expect(c.invalid).toEqual([]);
    expect(c.complete).toBe(true);
  });

  it("an empty required field is 'required', never read as 0", () => {
    const c = validateRegistration(complete({ etpCapacity: "", name: "" }), NEW);
    expect(keysOf(c.missing)).toEqual(expect.arrayContaining(["etpCapacity", "name"]));
    expect(keysOf(c.invalid)).not.toContain("etpCapacity");
    expect(c.complete).toBe(false);
  });

  it("per year is required, per day is optional", () => {
    expect(keysOf(validateRegistration(complete({ authorisedPerYearQuantity: "" }), NEW).missing)).toContain("authorisedPerYearQuantity");
    expect(validateRegistration(complete({ authorisedPerDayQuantity: "" }), NEW).complete).toBe(true);
    expect(validateRegistration(complete({ authorisedPerDayQuantity: "0.05", authorisedPerDayUnit: "KG" }), NEW).complete).toBe(true);
  });

  it("quantities follow the numeric standard", () => {
    const msg = (v: string) => validateRegistration(complete({ authorisedPerDayQuantity: v }), NEW).invalid.find((i) => i.key === "authorisedPerDayQuantity")?.message;
    expect(msg("1.234")).toBe("At most 2 decimal places");
    expect(msg("0")).toBe("Must be greater than 0");
    expect(msg("12345678")).toBe("Too large");
    expect(msg("1.2.3")).toBe("Enter a number");
    expect(msg("9999999.99")).toBeUndefined();
  });

  it("RO stages may be left empty; capacities must be above 0", () => {
    expect(validateRegistration(complete({ roStage1: "", roStage4: "" }), NEW).complete).toBe(true);
    expect(validateRegistration(complete({ meeCapacity: "0" }), NEW).invalid.find((i) => i.key === "meeCapacity")?.message).toBe("Must be greater than 0");
  });

  it("checks formats: mobile, email, alphabets-only names, dates and the password rules", () => {
    const c = validateRegistration(complete({ mobile: "98765", email: "nope", ownerName: "R. Kumar", password: "short" }), NEW);
    const m = Object.fromEntries(c.invalid.map((i) => [i.key, i.message]));
    expect(m.mobile).toBe("Enter a 10-digit mobile number");
    expect(m.email).toBe("Valid email required");
    expect(m.ownerName).toBe("Owner Name — alphabets only");
    expect(m.password).toBe("At least 8 characters");
    expect(validateRegistration(complete({ password: "SamplePass1" }), NEW).invalid.find((i) => i.key === "password")?.message).toBe("Add a special character");
  });

  it("validity-to may not be earlier than validity-from", () => {
    const c = validateRegistration(complete({ consentValidTo: "2025-12-31", hwmValidTo: "2025-01-01" }), NEW);
    expect(c.invalid.map((i) => i.message)).toEqual(
      expect.arrayContaining(["Consent validity-to must not be earlier than validity-from", "Authorization validity-to must not be earlier than validity-from"]),
    );
  });

  it("an MIS ID already registered is refused; the caller excludes the unit being edited", () => {
    const taken = (m: string) => m === "69197";
    expect(validateRegistration(complete(), { mode: "new", misIdTaken: taken }).invalid.find((i) => i.key === "misId")?.message).toBe("This MIS ID is already registered");
    expect(validateRegistration(complete(), { mode: "new", misIdTaken: () => false }).complete).toBe(true);
  });

  it("an edit never asks for the login: email and password are not checked", () => {
    const c = validateRegistration(complete({ email: "", password: "" }), { mode: "edit" });
    expect(c.complete).toBe(true);
    expect(keysOf(validateRegistration(complete({ email: "", password: "" }), NEW).missing)).toEqual(["email", "password"]);
  });

  it("parseRegistrationNumber: blank is null, values are rounded to 2 decimals", () => {
    expect(parseRegistrationNumber("")).toEqual({ ok: true, value: null });
    expect(parseRegistrationNumber(" 15.40 ")).toEqual({ ok: true, value: 15.4 });
    expect(parseRegistrationNumber("0", false)).toEqual({ ok: true, value: 0 });
  });
});

describe("registrationPatchFromValues — what a registration stores", () => {
  it("per year goes to the long-standing authorised-quantity fields (the warning reads them)", () => {
    const p = registrationPatchFromValues(complete());
    expect(p.authorisedSourceQuantity).toBe(15.42);
    expect(p.authorisedSourceUnit).toBe("MT");
    expect(p.authorisedQuantityKg).toBe(15420);
  });

  it("per day is stored separately, in its own unit, and never derived", () => {
    const p = registrationPatchFromValues(complete({ authorisedPerDayQuantity: "50", authorisedPerDayUnit: "KG" }));
    expect(p.authorisedPerDayQuantity).toBe(50);
    expect(p.authorisedPerDayUnit).toBe("KG");
    expect(p.authorisedPerDayKg).toBe(50);
    expect(p.authorisedQuantityKg).toBe(15420);
    const none = registrationPatchFromValues(complete());
    expect(none.authorisedPerDayQuantity).toBeUndefined();
    expect(none.authorisedPerDayKg).toBeUndefined();
    // and per year is never computed from per day
    expect(registrationPatchFromValues(complete({ authorisedPerYearQuantity: "", authorisedPerDayQuantity: "1" })).authorisedQuantityKg).toBeUndefined();
  });

  it("keeps remarks, and sets the derived fields the rest of the app reads", () => {
    const p = registrationPatchFromValues(complete({ hwmRemarks: "  Renewal applied for 2027.  ", roStage1: "", maxEffluentGeneration: "450" }));
    expect(p.hwmRemarks).toBe("Renewal applied for 2027.");
    expect(p.consentNumber).toBe("2026/TEST/1");
    expect(p.permittedKLD).toBe(450);
    expect(p.roStage1).toBe(0);
    expect(p.roCapacity).toBe(0);
    expect(registrationPatchFromValues(complete()).hwmRemarks).toBeUndefined();
  });
});

describe("drafts", () => {
  it("never hold the login password", () => {
    expect(REGISTRATION_DRAFT_KEYS).not.toContain("password");
    expect(draftDataFrom(complete())).not.toHaveProperty("password");
  });

  it("hold only what was filled in, within each field's limit", () => {
    const d = draftDataFrom({ ...emptyRegistrationValues(), name: "Unit", hwmRemarks: "x".repeat(1500) });
    expect(Object.keys(d).sort()).toEqual(["authorisedPerDayUnit", "authorisedPerYearUnit", "hwmRemarks", "name"]);
    expect(d.hwmRemarks.length).toBe(1000);
  });

  it("the unit dropdowns alone are not worth saving", () => {
    expect(hasDraftContent(emptyRegistrationValues())).toBe(false);
    expect(hasDraftContent({ ...emptyRegistrationValues(), authorisedPerYearUnit: "KG" })).toBe(false);
    expect(hasDraftContent({ ...emptyRegistrationValues(), misId: "1" })).toBe(true);
    expect(hasDraftContent({ ...emptyRegistrationValues(), password: "Sample#Pass1" })).toBe(false);
  });

  it("load safely: unknown keys dropped, values capped, a bad unit back to MT", () => {
    const v = normalizeRegistrationValues({ name: "x".repeat(300), password: "leaked", junk: "y", authorisedPerDayUnit: "TONS", etpCapacity: 500 });
    expect(v.name.length).toBe(200);
    expect(v).not.toHaveProperty("junk");
    expect(v.authorisedPerDayUnit).toBe("MT");
    expect(v.etpCapacity).toBe("500");
    expect(Object.keys(v).length).toBe(REGISTRATION_FIELDS.length);
  });

  it("are listed by name and progress", () => {
    expect(draftTitle({ name: "  " })).toBe("Untitled registration");
    expect(draftTitle({ name: "Pali Road" })).toBe("Pali Road");
    const p = draftProgress(draftDataFrom(complete()));
    expect(p.total).toBe(REGISTRATION_DRAFT_KEYS.length - 2);
    expect(p.filled).toBe(p.total - 6); // per day, remarks and RO I-IV left empty
  });
});

describe("editing a registered unit", () => {
  it("a unit from before the split opens with its one quantity as per year", () => {
    const v = industryToRegistrationValues(legacyUnit());
    expect(v.authorisedPerYearQuantity).toBe("15.42");
    expect(v.authorisedPerYearUnit).toBe("MT");
    expect(v.authorisedPerDayQuantity).toBe("");
    expect(v.mobile).toBe("9024488110");
    expect(v.password).toBe("");
    const kgOnly = industryToRegistrationValues(legacyUnit({ authorisedSourceQuantity: undefined, authorisedSourceUnit: undefined }));
    expect([kgOnly.authorisedPerYearQuantity, kgOnly.authorisedPerYearUnit]).toEqual(["15420", "KG"]);
  });

  it("only real changes count, never the login", () => {
    const base = industryToRegistrationValues(legacyUnit());
    expect(changedRegistrationKeys(base, { ...base, name: `${base.name}  `, password: "x", email: "other@x" })).toEqual([]);
    expect(changedRegistrationKeys(base, { ...base, hwmRemarks: "New", authorisedPerDayQuantity: "0.05" })).toEqual(["authorisedPerDayQuantity", "hwmRemarks"]);
  });

  it("saves only the changed fields and leaves everything else as it is", () => {
    const unit = legacyUnit();
    const snapshot = industryToRegistrationValues(unit);
    const values = { ...snapshot, authorisedPerDayQuantity: "50", authorisedPerDayUnit: "KG" as const, hwmRemarks: "Daily limit added" };
    const r = applyRegistrationEdit(sliceOf(unit), { values, snapshot, changed: changedRegistrationKeys(snapshot, values) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = r.slice.industry!;
    expect([next.authorisedPerDayQuantity, next.authorisedPerDayUnit, next.authorisedPerDayKg, next.hwmRemarks]).toEqual([50, "KG", 50, "Daily limit added"]);
    // untouched: per year, the mobile as stored, the contact person, status, custom columns
    expect([next.authorisedQuantityKg, next.mobile, next.contactPerson, next.status]).toEqual([15420, "+91 90244 88110", "Suresh", "active"]);
    expect(next.customColumns).toEqual(unit.customColumns);
  });

  it("clearing per day removes it; per year changes go to the long-standing fields", () => {
    const unit = legacyUnit({ authorisedPerDayQuantity: 0.05, authorisedPerDayUnit: "MT", authorisedPerDayKg: 50 });
    const snapshot = industryToRegistrationValues(unit);
    const values = { ...snapshot, authorisedPerDayQuantity: "", authorisedPerYearQuantity: "20", authorisedPerYearUnit: "MT" as const };
    const r = applyRegistrationEdit(sliceOf(unit), { values, snapshot, changed: changedRegistrationKeys(snapshot, values) });
    if (!r.ok) throw new Error(r.error);
    const next = r.slice.industry!;
    expect("authorisedPerDayQuantity" in next || "authorisedPerDayKg" in next || "authorisedPerDayUnit" in next).toBe(false);
    expect([next.authorisedSourceQuantity, next.authorisedQuantityKg]).toEqual([20, 20000]);
  });

  it("a field changed elsewhere since the form opened refuses the save", () => {
    const unit = legacyUnit();
    const snapshot = industryToRegistrationValues(unit);
    const values = { ...snapshot, mobile: "9000000001" };
    const server = legacyUnit({ mobile: "9111111111" }); // the unit changed its own mobile meanwhile
    const r = applyRegistrationEdit(sliceOf(server), { values, snapshot, changed: ["mobile"] });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("Mobile") });
    // an unrelated change elsewhere does not block it
    const other = applyRegistrationEdit(sliceOf(legacyUnit({ address: "Moved" })), { values, snapshot, changed: ["mobile"] });
    expect(other.ok).toBe(true);
  });

  it("a rename updates the compliance record too; a deleted unit refuses", () => {
    const unit = legacyUnit();
    const snapshot = industryToRegistrationValues(unit);
    const r = applyRegistrationEdit(sliceOf(unit), { values: { ...snapshot, name: "New Name" }, snapshot, changed: ["name"] });
    if (!r.ok) throw new Error(r.error);
    expect(r.slice.compliance?.industryName).toBe("New Name");
    expect(applyRegistrationEdit(sliceOf(null), { values: snapshot, snapshot, changed: ["name"] }).ok).toBe(false);
  });
});

describe("registration status", () => {
  const review = (status: RegistrationReview["status"]): RegistrationReview => ({ status, remark: "", at: "", byUid: "u", byEmail: "o@x" });

  it("the decision on record wins; without one a pending unit is Submitted, any other Approved", () => {
    expect(registrationStatusOf(legacyUnit({ status: "active" }), review("REJECTED"))).toBe("REJECTED");
    expect(registrationStatusOf(legacyUnit({ status: "pending" }), null)).toBe("SUBMITTED");
    expect(registrationStatusOf(legacyUnit({ status: "active" }), null)).toBe("APPROVED");
    expect(registrationStatusOf(legacyUnit({ status: "suspended" }), null)).toBe("APPROVED");
    expect(registrationStatusOf(legacyUnit({ status: "non-reporting" }), undefined)).toBe("APPROVED");
  });

  it("follows the lifecycle", () => {
    expect(canMoveRegistration(null, "APPROVED")).toBe(true);
    expect(canMoveRegistration("SUBMITTED", "APPROVED")).toBe(true);
    expect(canMoveRegistration("SUBMITTED", "REJECTED")).toBe(true);
    expect(canMoveRegistration("REJECTED", "SUBMITTED")).toBe(true);
    expect(canMoveRegistration("APPROVED", "SUBMITTED")).toBe(false);
    expect(canMoveRegistration("REJECTED", "APPROVED")).toBe(false);
    expect(canMoveRegistration("SUBMITTED", "SUBMITTED")).toBe(false);
  });

  it("approving makes a pending unit active and leaves any other alone", () => {
    expect(approveInSlice(sliceOf(legacyUnit({ status: "pending" })))?.industry?.status).toBe("active");
    expect(approveInSlice(sliceOf(legacyUnit({ status: "suspended" })))).toBeNull();
    expect(approveInSlice(sliceOf(null))).toBeNull();
  });
});

describe("industry CSV rows", () => {
  it("have the same columns for every unit, with no nested objects", () => {
    const old = industryCsvRow(legacyUnit());
    const fresh = industryCsvRow(legacyUnit({ id: "IND-030", authorisedPerDayQuantity: 50, authorisedPerDayUnit: "KG", authorisedPerDayKg: 50, hwmRemarks: "R" }));
    expect(Object.keys(old)).toEqual([...INDUSTRY_CSV_COLUMNS]);
    expect(Object.keys(fresh)).toEqual([...INDUSTRY_CSV_COLUMNS]);
    expect(old.authorisedPerDayKg).toBe("");
    expect(fresh.hwmRemarks).toBe("R");
    expect(old.customColumns).toBe("Softener");
    expect(Object.values(old).some((v) => typeof v === "object")).toBe(false);
  });
});

describe("the rules keep drafts to the form's fields", () => {
  const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");
  const block = rules.slice(rules.indexOf("function draftDataOk"), rules.indexOf("function draftOk"));

  it("whitelist exactly the draft keys - no password", () => {
    const list = block.slice(block.indexOf("hasOnly(["), block.indexOf("])", block.indexOf("hasOnly([")));
    const keys = [...list.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]);
    expect([...keys].sort()).toEqual([...REGISTRATION_DRAFT_KEYS].sort());
  });

  it("size-check every key at the form's own limit", () => {
    const limits = Object.fromEntries([...block.matchAll(/optStr\(m, '([A-Za-z0-9]+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]));
    expect(Object.keys(limits).sort()).toEqual([...REGISTRATION_DRAFT_KEYS].sort());
    for (const k of REGISTRATION_DRAFT_KEYS) expect([k, limits[k]]).toEqual([k, fieldOf(k).max]);
  });
});
