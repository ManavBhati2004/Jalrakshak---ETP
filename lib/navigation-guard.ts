/* ============================================================
   Asking before leaving a form with unsaved changes.

   A form with unsaved changes registers a guard. Link clicks are caught by the form's hook (see
   use-unsaved-changes-guard.ts, which uses `shouldGuardClick`); navigation started from code - the
   top bar's Sign out and search - goes through `guardedNavigate`. Browser Back cannot be held up
   reliably in the App Router, so the registration form also keeps a recovery copy.
   ============================================================ */

type Guard = (proceed: () => void) => void;

let guard: Guard | null = null;

/** Install (or with null, remove) the guard for navigation started from code. */
export function setNavigationGuard(g: Guard | null) {
  guard = g;
}

/** Run `go` now, or once the user has decided, if a form with unsaved changes is open. */
export function guardedNavigate(go: () => void) {
  if (guard) guard(go);
  else go();
}

export interface ClickInfo {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export interface LinkInfo {
  /** The link's absolute URL. */
  href: string;
  target: string;
  download: boolean;
}

/**
 * Whether a click on a link would take the user to another page of this app in the same tab - the
 * case to ask about. A new tab, a download, another site, or a link to the page itself does not
 * lose the form, so those clicks go through.
 */
export function shouldGuardClick(e: ClickInfo, link: LinkInfo, here: string): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (link.download || (link.target && link.target !== "_self")) return false;
  let to: URL;
  let from: URL;
  try {
    to = new URL(link.href, here);
    from = new URL(here);
  } catch {
    return false;
  }
  if (to.origin !== from.origin) return false;
  if (to.protocol !== "http:" && to.protocol !== "https:") return false;
  return to.pathname + to.search !== from.pathname + from.search;
}
