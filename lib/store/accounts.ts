import { create } from "zustand";
import { initializeApp, deleteApp } from "firebase/app";
import { createUserWithEmailAndPassword, deleteUser, signInWithEmailAndPassword, signOut, updatePassword, getAuth } from "firebase/auth";
import { doc, getDoc, setDoc, getFirestore } from "firebase/firestore";
import { auth, db, firebaseConfig, connectEmulatorsIfEnabled } from "@/lib/firebase";
import type { RoleId } from "@/lib/types";

/**
 * Accounts are backed by Firebase Authentication (email/password). The user's
 * app profile (name, role, ETP industryId) lives in a Firestore `users/{uid}`
 * document. Demo logins (admin@rspcb.in / etp@demo.in) are seeded as real
 * Firebase Auth users.
 */
export interface Account {
  id: string; // Firebase Auth uid
  name: string;
  email: string;
  role: RoleId;
  industryId: string | null;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: RoleId;
  industryId: string | null;
}

type SignupResult = { ok: true; user: Account } | { ok: false; error: string };

interface AccountsState {
  signup: (input: SignupInput) => Promise<SignupResult>;
  authenticate: (email: string, password: string) => Promise<Account | null>;
}

function messageForCode(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/invalid-email":
      return "Enter a valid email.";
    case "auth/weak-password":
      return "Password must be at least 6 characters.";
    case "auth/network-request-failed":
      return "Network error — check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export const useAccountsStore = create<AccountsState>()(() => ({
  signup: async (input) => {
    const email = input.email.trim().toLowerCase();
    if (!input.name.trim()) return { ok: false, error: "Name is required." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Enter a valid email." };
    if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, input.password);
      const user: Account = {
        id: cred.user.uid,
        name: input.name.trim(),
        email,
        role: input.role,
        industryId: input.industryId,
      };
      await setDoc(doc(db, "users", cred.user.uid), {
        name: user.name,
        email: user.email,
        role: user.role,
        industryId: user.industryId,
      });
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: messageForCode((e as { code?: string }).code ?? "") };
    }
  },
  authenticate: async (email, password) => {
    const e = email.trim().toLowerCase();
    try {
      const cred = await signInWithEmailAndPassword(auth, e, password);
      const snap = await getDoc(doc(db, "users", cred.user.uid));
      const d = snap.exists() ? snap.data() : null;
      return {
        id: cred.user.uid,
        name: (d?.name as string) ?? cred.user.email ?? e,
        email: (d?.email as string) ?? e,
        role: (d?.role as RoleId) ?? "etp",
        industryId: (d?.industryId as string | null) ?? null,
      };
    } catch {
      return null;
    }
  },
}));

/**
 * Runs `fn` against a THROWAWAY secondary Firebase app whose auth session is fully
 * independent of the primary (admin) one — so the Monitoring Body can mint / re-auth an
 * operator account without ever signing itself out. Always tears the app down afterwards.
 */
async function withSecondaryApp<T>(fn: (secAuth: ReturnType<typeof getAuth>, secDb: ReturnType<typeof getFirestore>) => Promise<T>): Promise<T> {
  const name = `sec-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const secApp = initializeApp(firebaseConfig, name);
  const secAuth = getAuth(secApp);
  const secDb = getFirestore(secApp);
  // Must follow the primary app onto the emulators in local testing, or a registration under
  // test would create a real production account.
  connectEmulatorsIfEnabled(secAuth, secDb);
  try {
    return await fn(secAuth, secDb);
  } finally {
    await signOut(secAuth).catch(() => {});
    await deleteApp(secApp).catch(() => {});
  }
}

export interface RegisterUnitInput {
  name: string;
  email: string;
  password: string;
  /**
   * Runs in the ADMIN's primary session: create the industry owned by `ownerUid` and return it.
   * Must resolve only once the owned industry document is actually written: the profile link
   * below is checked by the rules against that document's `ownerUid`.
   */
  createIndustry: (ownerUid: string) => Promise<{ id: string; name: string }>;
}

/**
 * Monitoring-Body registration WITH login: creates the operator's Firebase account (via the
 * secondary app, so the admin stays signed in), writes its `users/{uid}` profile (`role: "etp"`),
 * has the admin create the owned industry, then links the profile to it.
 */
export async function registerUnitWithLogin(
  input: RegisterUnitInput,
): Promise<{ ok: true; created: { id: string; name: string } } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) return { ok: false, error: "Name is required." };
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };
  try {
    return await withSecondaryApp(async (secAuth, secDb) => {
      const cred = await createUserWithEmailAndPassword(secAuth, email, input.password);
      const uid = cred.user.uid;
      // Only the user themselves may create their profile (rules force role === "etp").
      await setDoc(doc(secDb, "users", uid), { name: input.name.trim(), email, role: "etp", industryId: null });
      // The admin (primary session) creates the industry doc, stamped with this operator's ownerUid.
      // Awaited: the rules only let a profile point at an industry whose ownerUid is this user,
      // so the link must not be sent before that document exists.
      const created = await input.createIndustry(uid);
      // Link the profile → industry (as the new user).
      await setDoc(doc(secDb, "users", uid), { industryId: created.id }, { merge: true });
      return { ok: true as const, created };
    });
  } catch (e) {
    return { ok: false, error: messageForCode((e as { code?: string }).code ?? "") };
  }
}

/**
 * Admin-only reset of a unit's login password. Client-only Firebase has no Admin SDK, so the
 * change goes through a reauthenticate (with the CURRENT password the admin set) + updatePassword
 * on the secondary app — the admin sets the new value, the primary session is untouched.
 */
export async function resetOperatorPassword(input: {
  email: string;
  currentPassword: string;
  newPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (input.newPassword.length < 6) return { ok: false, error: "New password must be at least 6 characters." };
  try {
    return await withSecondaryApp(async (secAuth) => {
      const cred = await signInWithEmailAndPassword(secAuth, email, input.currentPassword);
      await updatePassword(cred.user, input.newPassword);
      return { ok: true as const };
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") return { ok: false, error: "The current password is incorrect." };
    if (code === "auth/user-not-found") return { ok: false, error: "No login account exists for this unit's email." };
    return { ok: false, error: messageForCode(code) };
  }
}

/**
 * Monitoring-Body deletion of a unit together with its login. Client-only Firebase cannot delete
 * another user's account, so - as with a password reset - the officer gives the login's current
 * password and the login is signed in on the secondary app (the officer stays signed in). Order:
 *  1. sign in, and check the login really is this unit's: its profile link, or - if registration
 *     never completed that link - the ownerUid stamped on the unit. Nothing is deleted before this;
 *  2. `deleteUnit` (in the officer's own session) deletes the unit;
 *  3. only then is the login deleted. If that last step fails the unit stays deleted and
 *     `loginRemoved` is false.
 */
export async function deleteUnitWithLogin(input: {
  industryId: string;
  email: string;
  password: string;
  deleteUnit: () => Promise<{ ok: true } | { ok: false; error: string }>;
}): Promise<{ ok: true; loginRemoved: boolean } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: "Enter the login's email." };
  if (!input.password) return { ok: false, error: "Enter the login's password." };
  try {
    return await withSecondaryApp(async (secAuth, secDb) => {
      const cred = await signInWithEmailAndPassword(secAuth, email, input.password);
      const uid = cred.user.uid;
      const profile = await getDoc(doc(secDb, "users", uid));
      const linked = profile.exists() ? ((profile.data().industryId as string | null) ?? null) : null;
      if (linked !== input.industryId) {
        const unit = linked ? null : await getDoc(doc(db, "industries", input.industryId));
        if (unit?.data()?.ownerUid !== uid) {
          return {
            ok: false as const,
            error: linked ? `That login belongs to another unit (${linked}). Nothing was deleted.` : "That login is not this unit's. Nothing was deleted.",
          };
        }
      }
      const res = await input.deleteUnit();
      if (!res.ok) return res;
      try {
        await deleteUser(cred.user);
        return { ok: true as const, loginRemoved: true };
      } catch {
        return { ok: true as const, loginRemoved: false };
      }
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    // With email-enumeration protection Firebase answers a wrong password and an unknown email alike.
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
      return { ok: false, error: "The password is incorrect, or there is no login with this email. Nothing was deleted." };
    }
    if (code === "auth/too-many-requests") return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
    return { ok: false, error: messageForCode(code) };
  }
}
