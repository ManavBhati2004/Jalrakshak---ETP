"use client";

import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Droplets, Check, Eye, EyeOff, CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/lib/store/data";
import { useAuthStore } from "@/lib/store/auth";
import { useAccountsStore } from "@/lib/store/accounts";
import { remoteApply, emptyData, writeOwnedIndustry, syncContext } from "@/lib/data/firestore-storage";
import { cn } from "@/lib/utils";

// Input transforms (applied on every keystroke).
const alphaOnly = (v: string) => v.replace(/[^A-Za-z ]/g, "");
const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);
const capFirst = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);

const baseShape = {
  name: z.string().regex(/^[A-Za-z ]{2,}$/, "Company name — alphabets only"),
  ownerName: z.string().regex(/^[A-Za-z ]{2,}$/, "Owner name — alphabets only"),
  area: z.string().regex(/^[A-Za-z ]{2,}$/, "Area — alphabets only"),
  address: z.string().min(4, "Address is required"),
  consentNumber: z.string().min(4, "Consent number required"),
  mobile: z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number"),
  email: z.string().regex(/^\S+@\S+\.\S+$/, "Valid email required"),
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

  // Admin mode drops the password field; the resolver union is runtime-correct.
  const resolver = zodResolver(isPublic ? publicSchema : adminSchema) as unknown as Resolver<FormValues>;
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver });

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

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);

    // ---- Admin: create the industry record only (no operator login) ----
    // The Firebase client SDK cannot provision another user's account without
    // switching the current session, so the admin registers the unit and the
    // operator later self-registers to claim it.
    if (!isPublic) {
      const v = adminSchema.parse(values);
      const created = registerIndustry({
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
      });
      toast.success("Industry registered", { description: `${created.name} added — pending verification.` });
      setDone(created.name);
      setSubmitting(false);
      return;
    }

    // ---- Public: full self-registration (account + owned industry) ----
    const v = publicSchema.parse(values);
    // 1) Create the account first so we're authenticated before touching Firestore
    //    (the rules require auth to create the industry document).
    const acct = await signup({ name: v.ownerName, email: v.email, password: v.password, role: "etp", industryId: null });
    if (!acct.ok) {
      toast.error("Registration failed", { description: acct.error });
      setSubmitting(false);
      return;
    }
    // 2) A new operator's world is just its own unit — start from a clean slate so
    //    we never touch (or read) any other tenant's data.
    remoteApply.active = true;
    try {
      useDataStore.setState(emptyData());
    } finally {
      remoteApply.active = false;
    }
    // 3) Create the unit locally.
    const created = registerIndustry({
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
    });
    // 4) Persist the unit as an operator-owned industry document (stamps ownerUid
    //    so the Firestore rules bind it to this account).
    try {
      await writeOwnedIndustry(useDataStore.getState(), created.id, acct.user.id);
    } catch {
      // best-effort — persistence must not block entering the panel
    }
    // 5) Link the account → its industry, and point the sync context at it so
    //    submissions persist immediately.
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
    // Hard navigation so the auth listener re-hydrates cleanly from the now-linked profile.
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
      {/* general info */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-slate-800">
          <Building2 className="h-4 w-4 text-teal-600" /> Company Details
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company Name" error={errors.name?.message}>
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
          <Field label="Consent Number" error={errors.consentNumber?.message}>
            <input {...register("consentNumber")} className={inputCls} placeholder="Consent / CTO number" />
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
                <input
                  type={showPw ? "text" : "password"}
                  {...register("password")}
                  className={inputCls + " pr-10"}
                  placeholder="Set a password to sign in later"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
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
        </div>
      </div>

      {/* capacities (KLD) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-slate-800">
          <Droplets className="h-4 w-4 text-teal-600" /> Treatment Capacities (KLD)
        </h2>
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
      </div>

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

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
