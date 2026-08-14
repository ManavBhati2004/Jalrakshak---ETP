"use client";

import { ClipboardCheck } from "lucide-react";
import { RegistrationForm } from "@/components/dashboard/registration-form";
import { PageHeader } from "@/components/dashboard/page-header";

/**
 * First-time registration gate (master §2.1). An ETP operator whose unit has not completed
 * the five-section RSPCB registration lands here (redirected by DashboardShell) and cannot
 * reach the operational dashboard / daily entry until it is complete. The form prefills from
 * whatever the unit already has, so completion is a review-and-confirm step.
 */
export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="First-time registration"
        title="Complete your ETP unit registration"
        description="Confirm the five prescribed RSPCB sections to unlock daily data entry. All fields are required by the Board's prescribed return."
      />
      <div className="flex items-center gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-800">
        <ClipboardCheck className="h-4 w-4 shrink-0" />
        Daily entry and the operational dashboard stay locked until this registration is completed and saved.
      </div>
      <RegistrationForm mode="onboarding" />
    </div>
  );
}
