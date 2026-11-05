"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Save, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";
import { ROLES } from "@/lib/constants";
import { saveUnitProfile } from "@/lib/data/tenant-ops";
import { isAdmin, useAuthStore } from "@/lib/store/auth";
import { loadProfileName, saveProfileName } from "@/lib/store/accounts";
import { useDataStore } from "@/lib/store/data";
import type { Industry } from "@/lib/types";

const inputCls =
  "h-10 w-full rounded-xl border border-border bg-muted/30 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background";

const alphaOnly = (v: string) => v.replace(/[^A-Za-z ]/g, "");
const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 10);

const officerSchema = z.object({ name: z.string().trim().min(2, "Enter your name") });
type OfficerValues = z.infer<typeof officerSchema>;

/** The same rules the registration form applies to these fields. */
const unitSchema = z.object({
  ownerName: z.string().regex(/^[A-Za-z ]{2,}$/, "Owner name — alphabets only"),
  contactPerson: z.string().trim().min(2, "Contact person is required"),
  mobile: z.string().regex(/^\d{10}$/, "Enter a 10-digit mobile number"),
  address: z.string().trim().min(4, "Address is required"),
  signatoryName: z.string().trim().min(2, "Signatory name is required"),
  signatoryDesignation: z.string().trim().min(1, "Designation is required"),
});
type UnitValues = z.infer<typeof unitSchema>;

/**
 * The signed-in user's own profile. Everyone edits their name; a unit also edits its contact details.
 * The login email and the regulator-issued details (unit name, MIS ID, consents) are shown, not edited.
 */
export default function ProfilePage() {
  const role = useAuthStore((s) => s.role);
  const uid = useAuthStore((s) => s.uid);
  const industryId = useAuthStore((s) => s.industryId);
  const unit = useDataStore((s) => s.industries.find((i) => i.id === industryId));
  const officer = isAdmin(role);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="My Profile" description="Keep your details up to date." />

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h3 className="flex items-center gap-2 font-display text-lg font-bold text-foreground">
          <UserRound className="h-5 w-5 text-primary" /> Account
        </h3>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Detail label="Login email" value={auth.currentUser?.email ?? "—"} />
          <Detail label="Role" value={ROLES.find((r) => r.id === role)?.name ?? "—"} />
          {unit ? (
            <>
              <Detail label="Unit" value={`${unit.name} (${unit.id})`} />
              <Detail label="MIS ID" value={unit.misId ?? "—"} />
            </>
          ) : null}
        </dl>
      </div>

      {uid && officer ? <OfficerForm uid={uid} /> : null}
      {uid && !officer && unit ? <UnitForm uid={uid} unit={unit} /> : null}
      {uid && !officer && !unit ? <p className="text-sm text-muted-foreground">No ETP unit is linked to this login.</p> : null}
    </div>
  );
}

function OfficerForm({ uid }: { uid: string }) {
  const [saved, setSaved] = useState("");
  const { register, handleSubmit, formState } = useForm<OfficerValues>({ resolver: zodResolver(officerSchema), values: { name: saved } });

  useEffect(() => {
    void loadProfileName(uid).then(setSaved);
  }, [uid]);

  const onSubmit = handleSubmit(async ({ name }) => {
    const res = await saveProfileName(uid, name);
    if (!res.ok) {
      toast.error("Profile not saved", { description: res.error });
      return;
    }
    setSaved(name);
    toast.success("Profile saved");
  });

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold text-foreground">Your details</h3>
      <div className="mt-3 max-w-md">
        <Field label="Name" error={formState.errors.name?.message}>
          <input {...register("name")} className={inputCls} placeholder="Your name" />
        </Field>
      </div>
      <SaveButton busy={formState.isSubmitting} disabled={!formState.isDirty} />
    </form>
  );
}

function UnitForm({ uid, unit }: { uid: string; unit: Industry }) {
  const { register, handleSubmit, formState } = useForm<UnitValues>({
    resolver: zodResolver(unitSchema),
    // Live: a saved change comes back through the store, and the form follows it.
    values: {
      ownerName: unit.ownerName ?? "",
      contactPerson: unit.contactPerson ?? "",
      // Older units hold it as "+91 90244 88110"; the form works in the 10 digits.
      mobile: (unit.mobile ?? "").replace(/\D/g, "").slice(-10),
      address: unit.address ?? "",
      signatoryName: unit.signatoryName ?? "",
      signatoryDesignation: unit.signatoryDesignation ?? "",
    },
  });
  const { errors } = formState;

  const filtered = (key: "ownerName" | "mobile", transform: (v: string) => string) => {
    const reg = register(key);
    return {
      ...reg,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        e.target.value = transform(e.target.value);
        return reg.onChange(e);
      },
    };
  };

  const onSubmit = handleSubmit(async (v) => {
    const res = await saveUnitProfile(unit.id, v);
    if (!res.ok) {
      toast.error("Profile not saved", { description: res.error });
      return;
    }
    // The owner's name is also the login's profile name, so the two stay the same.
    const named = await saveProfileName(uid, v.ownerName);
    if (!named.ok) {
      toast.error("Profile not saved", { description: named.error });
      return;
    }
    toast.success("Profile saved");
  });

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-4 sm:p-6">
      <h3 className="font-display text-lg font-bold text-foreground">Unit contact details</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Owner name" error={errors.ownerName?.message}>
          <input {...filtered("ownerName", alphaOnly)} className={inputCls} />
        </Field>
        <Field label="Contact person" error={errors.contactPerson?.message}>
          <input {...register("contactPerson")} className={inputCls} />
        </Field>
        <Field label="Mobile" error={errors.mobile?.message}>
          <input {...filtered("mobile", digitsOnly)} inputMode="numeric" maxLength={10} className={inputCls} />
        </Field>
        <Field label="Address" error={errors.address?.message}>
          <input {...register("address")} className={inputCls} />
        </Field>
        <Field label="Name of authorised signatory" error={errors.signatoryName?.message}>
          <input {...register("signatoryName")} className={inputCls} />
        </Field>
        <Field label="Designation" error={errors.signatoryDesignation?.message}>
          <input {...register("signatoryDesignation")} className={inputCls} />
        </Field>
      </div>
      <SaveButton busy={formState.isSubmitting} disabled={!formState.isDirty} />
    </form>
  );
}

function SaveButton({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  return (
    <Button type="submit" disabled={busy || disabled} className="mt-4 gap-2 rounded-xl">
      <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
    </Button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
