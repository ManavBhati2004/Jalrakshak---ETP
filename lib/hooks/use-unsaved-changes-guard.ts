"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setNavigationGuard, shouldGuardClick } from "@/lib/navigation-guard";

/**
 * While `dirty`, ask before the user leaves the page:
 * - reloading or closing the tab shows the browser's own prompt;
 * - clicking a link to another page of the app (sidebar, top-bar menu, a back link) is held, and
 *   `pending` turns true so the caller can show its dialog;
 * - navigation started from code (Sign out, the search box) asks through `guardedNavigate`.
 *
 * `leave` carries out the held navigation; `stay` drops it. Browser Back is not held (the App Router
 * gives no reliable way to), which is why forms using this also keep a recovery copy.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const link = (e.target instanceof Element ? e.target.closest("a[href]") : null) as HTMLAnchorElement | null;
      if (!link) return;
      if (!shouldGuardClick(e, { href: link.href, target: link.target, download: link.hasAttribute("download") }, window.location.href)) return;
      // Captured before the link's own handler, which then sees the click was handled and stays put.
      e.preventDefault();
      const to = new URL(link.href);
      const href = to.pathname + to.search + to.hash;
      // Next frame, so a closing menu settles before the dialog opens.
      requestAnimationFrame(() => setPending(() => () => router.push(href)));
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    setNavigationGuard((go) => setPending(() => go));
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      setNavigationGuard(null);
    };
  }, [dirty, router]);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const go = pending;
    setPending(null);
    // Dropped first, so the navigation being carried out is not asked about again.
    setNavigationGuard(null);
    go?.();
  }, [pending]);

  return { pending: pending !== null, stay, leave };
}
