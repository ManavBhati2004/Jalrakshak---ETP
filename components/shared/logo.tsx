import { cn } from "@/lib/utils";

export function JalRakshakLogo({
  className,
  size = 36,
  showText = true,
  tone = "auto",
}: {
  className?: string;
  size?: number;
  showText?: boolean;
  tone?: "auto" | "light" | "dark";
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-teal-500 to-cyan-600 shadow-sm"
        style={{ width: size, height: size }}
        aria-label="JalRakshak"
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.6}
          height={size * 0.6}
          fill="none"
          aria-hidden="true"
        >
          {/* water droplet */}
          <path
            d="M12 2.75c0 0-6.25 6.9-6.25 11.5a6.25 6.25 0 1 0 12.5 0C18.25 9.65 12 2.75 12 2.75Z"
            fill="white"
            fillOpacity="0.96"
          />
          {/* inner shine / meniscus */}
          <path
            d="M9.4 14.35a2.6 2.6 0 0 0 2.6 2.6"
            stroke="#0d9488"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {showText && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-[15px] font-extrabold tracking-tight",
              tone === "light" && "text-white",
              tone === "dark" && "text-slate-900",
              tone === "auto" && "text-foreground",
            )}
          >
            JalRakshak
          </span>
          <span
            className={cn(
              "text-[9.5px] font-semibold uppercase tracking-[0.18em]",
              tone === "light" ? "text-white/70" : "text-primary",
            )}
          >
            ETP Monitoring
          </span>
        </span>
      )}
    </div>
  );
}
