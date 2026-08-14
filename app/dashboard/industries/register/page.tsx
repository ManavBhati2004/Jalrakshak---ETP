"use client";

import Link from "next/link";
import { ArrowLeft, Droplets } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { RegistrationForm } from "@/components/dashboard/registration-form";

export default function RegisterMemberPage() {
  return (
    <div className="space-y-6">
      <Link href="/dashboard/industries" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Industries
      </Link>
      <PageHeader
        eyebrow="Industry Management"
        title="Register New ETP Unit"
        description="Onboard a textile unit running its own individual ETP. Submission enters the verification queue."
      />

      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Droplets className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Registered as an <span className="font-semibold text-foreground">Individual ETP</span> unit with a{" "}
            <span className="font-semibold text-amber-500">pending</span> status.
          </span>
        </div>
        <RegistrationForm />
      </div>
    </div>
  );
}
