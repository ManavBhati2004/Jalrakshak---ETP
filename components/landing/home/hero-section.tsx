"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedCounter } from "@/components/shared/animated-counter";
import { HERO_STATS } from "@/lib/constants";

export function HeroSection() {
  return (
    <section
      id="overview"
      className="relative flex min-h-[86vh] flex-col items-center justify-center overflow-x-clip px-5 pb-24 pt-16 text-center"
    >
      {/* gradient + blobs */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-teal-50 via-white to-cyan-50/70" />
      <div className="pointer-events-none absolute -left-24 top-24 -z-10 h-96 w-96 rounded-full bg-teal-300/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-40 -z-10 h-96 w-96 rounded-full bg-cyan-300/30 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 -z-10 h-40 w-full bg-gradient-to-t from-cyan-100/60 to-transparent" />

      <motion.div
        initial={{ opacity: 0, y: 26 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 flex max-w-4xl flex-col items-center"
      >
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/80 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-teal-700 shadow-sm backdrop-blur">
          <ShieldCheck className="h-3.5 w-3.5" />
          Smart ETP Wastewater Monitoring
        </span>

        <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
          <span className="text-gradient-brand">JalRakshak</span>
        </h1>
        <p className="mt-5 max-w-2xl text-balance text-lg text-slate-600 sm:text-xl">
          Smart Textile Wastewater Monitoring &amp; Compliance Platform — turning
          every flow meter, photo and reading into transparent environmental
          governance.
        </p>

        <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="group h-12 gap-2 rounded-full px-7 text-base font-semibold shadow-lg">
            <Link href="/login">
              Enter Command Center
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
      </motion.div>

      {/* stat counters */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.9 }}
        className="relative z-10 mt-16 grid w-full max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {HERO_STATS.map((s) => (
          <div key={s.label} className="rounded-2xl border border-teal-100 bg-white/80 px-4 py-5 shadow-sm backdrop-blur">
            <div className="font-display text-3xl font-bold text-teal-600 sm:text-4xl">
              <AnimatedCounter value={s.value} suffix={s.suffix} startOnView={false} />
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
