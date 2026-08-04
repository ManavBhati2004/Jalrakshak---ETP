"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Leaf, Cpu, ShieldCheck, Droplets } from "lucide-react";
import { SectionReveal } from "@/components/shared/section-reveal";
import { cn } from "@/lib/utils";

const SLIDES = [
  {
    img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=70",
    icon: Leaf,
    eyebrow: "Environmental Protection",
    title: "Protecting Rajasthan's Rivers",
    body: "Continuous oversight of textile effluent keeps the Luni basin and groundwater safe from untreated discharge.",
    color: "#10b981",
  },
  {
    img: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1400&q=70",
    icon: Droplets,
    eyebrow: "Water Conservation",
    title: "Every Drop Recovered",
    body: "Zero Liquid Discharge tracking turns wastewater back into a reusable resource for industry and community.",
    color: "#0ea5e9",
  },
  {
    img: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1400&q=70",
    icon: ShieldCheck,
    eyebrow: "Responsible Compliance",
    title: "A Greener Tomorrow",
    body: "Automated alerts make non-compliance visible the instant it happens — so growth and ecology advance together.",
    color: "#22c55e",
  },
  {
    img: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=70",
    icon: Cpu,
    eyebrow: "Digital Transformation",
    title: "Live Digital Oversight",
    body: "Paper logbooks become live, auditable records — every reading time-stamped, geo-tagged and photo-verified.",
    color: "#6366f1",
  },
];

export function AboutSlideshow() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  const go = useCallback((dir: number) => setIdx((i) => (i + dir + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 5200);
    return () => clearInterval(id);
  }, [paused, idx]);

  const slide = SLIDES[idx];

  return (
    <section id="about" className="relative mx-auto max-w-7xl px-5 py-24 sm:px-8">
      <SectionReveal className="mx-auto mb-12 max-w-2xl text-center">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">About JalRakshak</span>
        <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Mandated to protect water. Built for transparency.
        </h2>
        <p className="mt-4 text-muted-foreground">
          A digital initiative for the textile industry — making every drop of
          industrial wastewater accountable.
        </p>
      </SectionReveal>

      <SectionReveal
        className="relative overflow-hidden rounded-[28px] border border-border shadow-2xl"
        delay={0.1}
      >
        <div
          className="relative aspect-[16/10] w-full sm:aspect-[21/9]"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <AnimatePresence>
            <motion.div
              key={idx}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute inset-0"
            >
              {/* Ken Burns */}
              <motion.div
                initial={{ scale: 1.14 }}
                animate={{ scale: 1 }}
                transition={{ duration: 6.5, ease: "linear" }}
                className="absolute inset-0"
              >
                <Image src={slide.img} alt={slide.title} fill priority={idx === 0} sizes="100vw" className="object-cover" />
              </motion.div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/20" />
            </motion.div>
          </AnimatePresence>

          {/* caption */}
          <div className="absolute inset-0 flex items-end p-4 sm:p-6 lg:p-10">
            <AnimatePresence mode="wait">
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 26 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="max-w-xl"
              >
                <span
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white"
                  style={{ background: `${slide.color}cc` }}
                >
                  <slide.icon className="h-3.5 w-3.5" />
                  {slide.eyebrow}
                </span>
                <h3 className="mt-3 font-display text-xl font-bold text-white drop-shadow sm:text-2xl lg:text-4xl">{slide.title}</h3>
                <p className="mt-2 max-w-md text-xs text-white/85 sm:text-sm md:text-base">{slide.body}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* arrows */}
          <button
            onClick={() => go(-1)}
            aria-label="Previous"
            className="absolute left-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/30"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next"
            className="absolute right-3 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md transition-colors hover:bg-white/30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          {/* dots */}
          <div className="absolute bottom-5 right-5 flex gap-2 sm:bottom-7 sm:right-10">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`Slide ${i + 1}`}
                className={cn("h-2 rounded-full transition-all", i === idx ? "w-7 bg-white" : "w-2 bg-white/50 hover:bg-white/70")}
              />
            ))}
          </div>
        </div>
      </SectionReveal>
    </section>
  );
}
