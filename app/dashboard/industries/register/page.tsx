"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Droplets } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { RegistrationForm, type RegistrationFormMode } from "@/components/dashboard/registration-form";

export default function RegisterMemberPage() {
  return (
    <Suspense fallback={null}>
      <RegisterView />
    </Suspense>
  );
}

function RegisterView() {
  const draftId = useSearchParams().get("draft");
  const mode: RegistrationFormMode = draftId ? { kind: "draft", draftId } : { kind: "new" };
  return (
    <div className="space-y-6">
      <Link href="/dashboard/industries" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Industries
      </Link>
      <PageHeader
        eyebrow="Industry Management"
        title={draftId ? "Continue Registration Draft" : "Register New ETP Unit"}
        description="Onboard a textile unit running its own individual ETP. Save it as a draft at any point; a submitted registration awaits the Monitoring Body's approval."
      />

      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Droplets className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Registered as an <span className="font-semibold text-foreground">Individual ETP</span> unit. Once submitted its status is{" "}
            <span className="font-semibold text-amber-500">Submitted</span> until it is approved or rejected on the Industries page.
          </span>
        </div>
        {/* Not keyed by the draft id: the first Save as Draft moves the address to ?draft=…, and the
            form keeps what was typed (including the password, which a draft never stores). */}
        <RegistrationForm mode={mode} />
      </div>
    </div>
  );
}
