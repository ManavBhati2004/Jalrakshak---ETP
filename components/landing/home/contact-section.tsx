"use client";

import Link from "next/link";
import { Mail, Phone, MapPin, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionReveal } from "@/components/shared/section-reveal";

const CONTACTS = [
  { icon: Mail, label: "Email", value: "support@jalrakshak.in", sub: "Monitoring support desk" },
  { icon: Phone, label: "Helpline", value: "+91 2988 220 145", sub: "Mon–Sat · 9:00–18:00" },
  { icon: MapPin, label: "Office", value: "Regional Monitoring Office", sub: "Rajasthan, India" },
  { icon: Clock, label: "Monitoring", value: "24 × 7 Live", sub: "Automated alert engine" },
];

export function ContactSection() {
  return (
    <section id="contact" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <div className="overflow-hidden rounded-[32px] border border-border bg-gradient-to-br from-teal-600 via-cyan-600 to-blue-700 p-8 text-white shadow-2xl sm:p-12">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr]">
          <SectionReveal>
            <span className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Get in touch</span>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Bring transparent water governance to your cluster.
            </h2>
            <p className="mt-4 max-w-md text-white/85">
              The contacts below show how an officer would reach the JalRakshak
              monitoring support desk.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-7 h-12 rounded-full bg-white px-7 text-base font-semibold text-teal-700 hover:bg-white/90"
            >
              <Link href="/login">
                Launch the platform
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </SectionReveal>

          <div className="grid gap-3 sm:grid-cols-2">
            {CONTACTS.map((c) => (
              <div key={c.label} className="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md">
                <c.icon className="h-5 w-5 text-white/90" />
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/70">{c.label}</p>
                <p className="mt-0.5 text-sm font-semibold leading-snug">{c.value}</p>
                <p className="mt-1 text-xs text-white/70">{c.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
