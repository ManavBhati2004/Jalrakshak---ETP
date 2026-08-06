"use client";

import {
  ShieldCheck,
  Gauge,
  Factory,
  HardHat,
  ClipboardCheck,
  Eye,
  LayoutDashboard,
  Building2,
  Waves,
  Zap,
  Droplets,
  CheckCircle2,
  BellRing,
  FileSpreadsheet,
  Settings,
  Clock,
  MinusCircle,
  TrendingUp,
  AlertOctagon,
  WifiOff,
  GitCompareArrows,
  Repeat,
  ImageOff,
  XCircle,
  AlarmClock,
  LifeBuoy,
  Megaphone,
  Send,
  Circle,
  type LucideIcon,
} from "lucide-react";

const REGISTRY: Record<string, LucideIcon> = {
  ShieldCheck,
  Gauge,
  Factory,
  HardHat,
  ClipboardCheck,
  Eye,
  LayoutDashboard,
  Building2,
  Waves,
  Zap,
  Droplets,
  CheckCircle2,
  BellRing,
  FileSpreadsheet,
  Settings,
  Clock,
  MinusCircle,
  TrendingUp,
  AlertOctagon,
  WifiOff,
  GitCompareArrows,
  Repeat,
  ImageOff,
  XCircle,
  AlarmClock,
  LifeBuoy,
  Megaphone,
  Send,
};

export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Cmp = REGISTRY[name] ?? Circle;
  return <Cmp className={className} strokeWidth={strokeWidth} />;
}
