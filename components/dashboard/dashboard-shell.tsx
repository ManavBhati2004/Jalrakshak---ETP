"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { DesktopSidebar } from "./sidebar";
import { Topbar } from "./topbar";
import { JalRakshakLogo } from "@/components/shared/logo";
import { useUIStore } from "@/lib/store/ui";
import { useAuthStore } from "@/lib/store/auth";
import { canAccessPath } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const role = useAuthStore((s) => s.role);
  const authReady = useAuthStore((s) => s.authReady);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!authReady) return;
    if (!role) {
      router.replace("/login");
      return;
    }
    // each role may only reach the routes it owns
    if (!canAccessPath(role, pathname)) {
      router.replace("/dashboard");
    }
  }, [authReady, role, router, pathname]);

  if (!authReady || !role) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-dash">
        <JalRakshakLogo size={44} />
        <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/2 animate-[shimmer_1.2s_linear_infinite] rounded-full bg-primary" />
        </div>
        <p className="text-sm text-muted-foreground">Loading command center…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dash text-foreground">
      <DesktopSidebar />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-300",
          collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]",
        )}
      >
        <Topbar />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
