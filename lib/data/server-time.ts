import { doc, setDoc, getDoc, serverTimestamp, type Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Trusted server time in ms, obtained by writing serverTimestamp() to the user's
 * own `serverClock/{uid}` doc and reading it back. The device clock is untrusted
 * (this is a client-only app), so this Firestore round-trip is the authority used
 * to detect date/time tampering on ETP submission. Best-effort: returns null if
 * offline or the write/read is denied, so the caller can skip the check silently.
 */
export async function getServerTime(uid: string): Promise<number | null> {
  try {
    const ref = doc(db, "serverClock", uid);
    await setDoc(ref, { t: serverTimestamp() });
    const snap = await getDoc(ref);
    const t = snap.get("t") as Timestamp | null;
    return t ? t.toMillis() : null;
  } catch {
    return null;
  }
}
