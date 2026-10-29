"use client";

import { useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, type Unsubscribe } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuthStore } from "@/lib/store/auth";
import { useUIStore } from "@/lib/store/ui";
import { useDataStore, buildSeedState } from "@/lib/store/data";
import {
  remoteApply,
  syncContext,
  resetSyncCaches,
  loadAllIndustries,
  loadOneIndustry,
  loadRetiredUnits,
  subscribeAll,
  subscribeOne,
  seedIndustries,
  emptyData,
  type StoreData,
} from "@/lib/data/firestore-storage";
import type { RoleId } from "@/lib/types";

/**
 * Firebase drives auth + the per-tenant data store.
 * - onAuthStateChanged restores the session (role + industryId from users/{uid}).
 * - The dataset is sharded into per-industry documents (industries/{id}). The
 *   REGULATOR (monitoring-admin) loads and live-syncs EVERY industry; an ETP
 *   OPERATOR loads and live-syncs ONLY the unit bound to its profile. Tenant
 *   isolation is enforced by firestore.rules, so an operator can neither read
 *   other units' PII nor overwrite their regulatory data.
 * - On the first admin sign-in against an empty project the local seed dataset is
 *   written out as per-industry documents (regulator-only bootstrap).
 * - On sign-out the store is cleared to empty. The UI store stays on localStorage.
 */
export function StoreHydrator() {
  useEffect(() => {
    useUIStore.persist.rehydrate();

    // Apply a remote dataset to the store WITHOUT persisting it back.
    const applyData = (data: StoreData) => {
      remoteApply.active = true;
      try {
        useDataStore.setState(data);
      } finally {
        remoteApply.active = false;
      }
    };

    let unsub: Unsubscribe | null = null;
    const detach = () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
    };

    const setSession = useAuthStore.getState().setSession;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      detach();

      if (!fbUser) {
        setSession(null);
        syncContext.uid = null;
        syncContext.role = null;
        syncContext.industryId = null;
        syncContext.ready = false;
        resetSyncCaches();
        applyData(emptyData());
        return;
      }

      // 1) Profile (role + industryId). Defaults keep a broken/missing profile
      //    to the least-privileged role.
      let role: RoleId = "etp";
      let industryId: string | null = null;
      try {
        const snap = await getDoc(doc(db, "users", fbUser.uid));
        const d = snap.exists() ? snap.data() : null;
        role = (d?.role as RoleId) ?? "etp";
        industryId = (d?.industryId as string | null) ?? null;
      } catch {
        // best-effort — fall back to the operator default
      }
      setSession({ uid: fbUser.uid, role, industryId });

      // Suppress writes until the initial load finishes, so the store's seed
      // state can never clobber a real industry document.
      syncContext.uid = fbUser.uid;
      syncContext.role = role;
      syncContext.industryId = industryId;
      syncContext.ready = false;
      resetSyncCaches();

      // 2) Load the caller's authorized slice of the dataset.
      if (role === "monitoring-admin") {
        try {
          // Deleted units' ids: never issued again, and what tells a project whose units were all
          // deleted apart from a brand-new one (null = unknown, so never seed on a failed read).
          const retired = await loadRetiredUnits().catch(() => null);
          let { data, count } = await loadAllIndustries();
          if (count === 0 && retired === 0) {
            // First-ever admin sign-in against an empty project: bootstrap the
            // per-industry documents from the local seed (regulator-only write).
            await seedIndustries(buildSeedState());
            data = (await loadAllIndustries()).data;
          }
          applyData(data);
        } catch {
          // best-effort
        }
        unsub = subscribeAll((d) => applyData(d));
      } else if (industryId) {
        try {
          const data = await loadOneIndustry(industryId);
          applyData(data ?? emptyData());
        } catch {
          applyData(emptyData());
        }
        unsub = subscribeOne(industryId, (d) => applyData(d));
      } else {
        // Authenticated but not yet bound to an industry (e.g. mid self-registration).
        applyData(emptyData());
      }

      syncContext.ready = true;
    });

    return () => {
      unsubAuth();
      detach();
    };
  }, []);

  return null;
}
