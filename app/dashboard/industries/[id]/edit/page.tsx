"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { RegistrationForm } from "@/components/dashboard/registration-form";
import { industryToRegistrationValues, registrationStatusOf } from "@/lib/data/registration";
import { useRegistrationReviews } from "@/lib/hooks/use-registration-records";
import { useDataStore } from "@/lib/store/data";
import type { Industry, RegistrationReview, RegistrationStatus } from "@/lib/types";

/** The Monitoring Body edits a registered unit with the registration form. */
export default function EditRegistrationPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  const industries = useDataStore((s) => s.industries);
  const unit = industries.find((i) => i.id === id);
  const reviews = useRegistrationReviews();
  const review = reviews.byUnit[id] ?? null;
  const status = unit && reviews.loaded && !reviews.error ? registrationStatusOf(unit, review) : null;

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/industries?focus=${encodeURIComponent(id)}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Industries
      </Link>
      <PageHeader
        eyebrow="Industry Management"
        title="Edit Registration"
        description={unit ? `${unit.name} (${unit.id}). Only the fields you change are saved; the unit's login is not touched.` : id}
      />
      <div className="mx-auto max-w-3xl">
        {reviews.error ? (
          <p className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            Registration statuses could not be loaded, so changes can&apos;t be saved yet. Check your connection and reload the page.
          </p>
        ) : null}
        {unit ? (
          <EditForm unit={unit} status={status} review={review} />
        ) : industries.length > 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">That unit does not exist, or it was deleted.</p>
            <Button asChild variant="outline" className="mt-4 rounded-xl">
              <Link href="/dashboard/industries">Back to Industries</Link>
            </Button>
          </div>
        ) : (
          <p className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the unit…
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Mounted once the unit is loaded. The values it opens with are taken once: a later change to the
 * unit must not reset what the officer is typing (the form shows it as "changed elsewhere").
 */
function EditForm({ unit, status, review }: { unit: Industry; status: RegistrationStatus | null; review: RegistrationReview | null }) {
  const [initial] = useState(() => industryToRegistrationValues(unit));
  return <RegistrationForm mode={{ kind: "edit", industryId: unit.id }} initial={initial} editStatus={status} editReview={review} />;
}
