/* ============================================================
   A per-tab recovery copy of a registration form's unsaved changes.

   Browser Back cannot be held up in the App Router, so the form keeps its unsaved values in
   sessionStorage (this tab only) and offers them back when it is opened again. Never the login
   password: the copy goes through draftDataFrom, which leaves it out. Cleared when the form is
   saved, submitted or discarded, and on sign-out.
   ============================================================ */

import { draftDataFrom, type RegistrationValues } from "@/lib/data/registration";

const PREFIX = "jalrakshak-registration-recovery:";

export interface RecoveryCopy {
  at: string; // ISO
  data: Record<string, string>;
}

export function writeRecovery(key: string, values: RegistrationValues) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ at: new Date().toISOString(), data: draftDataFrom(values) } satisfies RecoveryCopy));
  } catch {
    // storage unavailable (private mode, quota): the copy is a convenience only
  }
}

export function readRecovery(key: string): RecoveryCopy | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RecoveryCopy>;
    return parsed && typeof parsed.at === "string" && parsed.data && typeof parsed.data === "object" ? (parsed as RecoveryCopy) : null;
  } catch {
    return null;
  }
}

export function clearRecovery(key: string) {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to clear
  }
}

/** On sign-out: no officer's unsaved registration stays behind in this tab. */
export function clearAllRecovery() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // nothing to clear
  }
}
