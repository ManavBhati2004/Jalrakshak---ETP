"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SectionReveal } from "@/components/shared/section-reveal";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number; t: string };
type Step = { img: string; url: string; role: string; title: string; blurb: string; points: Point[] };

// Real screenshots (public/tutorial) + brief, numbered callouts pinned to the UI.
const STEPS: Step[] = [
  {
    img: "01-login",
    url: "/login",
    role: "Get started",
    title: "Sign in",
    blurb: "Two roles, one login — the Monitoring Body oversees every unit; an ETP operator sees only their own.",
    points: [
      { x: 72, y: 45, t: "Enter your email & password" },
      { x: 72, y: 80, t: "Demo accounts are listed to try it instantly" },
    ],
  },
  {
    img: "02-admin-dashboard",
    url: "/dashboard",
    role: "Monitoring Body",
    title: "Command Center overview",
    blurb: "The regulator's home — live counts across every unit and quick access to everything.",
    points: [
      { x: 40, y: 5, t: "Search any unit by name, area or consent" },
      { x: 33, y: 33, t: "Live metric cards — click one to jump to that page" },
      { x: 86, y: 62, t: "Recent units & the treatment pipeline at a glance" },
    ],
  },
  {
    img: "03-industries",
    url: "/dashboard/industries",
    role: "Monitoring Body",
    title: "Industry registry",
    blurb: "Every registered ETP unit with its consent, capacity, compliance and registration date.",
    points: [
      { x: 90, y: 15, t: "Register a new unit" },
      { x: 50, y: 55, t: "Open any row for the full unit detail" },
    ],
  },
  {
    img: "04-register-unit",
    url: "/dashboard/industries/register",
    role: "Monitoring Body",
    title: "Register a unit",
    blurb: "Capture the RSPCB-prescribed details — MIS ID, consent, hazardous-waste authorisation and plant capacity.",
    points: [
      { x: 45, y: 34, t: "Unit, consent & hazardous-waste details" },
      { x: 45, y: 70, t: "Authorised quantity in kg or MT (auto-converted)" },
    ],
  },
  {
    img: "05-etp-units",
    url: "/dashboard/etp",
    role: "Monitoring Body",
    title: "ETP units",
    blurb: "Drill into any unit's capacities, treatment pipeline and full reading history.",
    points: [{ x: 50, y: 42, t: "Select a unit to inspect its data" }],
  },
  {
    img: "06-approvals",
    url: "/dashboard/approvals",
    role: "Monitoring Body",
    title: "Approvals",
    blurb: "Review each submitted daily entry and approve or reject it — with a clear audit timeline.",
    points: [{ x: 52, y: 46, t: "Approve or reject submissions" }],
  },
  {
    img: "07-alerts",
    url: "/dashboard/alerts",
    role: "Monitoring Body",
    title: "Alert center",
    blurb: "Late, zero-reading, over-capacity and device-clock-tamper events surface the moment they happen.",
    points: [
      { x: 38, y: 25, t: "Severity totals at a glance" },
      { x: 55, y: 52, t: "Acknowledge or resolve each alert" },
    ],
  },
  {
    img: "08-compliance",
    url: "/dashboard/compliance",
    role: "Monitoring Body",
    title: "Compliance",
    blurb: "Scorecards and submission rates for every unit, colour-coded by status.",
    points: [{ x: 50, y: 42, t: "Compliance scores & trends per unit" }],
  },
  {
    img: "09-reports",
    url: "/dashboard/reports",
    role: "Monitoring Body",
    title: "Reports & exports",
    blurb: "One-click, Excel-ready CSVs for inspections, audits and review meetings.",
    points: [{ x: 38, y: 42, t: "Export any report as a timestamped CSV" }],
  },
  {
    img: "10-etp-dashboard",
    url: "/dashboard",
    role: "ETP Operator",
    title: "Your unit at a glance",
    blurb: "Compliance, today-vs-yesterday water intake and your own alerts in one place.",
    points: [
      { x: 34, y: 42, t: "Total water intake & daily change" },
      { x: 82, y: 42, t: "Your latest water balance" },
    ],
  },
  {
    img: "11-etp-entry",
    url: "/dashboard/etp-entry",
    role: "ETP Operator",
    title: "Daily ETP entry",
    blurb: "One sheet a day — 10 water meters, 3 energy meters and the kg sludge / MEE-salt ledgers.",
    points: [
      { x: 27, y: 24, t: "Date is locked to today" },
      { x: 52, y: 55, t: "Initial carries forward — you enter the Final" },
      { x: 80, y: 42, t: "Totals calculate automatically" },
    ],
  },
];

export function ProductWalkthrough() {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];
  const go = (d: number) => setIdx((i) => (i + d + STEPS.length) % STEPS.length);

  return (
    <section id="about" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <SectionReveal className="mx-auto mb-12 max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">About JalRakshak</span>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Mandated to protect water. Built for transparency.
        </h2>
        <p className="mt-4 text-muted-foreground">
          A digital initiative for the textile industry — making every drop of industrial wastewater accountable. Here&apos;s a
          quick walkthrough of the platform, step by step.
        </p>
      </SectionReveal>

      <SectionReveal delay={0.1} className="grid items-center gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.5fr)] lg:gap-10">
        {/* caption panel */}
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
              {step.role}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Step {idx + 1} of {STEPS.length}
            </span>
          </div>

          <h3 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{step.title}</h3>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">{step.blurb}</p>

          <ul className="mt-5 space-y-3">
            {step.points.map((p, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="text-sm text-foreground/90">{p.t}</span>
              </li>
            ))}
          </ul>

          <div className="mt-7 flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              aria-label="Previous step"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => go(1)}
              aria-label="Next step"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="ml-2 flex flex-wrap gap-1.5">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  aria-label={`Step ${i + 1}`}
                  className={cn("h-2 rounded-full transition-all", i === idx ? "w-6 bg-primary" : "w-2 bg-border hover:bg-primary/40")}
                />
              ))}
            </div>
          </div>
        </div>

        {/* browser-framed screenshot with pinned callouts */}
        <div className="order-1 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl lg:order-2">
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
            <span className="flex gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-400/70" />
              <span className="h-3 w-3 rounded-full bg-amber-400/70" />
              <span className="h-3 w-3 rounded-full bg-emerald-400/70" />
            </span>
            <span className="ml-2 truncate rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
              jalrakshak-etp.vercel.app{step.url}
            </span>
          </div>
          <div className="relative aspect-[1440/900] w-full bg-background">
            <Image
              key={step.img}
              src={`/tutorial/${step.img}.png`}
              alt={step.title}
              fill
              sizes="(max-width: 1024px) 100vw, 60vw"
              className="object-cover object-top"
              priority={idx === 0}
            />
            {step.points.map((p, i) => (
              <Pin key={i} n={i + 1} x={p.x} y={p.y} />
            ))}
          </div>
        </div>
      </SectionReveal>
    </section>
  );
}

function Pin({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
      <span className="relative flex h-7 w-7 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50" />
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-primary text-xs font-bold text-primary-foreground shadow-lg">
          {n}
        </span>
      </span>
    </span>
  );
}
