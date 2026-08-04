"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Icon } from "@/components/shared/icon";
import { AnimatedCounter } from "@/components/shared/animated-counter";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: number;
  icon: string;
  accent?: string;
  suffix?: string;
  delta?: { value: string; positive?: boolean };
  hint?: string;
  index?: number;
  href?: string;
}

export function MetricCard({
  label,
  value,
  icon,
  accent = "#22d3ee",
  suffix,
  delta,
  hint,
  index = 0,
  href,
}: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/30 sm:p-5",
        href && "cursor-pointer hover:shadow-sm",
      )}
    >
      {href && (
        <Link href={href} className="absolute inset-0 z-10" aria-label={label} />
      )}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-15 blur-2xl transition-opacity group-hover:opacity-30"
        style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }}
      />
      <div className="flex items-start justify-between">
        <span
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `${accent}1f`, color: accent }}
        >
          <Icon name={icon} className="h-5 w-5" />
        </span>
        {delta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              delta.positive ? "bg-emerald-500/12 text-emerald-400" : "bg-amber-500/12 text-amber-400",
            )}
          >
            {delta.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {delta.value}
          </span>
        )}
      </div>
      <div className="mt-4 font-display text-2xl font-bold text-foreground sm:text-3xl">
        <AnimatedCounter value={value} suffix={suffix} startOnView={false} />
      </div>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground/70">{hint}</p>}
    </motion.div>
  );
}
