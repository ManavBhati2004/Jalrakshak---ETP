"use client";

import { useState } from "react";
import { motion, useMotionValueEvent, useTransform, type MotionValue } from "framer-motion";
import { ArrowDown, ArrowRight, Droplets, TriangleAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JalRakshakLogo } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

const STEPS = ["Flow Meter", "ETP", "RO", "MEE", "Treated"];

export function ScrollOverlay({
  progress,
  onEnter,
  onSkip,
}: {
  progress: MotionValue<number>;
  onEnter: () => void;
  onSkip: () => void;
}) {
  const [p, setP] = useState(0);
  useMotionValueEvent(progress, "change", (v) => setP(Math.round(v * 100) / 100));

  const pollutedOpacity = useTransform(progress, [0, 0.32], [1, 0]);
  const cleanOpacity = useTransform(progress, [0.45, 0.8], [0, 1]);
  const hintOpacity = useTransform(progress, [0, 0.12], [1, 0]);
  const topBarOpacity = useTransform(progress, [0.92, 1], [1, 0]);
  const enterOpacity = useTransform(progress, [0.78, 0.97], [0, 1]);
  const enterPointer = useTransform(progress, (v) => (v > 0.8 ? "auto" : "none"));
  const barWidth = useTransform(progress, [0, 1], ["0%", "100%"]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
      {/* legibility scrims — heavier at the top (behind the headline), light over the lower diorama */}
      <div className="absolute inset-x-0 top-0 h-[62%] bg-gradient-to-b from-black/55 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[32%] bg-gradient-to-t from-black/45 to-transparent" />

      {/* top bar */}
      <motion.div style={{ opacity: topBarOpacity }} className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-10">
        <JalRakshakLogo tone="light" />
        <button
          onClick={onSkip}
          className="pointer-events-auto inline-flex min-h-9 items-center rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-white/20"
        >
          Skip intro →
        </button>
      </motion.div>

      {/* headline — upper third */}
      <div className="relative z-10 px-6 pt-[5vh] text-center">
        <div className="relative mx-auto h-[320px] max-w-3xl sm:h-[280px]">
          {/* polluted */}
          <motion.div style={{ opacity: pollutedOpacity }} className="absolute inset-x-0 top-0 flex flex-col items-center">
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-rose-500/25 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md">
              <TriangleAlert className="h-3.5 w-3.5" />
              Untreated Industrial Effluent
            </span>
            <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.55)] sm:text-5xl lg:text-6xl">
              Untreated Textile Wastewater
              <br className="hidden sm:block" /> <span className="text-rose-300">Harms Our Rivers</span>
            </h1>
          </motion.div>

          {/* clean */}
          <motion.div style={{ opacity: cleanOpacity }} className="absolute inset-x-0 top-0 flex flex-col items-center">
            <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-emerald-500/25 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white backdrop-blur-md">
              <Sparkles className="h-3.5 w-3.5" />
              Smart Monitoring · JalRakshak
            </span>
            <h1 className="font-display text-3xl font-extrabold leading-[1.05] tracking-tight text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.55)] sm:text-5xl lg:text-6xl">
              Clean Water, <span className="text-gradient-cyan">Restored.</span>
            </h1>
            <p className="mt-4 max-w-xl text-balance text-base text-white/90 sm:text-lg">
              Real-time meter logging across ETP, RO and MEE keeps textile
              industry compliant and rivers alive.
            </p>
            <motion.div style={{ opacity: enterOpacity, pointerEvents: enterPointer as never }} className="mt-6">
              <Button
                onClick={onEnter}
                size="lg"
                className="group h-12 gap-2 rounded-full bg-white px-7 text-base font-semibold text-emerald-700 shadow-xl hover:bg-white/90"
              >
                <Droplets className="h-5 w-5" />
                Enter Monitoring System
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </motion.div>
          </motion.div>
        </div>
      </div>

      <div className="flex-1" />

      {/* pipeline progress */}
      <div className="relative z-10 px-6 pb-9">
        <div className="mx-auto max-w-2xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            {STEPS.map((s, i) => {
              const active = p > i * 0.18;
              return (
                <div key={s} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-inset transition-all",
                        active ? "bg-cyan-400 text-slate-900 ring-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.7)]" : "bg-white/10 text-white/60 ring-white/25",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className={cn("mt-1 hidden text-[9px] font-semibold uppercase tracking-wide sm:block", active ? "text-white" : "text-white/55")}>{s}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="mx-1 h-0.5 flex-1 rounded-full bg-white/15">
                      <div className="h-full rounded-full bg-cyan-400 transition-all duration-300" style={{ width: p > (i + 0.5) * 0.18 ? "100%" : "0%" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-teal-400" style={{ width: barWidth }} />
          </div>
        </div>

        <motion.div style={{ opacity: hintOpacity }} className="mt-5 flex flex-col items-center text-white/70">
          <span className="text-[10px] uppercase tracking-[0.3em]">Scroll to clean the river</span>
          <ArrowDown className="mt-1 h-4 w-4 animate-bounce" />
        </motion.div>
      </div>
    </div>
  );
}
