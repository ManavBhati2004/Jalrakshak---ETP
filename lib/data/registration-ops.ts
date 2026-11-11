/* ============================================================
   Registration records in Firestore (Monitoring Body).

   - registrationDrafts/{id}: unfinished registrations, shared by the officers. Never a password;
     `rev` steps by one on every save and the rules refuse a save from an older copy.
   - registrationReviews/{industryId}: the latest decision on a registered unit. Only the
     Monitoring Body writes it; the unit may read its own. Decisions and resubmissions run in one
     transaction with the unit's document (patchTenantSlice), so the two never disagree.
   ============================================================ */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { patchTenantSlice, TenantTxAbort } from "@/lib/data/tenant-tx";
import type { IndustrySlice } from "@/lib/data/firestore-storage";
import {
  applyRegistrationEdit,
  approveInSlice,
  draftDataFrom,
  draftTitle,
  registrationStatusOf,
  type RegistrationKey,
  type RegistrationValues,
} from "@/lib/data/registration";
import { REGISTRATION_STATUS_LABELS, type RegistrationDraft, type RegistrationReview, type RegistrationStatus } from "@/lib/types";

const draftsCol = () => collection(db, "registrationDrafts");
const reviewRef = (industryId: string) => doc(db, "registrationReviews", industryId);

const iso = (v: unknown) => (v instanceof Timestamp ? v.toDate().toISOString() : "");
const SESSION_EXPIRED = "Your session has expired. Sign in again.";
const OFFLINE = "Check your connection and try again.";

/* ---------------- Drafts ---------------- */

function draftFrom(id: string, d: Record<string, unknown>): RegistrationDraft {
  const data = d.data && typeof d.data === "object" ? (d.data as Record<string, unknown>) : {};
  return {
    id,
    data: Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    title: String(d.title ?? ""),
    rev: Number(d.rev ?? 0),
    createdAt: iso(d.createdAt),
    createdByUid: String(d.createdByUid ?? ""),
    updatedAt: iso(d.updatedAt),
    updatedByUid: String(d.updatedByUid ?? ""),
    updatedByEmail: String(d.updatedByEmail ?? ""),
  };
}

/** Live list of all drafts, newest first. `onError` fires if they cannot be read at all. */
export function subscribeRegistrationDrafts(onData: (drafts: RegistrationDraft[]) => void, onError: () => void): Unsubscribe {
  return onSnapshot(
    query(draftsCol(), orderBy("updatedAt", "desc")),
    (snap) => onData(snap.docs.map((d) => draftFrom(d.id, d.data({ serverTimestamps: "estimate" })))),
    onError,
  );
}

/** One draft, or `draft: null` if it no longer exists (submitted or deleted). */
export async function loadRegistrationDraft(id: string): Promise<{ ok: true; draft: RegistrationDraft | null } | { ok: false; error: string }> {
  try {
    const snap = await getDoc(doc(draftsCol(), id));
    return { ok: true, draft: snap.exists() ? draftFrom(snap.id, snap.data({ serverTimestamps: "estimate" })) : null };
  } catch {
    return { ok: false, error: `Could not load the draft. ${OFFLINE}` };
  }
}

/** Whether a draft still exists (null if that could not be checked). */
export async function registrationDraftExists(id: string): Promise<boolean | null> {
  try {
    return (await getDoc(doc(draftsCol(), id))).exists();
  } catch {
    return null;
  }
}

/**
 * Save a draft: a new one when `id` is null, else the next revision of the one loaded at `rev`.
 * The login password is never part of it.
 */
export async function saveRegistrationDraft(input: {
  id: string | null;
  rev: number;
  values: RegistrationValues;
}): Promise<{ ok: true; id: string; rev: number } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user?.email) return { ok: false, error: SESSION_EXPIRED };
  const data = draftDataFrom(input.values);
  const title = draftTitle(input.values);
  const stamp = { updatedAt: serverTimestamp(), updatedByUid: user.uid, updatedByEmail: user.email };
  try {
    if (!input.id) {
      const ref = doc(draftsCol());
      await setDoc(ref, { data, title, rev: 1, createdAt: serverTimestamp(), createdByUid: user.uid, ...stamp });
      return { ok: true, id: ref.id, rev: 1 };
    }
    await updateDoc(doc(draftsCol(), input.id), { data, title, rev: input.rev + 1, ...stamp });
    return { ok: true, id: input.id, rev: input.rev + 1 };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (input.id && (code === "permission-denied" || code === "not-found")) {
      // The rules refuse a save from an older copy: say which case this is.
      const now = await getDoc(doc(draftsCol(), input.id)).catch(() => null);
      if (now && !now.exists()) return { ok: false, error: "This draft was submitted or deleted by another officer, so it was not saved." };
      if (now?.exists() && Number(now.data().rev) !== input.rev) {
        const by = String(now.data().updatedByEmail || "Another officer");
        return { ok: false, error: `${by} saved this draft after you opened it, so yours was not saved. Reload the draft to see their changes.` };
      }
    }
    if (code === "permission-denied") return { ok: false, error: "You do not have permission to save registration drafts." };
    return { ok: false, error: `Could not save the draft. ${OFFLINE}` };
  }
}

export async function deleteRegistrationDraft(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(draftsCol(), id));
    return true;
  } catch {
    return false;
  }
}

/* ---------------- Reviews ---------------- */

function reviewFrom(snap: DocumentSnapshot | undefined): RegistrationReview | null {
  if (!snap?.exists()) return null;
  const r = snap.data({ serverTimestamps: "estimate" });
  return { status: r.status as RegistrationStatus, remark: String(r.remark ?? ""), at: iso(r.at), byUid: String(r.byUid ?? ""), byEmail: String(r.byEmail ?? "") };
}

/** Live view of every unit's latest decision (Monitoring Body). */
export function subscribeRegistrationReviews(onData: (byUnit: Record<string, RegistrationReview>) => void, onError: () => void): Unsubscribe {
  return onSnapshot(
    collection(db, "registrationReviews"),
    (snap) => {
      const out: Record<string, RegistrationReview> = {};
      for (const d of snap.docs) {
        const r = reviewFrom(d);
        if (r) out[d.id] = r;
      }
      onData(out);
    },
    onError,
  );
}

/**
 * Record that a new unit's registration was submitted, by whom and when. Best effort: without the
 * record the unit still counts as Submitted (it is pending).
 */
export async function markRegistrationSubmitted(industryId: string): Promise<boolean> {
  const user = auth.currentUser;
  if (!user?.email) return false;
  try {
    await setDoc(reviewRef(industryId), { status: "SUBMITTED", remark: "", at: serverTimestamp(), byUid: user.uid, byEmail: user.email });
    return true;
  } catch {
    return false;
  }
}

const label = (s: RegistrationStatus) => REGISTRATION_STATUS_LABELS[s].toLowerCase();

/**
 * Approve or reject a submitted registration. Re-checked against the server: a registration
 * another officer decided meanwhile is refused, not decided twice. Approving also makes a pending
 * unit active, in the same transaction.
 */
export async function decideRegistration(industryId: string, decision: "APPROVED" | "REJECTED", remark: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = auth.currentUser;
  const email = user?.email;
  if (!user || !email) return { ok: false, error: SESSION_EXPIRED };
  const note = remark.trim().slice(0, 500);
  if (decision === "REJECTED" && !note) return { ok: false, error: "Give the reason for rejecting it." };
  const ref = reviewRef(industryId);
  const res = await patchTenantSlice(
    industryId,
    (slice, also) => {
      if (!slice.industry) throw new TenantTxAbort("That unit no longer exists.");
      const current = registrationStatusOf(slice.industry, reviewFrom(also[0]));
      if (current !== "SUBMITTED") throw new TenantTxAbort(`This registration is already ${label(current)}, possibly by another officer.`);
      return {
        next: decision === "APPROVED" ? approveInSlice(slice) : null,
        result: null,
        also: (tx) => tx.set(ref, { status: decision, remark: note, at: serverTimestamp(), byUid: user.uid, byEmail: email }),
      };
    },
    { alsoRead: [ref] },
  );
  return res.ok ? { ok: true } : res;
}

/**
 * Save the Monitoring Body's edit of a registered unit: only the changed fields, refused if any of
 * them was changed elsewhere since the form opened. `resubmit` sends a rejected registration back
 * for approval in the same transaction.
 */
export async function saveRegistrationEdit(
  industryId: string,
  edit: { values: RegistrationValues; snapshot: RegistrationValues; changed: readonly RegistrationKey[]; resubmit: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = auth.currentUser;
  const email = user?.email;
  if (!user || !email) return { ok: false, error: SESSION_EXPIRED };
  if (!edit.changed.length && !edit.resubmit) return { ok: true };
  const ref = reviewRef(industryId);
  let failure: string | null = null;
  const res = await patchTenantSlice(
    industryId,
    (slice, also) => {
      failure = null; // reset per attempt: Firestore may re-run this on contention
      if (!slice.industry) throw new TenantTxAbort("That unit no longer exists.");
      let next: IndustrySlice | null = null;
      if (edit.changed.length) {
        const r = applyRegistrationEdit(slice, edit);
        if (!r.ok) {
          failure = r.error;
          return { next: null, result: null };
        }
        next = r.slice;
      }
      if (!edit.resubmit) return { next, result: null };
      const current = registrationStatusOf(slice.industry, reviewFrom(also[0]));
      if (current !== "REJECTED") {
        failure = `This registration is ${label(current)} now, not rejected (possibly changed by another officer). Reload the page.`;
        return { next: null, result: null };
      }
      return {
        next,
        result: null,
        also: (tx) => tx.set(ref, { status: "SUBMITTED", remark: "", at: serverTimestamp(), byUid: user.uid, byEmail: email }),
      };
    },
    { alsoRead: edit.resubmit ? [ref] : [] },
  );
  if (!res.ok) return res;
  if (failure) return { ok: false, error: failure };
  return { ok: true };
}
