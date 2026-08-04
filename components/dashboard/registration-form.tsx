"use client";

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, FileText, Trash2, UserCheck, Droplets, Check, Eye, EyeOff, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { useDataStore, type RegisterInput } from "@/lib/store/data";
import { useAuthStore } from "@/lib/store/auth";
import { useAccountsStore } from "@/lib/store/accounts";
import { remoteApply, emptyData, writeOwnedIndustry, syncContext } from "@/lib/data/firestore-storage";
import { cn } from "@/lib/utils";

// Input transforms (applied on every keystroke).
const alphaOnly = (v: string) => v.replace(/[^A-Za-z ]/g, "");
const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const capFirst = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
const numOnly = (v: string) => v.replace(/[^0-9.]/g, "");

const baseShape = {
  // Unit details
  name: z.string().regex(/^[A-Za-z ]{2,}$/, "Company name — alphabets only"),
  ownerName: z.string().regex(/^[A-Za-z ]{2,}$/, "Owner name — alphabets only"),
  area: z.string().regex(/^[A-Za-z ]{2,}$/, "Area — alphabets only"),
  address: z.string().min(4, "Address is required"),
  tehsil: z.string().optional(),
  district: z.string().optional(),
  misId: z.string().min(1, "MIS ID is required"),
  mobile: z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number"),
  email: z.string().regex(/^\S+@\S+\.\S+$/, "Valid email required"),
  // Consent details
  consentNumber: z.string().min(4, "Consent Order No. required"),
  consentOrderDate: z.string().optional(),
  consentValidFrom: z.string().optional(),
  consentValidTo: z.string().optional(),
  // Hazardous waste details
  hwmAuthNo: z.string().optional(),
  hwmAuthDate: z.string().optional(),
  hwmValidFrom: z.string().optional(),
  hwmValidTo: z.string().optional(),
  authQty: z.string().optional(),
  authQtyUnit: z.enum(["kg", "MT"]).optional(),
  tsdfName: z.string().optional(),
  tsdfAddress: z.string().optional(),
  // Authorised signatory
  signatoryName: z.string().optional(),
  signatoryDesignation: z.string().optional(),
  // Plant capacity (KLD)
  etpCapacity: z.coerce.number().positive("Must be > 0"),
  maxEffluentGeneration: z.coerce.number().positive("Must be > 0"),
  roStage1: z.coerce.number().positive("Must be > 0"),
  roStage2: z.coerce.number().nonnegative(),
  roStage3: z.coerce.number().nonnegative(),
  roStage4: z.coerce.number().nonnegative(),
  meeCapacity: z.coerce.number().positive("Must be > 0"),
};

const publicSchema = z.object({
  ...baseShape,
  password: z
    .string()
    .min(8, "At least 8 characters")
    .regex(/[A-Za-z]/, "Add a letter")
    .regex(/[0-9]/, "Add a number")
    .regex(/[^A-Za-z0-9]/, "Add a special character"),
});
const adminSchema = z.object(baseShape);

type FormValues = z.input<typeof publicSchema>;

export function RegistrationForm({ mode }: { mode: "public" | "admin" }) {
  const isPublic = mode === "public";
  const registerIndustry = useDataStore((s) => s.registerIndustry);
  const login = useAuthStore((s) => s.login);
  const signup = useAccountsStore((s) => s.signup);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const resolver = zodResolver(isPublic ? publicSchema : adminSchema) as unknown as Resolver<FormValues>;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver, defaultValues: { authQtyUnit: "kg" } });

  // Wraps register() so a filtered field transforms its value on every keystroke.
  const filtered = (key: "name" | "ownerName" | "area" | "mobile", transform: (v: string) => string) => {
    const reg = register(key);
    return {
      ...reg,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        e.target.value = transform(e.target.value);
        return reg.onChange(e);
      },
    };
  };

  const pw = watch("password") ?? "";
  const pwChecks = [
    { label: "At least 8 characters", ok: pw.length >= 8 },
    { label: "Contains a letter", ok: /[A-Za-z]/.test(pw) },
    { label: "Contains a number", ok: /[0-9]/.test(pw) },
    { label: "Contains a special character", ok: /[^A-Za-z0-9]/.test(pw) },
  ];

  // Maps validated form values → the store's RegisterInput (MT → kg conversion).
  const toIndustry = (v: z.infer<typeof adminSchema>): RegisterInput => {
    const rawQty = v.authQty ? Number(v.authQty) : undefined;
    const authorisedQuantityKg =
      rawQty != null && Number.isFinite(rawQty) ? Math.round(rawQty * (v.authQtyUnit === "MT" ? 1000 : 1)) : undefined;
    return {
      name: v.name,
      ownerName: v.ownerName,
      area: v.area,
      address: v.address,
      mobile: v.mobile,
      email: v.email,
      consentNumber: v.consentNumber,
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
      tehsil: v.tehsil,
      district: v.district,
      misId: v.misId,
      consentOrderNo: v.consentNumber,
      consentOrderDate: v.consentOrderDate,
      consentValidFrom: v.consentValidFrom,
      consentValidTo: v.consentValidTo,
      hwmAuthNo: v.hwmAuthNo,
      hwmAuthDate: v.hwmAuthDate,
      hwmValidFrom: v.hwmValidFrom,
      hwmValidTo: v.hwmValidTo,
      authorisedQuantityKg,
      tsdfName: v.tsdfName,
      tsdfAddress: v.tsdfAddress,
      signatoryName: v.signatoryName,
      signatoryDesignation: v.signatoryDesignation,
    };
  };

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);

    // ---- Admin: create the industry record only (no operator login) ----
    if (!isPublic) {
      const v = adminSchema.parse(values);
      const created = registerIndustry(toIndustry(v));
      toast.success("Industry registered", { description: `${created.name} added — pending verification.` });
      setDone(created.name);
      setSubmitting(false);
      return;
    }

    // ---- Public: full self-registration (account + owned industry) ----
    const v = publicSchema.parse(values);
    const acct = await signup({ name: v.ownerName, email: v.email, password: v.password, role: "etp", industryId: null });
    if (!acct.ok) {
      toast.error("Registration failed", { description: acct.error });
      setSubmitting(false);
      return;
    }
    remoteApply.active = true;
    try {
      useDataStore.setState(emptyData());
    } finally {
      remoteApply.active = false;
    }
    const created = registerIndustry(toIndustry(v));
    try {
      await writeOwnedIndustry(useDataStore.getState(), created.id, acct.user.id);
    } catch {
      // best-effort — persistence must not block entering the panel
    }
    try {
      await setDoc(doc(db, "users", acct.user.id), { industryId: created.id }, { merge: true });
    } catch {
      // best-effort — the session industryId is still set optimistically below
    }
    syncContext.uid = acct.user.id;
    syncContext.role = "etp";
    syncContext.industryId = created.id;
    syncContext.ready = true;
    toast.success("ETP unit registered", { description: `${created.name} is now pending verification.` });
    login("etp", created.id);
    setTimeout(() => {
      window.location.href = "/dashboard";
    }, 600);
  });

  if (done && !isPublic) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
          <Check className="h-6 w-6" />
        </div>
        <p className="mt-3 font-display text-lg font-bold text-foreground">{done} registered</p>
        <p className="mt-1 text-sm text-muted-foreground">The unit was added and is pending verification.</p>
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
      {/* Unit details */}
      <Card title="Unit Details" icon={<Building2 className="h-4 w-4 text-teal-600" />}>
        <Grid>
          <Field label="Name of Unit" error={errors.name?.message}>
            <input {...filtered("name", (v) => capFirst(alphaOnly(v)))} className={inputCls} placeholder="e.g. Pali Road Processors" />
          </Field>
          <Field label="Owner Name" error={errors.ownerName?.message}>
            <input {...filtered("ownerName", alphaOnly)} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Area / Location" error={errors.area?.message}>
            <input {...filtered("area", alphaOnly)} className={inputCls} placeholder="Industrial area or zone" />
          </Field>
          <Field label="Address" error={errors.address?.message}>
            <input {...register("address")} className={inputCls} placeholder="Full address" />
          </Field>
          <Field label="Tehsil" error={errors.tehsil?.message}>
            <input {...register("tehsil")} className={inputCls} placeholder="Tehsil" />
          </Field>
          <Field label="District" error={errors.district?.message}>
            <input {...register("district")} className={inputCls} placeholder="District" />
          </Field>
          <Field label="MIS ID" error={errors.misId?.message}>
            <input {...register("misId")} className={inputCls} placeholder="e.g. 72765" />
          </Field>
          <Field label="Mobile" error={errors.mobile?.message}>
            <input {...filtered("mobile", digitsOnly)} inputMode="numeric" maxLength={10} className={inputCls} placeholder="10-digit mobile number" />
          </Field>
          <Field label="Email" error={errors.email?.message}>
            <input {...register("email")} className={inputCls} placeholder="plant@company.in" />
          </Field>
          {isPublic && (
            <Field label="Login Password">
              <div className="relative">
                <input type={showPw ? "text" : "password"} {...register("password")} className={inputCls + " pr-10"} placeholder="Set a password to sign in later" />
                <button type="button" tabIndex={-1} onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600" aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {pwChecks.map((c) => (
                  <li key={c.label} className={cn("flex items-center gap-1.5 text-xs", c.ok ? "text-emerald-600" : "text-slate-400")}>
                    {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <Circle className="h-3.5 w-3.5 shrink-0" />}
                    {c.label}
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </Grid>
      </Card>

      {/* Consent details */}
      <Card title="Consent Details" icon={<FileText className="h-4 w-4 text-teal-600" />}>
        <Grid>
          <Field label="Consent Order No." error={errors.consentNumber?.message}>
            <input {...register("consentNumber")} className={inputCls} placeholder="e.g. 2021-2022/TCD/7154" />
          </Field>
          <Field label="Consent Order Date" error={errors.consentOrderDate?.message}>
            <input type="date" {...register("consentOrderDate")} className={inputCls} />
          </Field>
          <Field label="Consent Valid From" error={errors.consentValidFrom?.message}>
            <input type="date" {...register("consentValidFrom")} className={inputCls} />
          </Field>
          <Field label="Consent Valid To" error={errors.consentValidTo?.message}>
            <input type="date" {...register("consentValidTo")} className={inputCls} />
          </Field>
        </Grid>
      </Card>

      {/* Hazardous waste details */}
      <Card title="Hazardous Waste Details" icon={<Trash2 className="h-4 w-4 text-teal-600" />}>
        <Grid>
          <Field label="HWM Authorization No." error={errors.hwmAuthNo?.message}>
            <input {...register("hwmAuthNo")} className={inputCls} placeholder="e.g. RPCB/HWM/2022-2023/TCD/HSW/14" />
          </Field>
          <Field label="Authorization Order Date" error={errors.hwmAuthDate?.message}>
            <input type="date" {...register("hwmAuthDate")} className={inputCls} />
          </Field>
          <Field label="Authorization Valid From" error={errors.hwmValidFrom?.message}>
            <input type="date" {...register("hwmValidFrom")} className={inputCls} />
          </Field>
          <Field label="Authorization Valid To" error={errors.hwmValidTo?.message}>
            <input type="date" {...register("hwmValidTo")} className={inputCls} />
          </Field>
          <Field label="Authorised Quantity">
            <div className="flex gap-2">
              {(() => {
                const r = register("authQty");
                return (
                  <input
                    {...r}
                    onChange={(e) => {
                      e.target.value = numOnly(e.target.value);
                      return r.onChange(e);
                    }}
                    inputMode="decimal"
                    className={inputCls}
                    placeholder="Quantity"
                  />
                );
              })()}
              <select {...register("authQtyUnit")} className={inputCls + " w-24 shrink-0"}>
                <option value="kg">kg</option>
                <option value="MT">MT</option>
              </select>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Stored in kg (MT is converted ×1000).</p>
          </Field>
          <Field label="TSDF Name" error={errors.tsdfName?.message}>
            <input {...register("tsdfName")} className={inputCls} placeholder="Treatment/disposal facility" />
          </Field>
          <Field label="TSDF Full Address" error={errors.tsdfAddress?.message}>
            <input {...register("tsdfAddress")} className={inputCls} placeholder="Facility address" />
          </Field>
        </Grid>
      </Card>

      {/* Authorised signatory */}
      <Card title="Authorised Signatory" icon={<UserCheck className="h-4 w-4 text-teal-600" />}>
        <Grid>
          <Field label="Name of Authorised Signatory" error={errors.signatoryName?.message}>
            <input {...register("signatoryName")} className={inputCls} placeholder="Full name" />
          </Field>
          <Field label="Designation" error={errors.signatoryDesignation?.message}>
            <input {...register("signatoryDesignation")} className={inputCls} placeholder="e.g. Prop. / Manager" />
          </Field>
        </Grid>
      </Card>

      {/* Plant capacity (KLD) */}
      <Card title="Plant Capacity (KLD)" icon={<Droplets className="h-4 w-4 text-teal-600" />}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="ETP Capacity (KLD)" error={errors.etpCapacity?.message}>
            <input type="number" step="any" {...register("etpCapacity")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="Maximum Effluent Generation (KLD)" error={errors.maxEffluentGeneration?.message}>
            <input type="number" step="any" {...register("maxEffluentGeneration")} className={inputCls} placeholder="0" />
          </Field>
          <Field label="MEE Capacity (KLD)" error={errors.meeCapacity?.message}>
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
      </Card>

      <Button
        type="submit"
        disabled={submitting}
        size="lg"
        className="h-12 w-full gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-base font-semibold text-white hover:from-teal-600/90 hover:to-cyan-600/90"
      >
        <Check className="h-4 w-4" />
        {submitting ? "Registering…" : isPublic ? "Register & Enter ETP Panel" : "Register Industry"}
      </Button>
    </form>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-teal-400 focus:bg-white";

function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-slate-800">
        {icon} {title}
      </h2>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
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
