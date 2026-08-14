"use client";

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Droplets, Check, FileText, Recycle, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/lib/store/data";
import { toCanonicalKg, round1 } from "@/lib/data/etp-calc";
import { formatNumber } from "@/lib/utils";

/**
 * Monitoring-Body (admin) registration form — the SOLE path to create/register an ETP unit.
 * ETP operators cannot self-register; their login accounts are provisioned out-of-band and
 * their unit is created (fully registered) here by the regulator.
 */

// Input transforms (applied on every keystroke).
const alphaOnly = (v: string) => v.replace(/[^A-Za-z ]/g, "");
const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const capFirst = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

// Consent/HWM validity: from must not be later than to.
const rangeOk = (from?: string, to?: string) => !from || !to || from <= to;

const baseShape = {
  // §3.1 Unit details
  name: z.string().min(2, "Name of unit is required"),
  ownerName: z.string().regex(/^[A-Za-z ]{2,}$/, "Owner name — alphabets only"),
  area: z.string().regex(/^[A-Za-z ]{2,}$/, "Area — alphabets only"),
  address: z.string().min(4, "Address is required"),
  tehsil: z.string().min(2, "Tehsil is required"),
  district: z.string().min(2, "District is required"),
  misId: z.string().min(1, "MIS ID is required"),
  mobile: z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number"),
  email: z.string().regex(/^\S+@\S+\.\S+$/, "Valid email required"),
  // §3.2 Consent
  consentOrderNo: z.string().min(2, "Consent Order No. is required"),
  consentOrderDate: z.string().min(1, "Consent order date is required"),
  consentValidFrom: z.string().min(1, "Validity-from is required"),
  consentValidTo: z.string().min(1, "Validity-to is required"),
  // §3.3 Hazardous waste
  hwmAuthNo: z.string().min(2, "HWM Authorization No. is required"),
  hwmAuthDate: z.string().min(1, "Authorization order date is required"),
  hwmValidFrom: z.string().min(1, "Validity-from is required"),
  hwmValidTo: z.string().min(1, "Validity-to is required"),
  authorisedSourceQuantity: z.coerce.number().positive("Must be > 0"),
  authorisedSourceUnit: z.enum(["KG", "MT"]),
  tsdfName: z.string().min(2, "TSDF name is required"),
  tsdfAddress: z.string().min(4, "TSDF full address is required"),
  // §3.4 Signatory
  signatoryName: z.string().min(2, "Signatory name is required"),
  signatoryDesignation: z.string().min(1, "Designation is required"),
  // §3.5 Plant capacity (KLD)
  etpCapacity: z.coerce.number().positive("Must be > 0"),
  maxEffluentGeneration: z.coerce.number().positive("Must be > 0"),
  roStage1: z.coerce.number().nonnegative(),
  roStage2: z.coerce.number().nonnegative(),
  roStage3: z.coerce.number().nonnegative(),
  roStage4: z.coerce.number().nonnegative(),
  meeCapacity: z.coerce.number().positive("Must be > 0"),
  consentNumber: z.string().optional(),
};

const consentRange = (v: { consentValidFrom?: string; consentValidTo?: string }) => rangeOk(v.consentValidFrom, v.consentValidTo);
const hwmRange = (v: { hwmValidFrom?: string; hwmValidTo?: string }) => rangeOk(v.hwmValidFrom, v.hwmValidTo);
const consentMsg = { message: "Consent validity-to must not be earlier than validity-from", path: ["consentValidTo"] };
const hwmMsg = { message: "Authorization validity-to must not be earlier than validity-from", path: ["hwmValidTo"] };

const adminSchema = z.object(baseShape).refine(consentRange, consentMsg).refine(hwmRange, hwmMsg);
type FormValues = z.input<typeof adminSchema>;

export function RegistrationForm() {
  const registerIndustry = useDataStore((s) => s.registerIndustry);
  const industries = useDataStore((s) => s.industries);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const resolver = zodResolver(adminSchema) as unknown as Resolver<FormValues>;
  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver, defaultValues: { authorisedSourceUnit: "MT" } });

  const filtered = (key: "ownerName" | "area" | "mobile" | "tehsil" | "district", transform: (v: string) => string) => {
    const reg = register(key);
    return {
      ...reg,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        e.target.value = transform(e.target.value);
        return reg.onChange(e);
      },
    };
  };

  // Live kg preview for the authorised quantity.
  const srcQty = Number(watch("authorisedSourceQuantity")) || 0;
  const srcUnit = (watch("authorisedSourceUnit") as "KG" | "MT") ?? "MT";
  const kgPreview = srcQty > 0 ? toCanonicalKg(srcQty, srcUnit) : 0;

  // MIS ID must be unique across units.
  const misIdTaken = (misId: string) => industries.some((i) => i.misId && i.misId.trim() === misId.trim());

  const onSubmit = handleSubmit(async (values) => {
    const v = adminSchema.parse(values);
    if (misIdTaken(v.misId)) {
      setError("misId", { message: "This MIS ID is already registered" });
      return;
    }
    setSubmitting(true);
    const created = registerIndustry({
      name: v.name,
      ownerName: v.ownerName,
      area: v.area,
      address: v.address,
      mobile: v.mobile,
      email: v.email,
      consentNumber: v.consentOrderNo,
      permittedKLD: v.maxEffluentGeneration,
      etpCapacity: v.etpCapacity,
      roCapacity: v.roStage1,
      meeCapacity: v.meeCapacity,
      cetpId: null,
      maxEffluentGeneration: v.maxEffluentGeneration,
      roStage1: v.roStage1,
      roStage2: v.roStage2,
      roStage3: v.roStage3,
      roStage4: v.roStage4,
      misId: v.misId,
      tehsil: v.tehsil,
      district: v.district,
      consentOrderNo: v.consentOrderNo,
      consentOrderDate: v.consentOrderDate,
      consentValidFrom: v.consentValidFrom,
      consentValidTo: v.consentValidTo,
      hwmAuthNo: v.hwmAuthNo,
      hwmAuthDate: v.hwmAuthDate,
      hwmValidFrom: v.hwmValidFrom,
      hwmValidTo: v.hwmValidTo,
      authorisedQuantityKg: toCanonicalKg(v.authorisedSourceQuantity, v.authorisedSourceUnit),
      authorisedSourceQuantity: round1(v.authorisedSourceQuantity),
      authorisedSourceUnit: v.authorisedSourceUnit,
      tsdfName: v.tsdfName,
      tsdfAddress: v.tsdfAddress,
      signatoryName: v.signatoryName,
      signatoryDesignation: v.signatoryDesignation,
      registrationComplete: true,
    });
    toast.success("Industry registered", { description: `${created.name} added — pending verification.` });
    setDone(created.name);
    setSubmitting(false);
  });

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <Check className="h-6 w-6" />
        </div>
        <p className="mt-3 font-display text-lg font-bold text-foreground">{done} registered</p>
        <p className="mt-1 text-sm text-muted-foreground">The unit was added with the full RSPCB profile and is pending verification.</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button variant="outline" className="rounded-xl" onClick={() => setDone(null)}>
            Register another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* §3.1 Unit details */}
      <Section icon={<Building2 className="h-4 w-4 text-teal-600" />} title="1 · Unit Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name of unit" error={errors.name?.message}>
            <input {...register("name")} className={inputCls} placeholder="e.g. Pali Road Processors" />
          </Field>
          <Field label="Owner Name" error={errors.ownerName?.message}>
            <input {...filtered("ownerName", (v) => capFirst(alphaOnly(v)))} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Address" error={errors.address?.message}>
            <input {...register("address")} className={inputCls} placeholder="Full address" />
          </Field>
          <Field label="Area / Location" error={errors.area?.message}>
            <input {...filtered("area", alphaOnly)} className={inputCls} placeholder="Industrial area or zone" />
          </Field>
          <Field label="Tehsil" error={errors.tehsil?.message}>
            <input {...filtered("tehsil", (v) => capFirst(alphaOnly(v)))} className={inputCls} placeholder="Tehsil" />
          </Field>
          <Field label="District" error={errors.district?.message}>
            <input {...filtered("district", (v) => capFirst(alphaOnly(v)))} className={inputCls} placeholder="District" />
          </Field>
          <Field label="MIS ID (mandatory, unique)" error={errors.misId?.message}>
            <input {...register("misId")} className={inputCls} placeholder="e.g. 69197" />
          </Field>
          <Field label="Mobile" error={errors.mobile?.message}>
            <input {...filtered("mobile", digitsOnly)} inputMode="numeric" maxLength={10} className={inputCls} placeholder="10-digit mobile number" />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <input {...register("email")} className={inputCls} placeholder="plant@company.in" />
          </Field>
        </div>
      </Section>

      {/* §3.2 Consent details */}
      <Section icon={<FileText className="h-4 w-4 text-teal-600" />} title="2 · Consent Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Consent Order No." error={errors.consentOrderNo?.message}>
            <input {...register("consentOrderNo")} className={inputCls} placeholder="e.g. 2021-2022/TCD/7197" />
          </Field>
          <Field label="Consent order date" error={errors.consentOrderDate?.message}>
            <input type="date" {...register("consentOrderDate")} className={inputCls} />
          </Field>
          <Field label="Consent validity — from" error={errors.consentValidFrom?.message}>
            <input type="date" {...register("consentValidFrom")} className={inputCls} />
          </Field>
          <Field label="Consent validity — to" error={errors.consentValidTo?.message}>
            <input type="date" {...register("consentValidTo")} className={inputCls} />
          </Field>
        </div>
      </Section>

      {/* §3.3 Hazardous waste */}
      <Section icon={<Recycle className="h-4 w-4 text-teal-600" />} title="3 · Hazardous Waste Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="HWM Authorization No." error={errors.hwmAuthNo?.message}>
            <input {...register("hwmAuthNo")} className={inputCls} placeholder="e.g. RPCB/HWM/2023-2024/TCD/HSW/12" />
          </Field>
          <Field label="Authorization order date" error={errors.hwmAuthDate?.message}>
            <input type="date" {...register("hwmAuthDate")} className={inputCls} />
          </Field>
          <Field label="Authorization validity — from" error={errors.hwmValidFrom?.message}>
            <input type="date" {...register("hwmValidFrom")} className={inputCls} />
          </Field>
          <Field label="Authorization validity — to" error={errors.hwmValidTo?.message}>
            <input type="date" {...register("hwmValidTo")} className={inputCls} />
          </Field>
          <Field label="Authorised quantity" error={errors.authorisedSourceQuantity?.message}>
            <div className="flex gap-2">
              <input type="number" step="any" {...register("authorisedSourceQuantity")} className={inputCls} placeholder="e.g. 15.42" />
              <select {...register("authorisedSourceUnit")} className={inputCls + " w-24"}>
                <option value="MT">MT</option>
                <option value="KG">kg</option>
              </select>
            </div>
            <p className="mt-1 text-xs text-teal-600">Stored as {formatNumber(kgPreview)} kg{srcUnit === "MT" ? " (MT × 1000)" : ""}</p>
          </Field>
          <Field label="TSDF name" error={errors.tsdfName?.message}>
            <input {...register("tsdfName")} className={inputCls} placeholder="TSDF facility name" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="TSDF full address" error={errors.tsdfAddress?.message}>
              <input {...register("tsdfAddress")} className={inputCls} placeholder="Full TSDF address" />
            </Field>
          </div>
        </div>
      </Section>

      {/* §3.4 Signatory */}
      <Section icon={<UserCheck className="h-4 w-4 text-teal-600" />} title="4 · Authorised Signatory">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name of authorised signatory" error={errors.signatoryName?.message}>
            <input {...register("signatoryName")} className={inputCls} placeholder="Signatory name" />
          </Field>
          <Field label="Designation" error={errors.signatoryDesignation?.message}>
            <input {...register("signatoryDesignation")} className={inputCls} placeholder="e.g. Prop. / Manager" />
          </Field>
        </div>
      </Section>

      {/* §3.5 Plant capacity */}
      <Section icon={<Droplets className="h-4 w-4 text-teal-600" />} title="5 · Plant Capacity (all in KLD)">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ETP capacity (KLD)" error={errors.etpCapacity?.message}>
            <input type="number" step="any" {...register("etpCapacity")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="Maximum effluent generation (KLD)" error={errors.maxEffluentGeneration?.message}>
            <input type="number" step="any" {...register("maxEffluentGeneration")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="MEE capacity (KLD)" error={errors.meeCapacity?.message}>
            <input type="number" step="any" {...register("meeCapacity")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="RO Stage I (KLD)" error={errors.roStage1?.message}>
            <input type="number" step="any" {...register("roStage1")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="RO Stage II (KLD)" error={errors.roStage2?.message}>
            <input type="number" step="any" {...register("roStage2")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="RO Stage III (KLD)" error={errors.roStage3?.message}>
            <input type="number" step="any" {...register("roStage3")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="RO Stage IV (KLD)" error={errors.roStage4?.message}>
            <input type="number" step="any" {...register("roStage4")} className={inputCls} placeholder="0" />
          </Field>
        </div>
      </Section>

      <Button
        type="submit"
        disabled={submitting}
        size="lg"
        className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-base font-semibold text-white hover:from-teal-600/90 hover:to-cyan-600/90"
      >
        <Check className="h-4 w-4" />
        {submitting ? "Registering…" : "Register Industry"}
      </Button>
    </form>
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
