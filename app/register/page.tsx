"use client";

import Link from "next/link";
import { ArrowLeft, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JalRakshakLogo } from "@/components/shared/logo";
import { RegistrationForm } from "@/components/dashboard/registration-form";

export default function RegisterEtpPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 via-white to-cyan-50/70">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:py-12">
        <div className="flex items-center justify-between">
          <JalRakshakLogo size={36} />
          <Button asChild variant="ghost" size="sm" className="h-9 gap-1.5 px-3 text-slate-500">
            <Link href="/login">
              <ArrowLeft className="h-4 w-4" /> Back to login
            </Link>
          </Button>
        </div>

        <div className="mt-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-teal-700">
            <Droplets className="h-3.5 w-3.5" /> Individual ETP · Self Registration
          </span>
          <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Register your ETP unit</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Provide your unit details and treatment capacities. All capacities are recorded in KLD. On submit you&apos;ll enter your ETP panel.
          </p>
        </div>

        <div className="mt-6">
          <RegistrationForm mode="public" />
        </div>
      </div>
    </div>
  );
}
