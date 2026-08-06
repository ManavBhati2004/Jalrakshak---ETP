"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SectionReveal } from "@/components/shared/section-reveal";
import { cn } from "@/lib/utils";

type CardPos = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type Style = "teal" | "green" | "charcoal";
type Annotation = {
  number: string;
  title: string;
  description: string;
  cardPosition: CardPos;
  targetX: number; // % of the screenshot
  targetY: number;
  connectorStyle: Style;
};
type Graphic = { img: string; url: string; heading: string; subtitle: string; annotations: Annotation[] };

// Real ETP-operator screenshots (Pali Road Processors) + 4 corner annotations each.
const GRAPHICS: Graphic[] = [
  {
    img: "etp-dashboard",
    url: "/dashboard",
    heading: "Your ETP unit at a glance",
    subtitle: "Compliance, water intake and alerts for your plant in one view.",
    annotations: [
      { number: "01", title: "Unit & compliance", description: "Your plant's compliance score, status and permitted capacity.", cardPosition: "top-left", targetX: 24, targetY: 30, connectorStyle: "teal" },
      { number: "02", title: "Quick stats", description: "Entries filed, items pending review, and open alerts.", cardPosition: "top-right", targetX: 82, targetY: 30, connectorStyle: "charcoal" },
      { number: "03", title: "Total water intake", description: "Latest reading plus the today-vs-yesterday change.", cardPosition: "bottom-left", targetX: 28, targetY: 47, connectorStyle: "green" },
      { number: "04", title: "Water balance", description: "Fresh water, reuse, permeate and reject at a glance.", cardPosition: "bottom-right", targetX: 82, targetY: 47, connectorStyle: "teal" },
    ],
  },
  {
    img: "etp-entry",
    url: "/dashboard/etp-entry",
    heading: "File the daily entry",
    subtitle: "One sheet a day — the prescribed meters, energy and kg ledgers.",
    annotations: [
      { number: "01", title: "Date is locked", description: "Every sheet is fixed to today's date automatically.", cardPosition: "top-left", targetX: 30, targetY: 24, connectorStyle: "teal" },
      { number: "02", title: "Enter Final readings", description: "Initial carries forward; you just enter the Final.", cardPosition: "top-right", targetX: 78, targetY: 40, connectorStyle: "charcoal" },
      { number: "03", title: "10 prescribed meters", description: "RSPCB water meters, reproduced verbatim.", cardPosition: "bottom-left", targetX: 34, targetY: 62, connectorStyle: "green" },
      { number: "04", title: "Totals auto-calculate", description: "Total = Final − Initial — no manual maths.", cardPosition: "bottom-right", targetX: 82, targetY: 62, connectorStyle: "teal" },
    ],
  },
  {
    img: "etp-alerts",
    url: "/dashboard/alerts",
    heading: "Alerts & notices",
    subtitle: "Overflow warnings and notices from the Monitoring Body, in real time.",
    annotations: [
      { number: "01", title: "Severity at a glance", description: "Live counts by critical, high, medium and low.", cardPosition: "top-left", targetX: 30, targetY: 25, connectorStyle: "teal" },
      { number: "02", title: "Your reports appear", description: "Issues you raise in the Help Center show here too.", cardPosition: "top-right", targetX: 58, targetY: 40, connectorStyle: "charcoal" },
      { number: "03", title: "Overflow & late flags", description: "Capacity/overflow and late-submission warnings.", cardPosition: "bottom-left", targetX: 34, targetY: 62, connectorStyle: "green" },
      { number: "04", title: "Notices from the regulator", description: "The Monitoring Body can message your unit directly.", cardPosition: "bottom-right", targetX: 60, targetY: 51, connectorStyle: "teal" },
    ],
  },
  {
    img: "etp-help",
    url: "/dashboard/help",
    heading: "Get help fast",
    subtitle: "Report an issue straight to the Monitoring Body's Alert Center.",
    annotations: [
      { number: "01", title: "Pick a category", description: "Data entry, meter/hardware, compliance and more.", cardPosition: "top-left", targetX: 40, targetY: 37, connectorStyle: "teal" },
      { number: "02", title: "Your reported issues", description: "A running log of everything you've raised.", cardPosition: "top-right", targetX: 78, targetY: 40, connectorStyle: "charcoal" },
      { number: "03", title: "Describe the issue", description: "Tell the regulator exactly what you need.", cardPosition: "bottom-left", targetX: 40, targetY: 50, connectorStyle: "green" },
      { number: "04", title: "Send to Monitoring Body", description: "It lands in the regulator's Alert Center instantly.", cardPosition: "bottom-right", targetX: 40, targetY: 62, connectorStyle: "teal" },
    ],
  },
];

const STROKE: Record<Style, string> = { teal: "#0d9488", green: "#15803d", charcoal: "#374151" };
const CARD_TONE: Record<CardPos, string> = {
  "top-left": "bg-[#eef3ec] border-[#d9e5d2]",
  "top-right": "bg-[#f4f1ea] border-[#e7ded0]",
  "bottom-left": "bg-[#e9f2f0] border-[#d1e5e0]",
  "bottom-right": "bg-[#eaf5ef] border-[#d3ecdd]",
};

// Mockup + image geometry within the fixed-aspect canvas (percent of canvas).
const MOCK = { left: 19, top: 21, width: 62 };
const IMG = { top: 24, height: 63 };
const ANCHOR: Record<CardPos, { x: number; y: number }> = {
  "top-left": { x: 21, y: 31 },
  "top-right": { x: 79, y: 31 },
  "bottom-left": { x: 21, y: 69 },
  "bottom-right": { x: 79, y: 69 },
};
const toCanvas = (tx: number, ty: number) => ({ cx: MOCK.left + (tx / 100) * MOCK.width, cy: IMG.top + (ty / 100) * IMG.height });

export function ProductWalkthrough() {
  const [idx, setIdx] = useState(0);
  const g = GRAPHICS[idx];
  const go = (d: number) => setIdx((i) => (i + d + GRAPHICS.length) % GRAPHICS.length);

  return (
    <section id="about" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <SectionReveal className="mx-auto mb-10 max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">About JalRakshak</span>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Mandated to protect water. Built for transparency.
        </h2>
        <p className="mt-4 text-muted-foreground">
          A digital initiative for the textile industry. Here&apos;s how an ETP operator runs their day on JalRakshak — a
          quick, guided walkthrough.
        </p>
      </SectionReveal>

      <SectionReveal delay={0.1}>
        <WalkthroughGraphic g={g} page={idx + 1} />

        {/* controls */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button onClick={() => go(-1)} aria-label="Previous" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary/40 hover:text-primary">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex gap-1.5">
            {GRAPHICS.map((_, i) => (
              <button key={i} onClick={() => setIdx(i)} aria-label={`Graphic ${i + 1}`} className={cn("h-2 rounded-full transition-all", i === idx ? "w-6 bg-primary" : "w-2 bg-border hover:bg-primary/40")} />
            ))}
          </div>
          <button onClick={() => go(1)} aria-label="Next" className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-primary/40 hover:text-primary">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </SectionReveal>
    </section>
  );
}

function WalkthroughGraphic({ g, page }: { g: Graphic; page: number }) {
  return (
    <div className="relative overflow-hidden rounded-[26px] border border-[#e6e8e4] bg-gradient-to-br from-[#fbfcfa] via-white to-[#f2f7f4] p-3 shadow-[0_20px_60px_-30px_rgba(15,60,45,0.35)] sm:p-5">
      <div className="rounded-[18px] border border-[#eceee9] p-3 sm:p-6">
        {/* ---------- DESKTOP: annotated canvas ---------- */}
        <div className="relative hidden aspect-[1.72/1] w-full lg:block">
          <Header g={g} />
          {/* browser mockup */}
          <div className="absolute" style={{ left: `${MOCK.left}%`, top: `${MOCK.top}%`, width: `${MOCK.width}%` }}>
            <BrowserMockup img={g.img} url={g.url} />
          </div>
          {/* connectors */}
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {g.annotations.map((a) => {
              const an = ANCHOR[a.cardPosition];
              const { cx, cy } = toCanvas(a.targetX, a.targetY);
              const c1x = an.x + (cx - an.x) * 0.42;
              const c2x = an.x + (cx - an.x) * 0.62;
              return (
                <path key={a.number} d={`M ${an.x} ${an.y} C ${c1x} ${an.y}, ${c2x} ${cy}, ${cx} ${cy}`} fill="none" stroke={STROKE[a.connectorStyle]} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={0.9} />
              );
            })}
          </svg>
          {/* endpoint markers (round, HTML so they don't distort) */}
          {g.annotations.map((a) => {
            const { cx, cy } = toCanvas(a.targetX, a.targetY);
            return (
              <span key={a.number} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${cx}%`, top: `${cy}%` }}>
                <span className="block h-3.5 w-3.5 rounded-full border-[3px] bg-white" style={{ borderColor: STROKE[a.connectorStyle] }} />
              </span>
            );
          })}
          {/* cards */}
          {g.annotations.map((a) => (
            <AnnotationCard key={a.number} a={a} desktop />
          ))}
          <div className="absolute inset-x-0 bottom-[2%] flex justify-center">
            <Footer page={page} />
          </div>
        </div>

        {/* ---------- MOBILE / TABLET: screenshot then stacked cards ---------- */}
        <div className="lg:hidden">
          <Header g={g} compact />
          <div className="relative mt-4">
            <BrowserMockup img={g.img} url={g.url} />
            {g.annotations.map((a) => {
              const { cx, cy } = toCanvas(a.targetX, a.targetY);
              // Re-map from canvas-% back to image-% for the pin (image occupies the mockup area)
              const px = ((cx - MOCK.left) / MOCK.width) * 100;
              const py = ((cy - IMG.top) / IMG.height) * 100;
              return (
                <span key={a.number} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: `${px}%`, top: `${py}%` }}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md" style={{ background: STROKE[a.connectorStyle] }}>
                    {a.number}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {g.annotations.map((a) => (
              <AnnotationCard key={a.number} a={a} />
            ))}
          </div>
          <div className="mt-4 flex justify-center">
            <Footer page={page} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ g, compact }: { g: Graphic; compact?: boolean }) {
  return (
    <div className={cn("text-center", compact ? "" : "absolute inset-x-0 top-[2%] mx-auto max-w-[56%]")}>
      <div className="flex items-center justify-center gap-2">
        <span className="hidden h-px w-6 bg-[#0d9488]/40 sm:block" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#0d9488]">JalRakshak Platform Walkthrough</span>
        <span className="hidden h-px w-6 bg-[#0d9488]/40 sm:block" />
      </div>
      <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-[#152219] sm:text-2xl">{g.heading}</h3>
      <p className="mt-1 text-xs text-[#5b6b62] sm:text-sm">{g.subtitle}</p>
    </div>
  );
}

function BrowserMockup({ img, url }: { img: string; url: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#e6e8e4] bg-white shadow-[0_12px_40px_-18px_rgba(15,60,45,0.4)]">
      <div className="flex items-center gap-2 border-b border-[#eef0ec] bg-[#f7f8f6] px-3 py-2">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f26d6d" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#f6c358" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#5fcf80" }} />
        </span>
        <span className="ml-2 truncate rounded bg-white px-2 py-0.5 text-[10px] text-[#8a968f] ring-1 ring-[#eef0ec]">jalrakshak-etp.vercel.app{url}</span>
      </div>
      <div className="relative aspect-[1440/900] w-full bg-white">
        <Image src={`/tutorial/${img}.png`} alt="" fill sizes="(max-width:1024px) 100vw, 62vw" className="object-cover object-top" />
      </div>
    </div>
  );
}

function AnnotationCard({ a, desktop }: { a: Annotation; desktop?: boolean }) {
  const posCls: Record<CardPos, string> = {
    "top-left": "left-0 top-[13%] w-[19%]",
    "top-right": "right-0 top-[13%] w-[19%]",
    "bottom-left": "left-0 bottom-[9%] w-[19%]",
    "bottom-right": "right-0 bottom-[9%] w-[19%]",
  };
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 shadow-[0_10px_30px_-18px_rgba(15,60,45,0.4)]",
        CARD_TONE[a.cardPosition],
        desktop && `absolute ${posCls[a.cardPosition]}`,
      )}
    >
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-[#152219] shadow-sm ring-1 ring-black/5">
        {a.number}
      </span>
      <p className="mt-2.5 font-display text-sm font-bold text-[#152219]">{a.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[#5b6b62]">{a.description}</p>
    </div>
  );
}

function Footer({ page }: { page: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#0d9488] text-[11px] font-bold text-white">{page}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#0d9488]">JalRakshak Platform Walkthrough</span>
    </div>
  );
}
