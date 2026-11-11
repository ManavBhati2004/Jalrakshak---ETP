import { create } from "zustand";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useDataStore } from "@/lib/store/data";
import { remoteApply } from "@/lib/data/firestore-storage";
import { clearAllRecovery } from "@/lib/data/registration-recovery";
import type { RoleId } from "@/lib/types";

interface Session {
  uid: string;
  role: RoleId;
  industryId: string | null;
  /** The name on the user's own profile ("" when none is on record). */
  name?: string;
}

interface AuthState {
  uid: string | null;
  role: RoleId | null;
  industryId: string | null; // set when an Industry (ETP) operator logs in
  /** The signed-in user's profile name, shown in the top bar and greetings ("" when none). */
  name: string;
  isAuthed: boolean;
  authReady: boolean; // true once Firebase has reported the initial auth state
  /** Called by the Firebase onAuthStateChanged listener (see StoreHydrator). */
  setSession: (session: Session | null) => void;
  /** After the user saves their profile, so every place showing the name follows at once. */
  setName: (name: string) => void;
  /** Optimistic set right after a successful sign-in/sign-up, for instant UI. */
  login: (role: RoleId, industryId?: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()((set) => ({
  uid: null,
  role: null,
  industryId: null,
  name: "",
  isAuthed: false,
  authReady: false,
  setSession: (session) =>
    session
      ? set({ uid: session.uid, role: session.role, industryId: session.industryId, name: session.name ?? "", isAuthed: true, authReady: true })
      : set({ uid: null, role: null, industryId: null, name: "", isAuthed: false, authReady: true }),
  setName: (name) => set({ name: name.trim() }),
  login: (role, industryId = null) => set({ role, industryId, isAuthed: true, authReady: true }),
  logout: () => {
    void signOut(auth);
    // No officer's unsaved registration stays behind in this tab.
    clearAllRecovery();
    // Clear the dataset from memory WITHOUT persisting — a persist here would
    // clobber the per-industry documents with the local seed.
    remoteApply.active = true;
    try {
      useDataStore.getState().resetData();
    } finally {
      remoteApply.active = false;
    }
    set({ uid: null, role: null, industryId: null, name: "", isAuthed: false });
  },
}));

export const isAdmin = (role: RoleId | null) => role === "monitoring-admin";
export const isEtp = (role: RoleId | null) => role === "etp";
