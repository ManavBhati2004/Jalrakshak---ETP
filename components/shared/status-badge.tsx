import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "muted" | "cyan";

const TONE: Record<Tone, string> = {
  success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25",
  warning: "bg-amber-500/12 text-amber-600 dark:text-amber-400 ring-amber-500/25",
  danger: "bg-red-500/12 text-red-600 dark:text-red-400 ring-red-500/25",
  info: "bg-blue-500/12 text-blue-600 dark:text-blue-400 ring-blue-500/25",
  cyan: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300 ring-cyan-500/25",
  muted: "bg-muted text-muted-foreground ring-border",
};

const MAP: Record<string, Tone> = {
  // industry / generic
  active: "success",
  operational: "success",
  compliant: "success",
  approved: "success",
  resolved: "success",
  normal: "success",
  pending: "warning",
  warning: "warning",
  maintenance: "warning",
  verification: "info",
  submitted: "info",
  draft: "muted",
  acknowledged: "info",
  suspended: "danger",
  "non-reporting": "danger",
  "non-compliant": "danger",
  rejected: "danger",
  critical: "danger",
  alert: "danger",
  high: "danger",
  medium: "warning",
  low: "muted",
};

export function StatusBadge({
  status,
  label,
  className,
  dot = true,
}: {
  status: string;
  label?: string;
  className?: string;
  dot?: boolean;
}) {
  const tone = MAP[status] ?? "muted";
  const text = label ?? status.replace(/-/g, " ");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {text}
    </span>
  );
}
