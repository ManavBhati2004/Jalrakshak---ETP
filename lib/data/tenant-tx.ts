/* ============================================================
   Per-unit read-modify-write, inside a Firestore transaction.

   The normal persistence path (`writeSlice`) blindly overwrites a unit's whole JSON blob from
   the local store. That is fine for the single-writer case it was built for, but not for
   operations that must re-check the CURRENT server state at write time: Approve All (has another
   officer already decided it?) and Sludge & Salt amendments (do not send stale copies of fields
   the operator did not touch). This helper reads the server's copy, lets a pure function patch
   it, and writes it back atomically; Firestore retries the whole thing if the doc changed in
   between.

   After commit the result is installed in the local store and the sync caches are told, so a
   later local change cannot blindly re-write the stale pre-transaction copy over it.
   ============================================================ */

import { doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isNewerThanKnown, lastWriteAt, markSynced, quiesceLocalWrites, shardByIndustry, type IndustrySlice } from "@/lib/data/firestore-storage";
import { useDataStore } from "@/lib/store/data";

export type TenantTxResult<R> = { ok: true; result: R; wrote: boolean } | { ok: false; error: string };

/** Thrown inside a mutation to abort the transaction with a message for the user. */
export class TenantTxAbort extends Error {}

/**
 * Patch one unit's slice against the server's current copy.
 *
 * `mutate` MUST be pure: Firestore may run it more than once if the document changes while the
 * transaction is in flight. Return `next: null` to finish without writing.
 */
export async function patchTenantSlice<R>(
  industryId: string,
  mutate: (slice: IndustrySlice) => { next: IndustrySlice | null; result: R },
): Promise<TenantTxResult<R>> {
  const ref = doc(db, "industries", industryId);
  // A local write still in flight would land AFTER this commit and overwrite it. Wait for every
  // earlier write to be acknowledged first; if that cannot happen (offline), refuse rather than race.
  if (!(await quiesceLocalWrites())) {
    return { ok: false, error: "Earlier changes are still syncing. Check your connection and try again." };
  }
  try {
    const out = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new TenantTxAbort("That unit no longer exists.");
      const raw = snap.data();
      let slice: IndustrySlice;
      try {
        slice = JSON.parse(String(raw.json)) as IndustrySlice;
      } catch {
        throw new TenantTxAbort("That unit's stored data could not be read.");
      }
      const { next, result } = mutate(slice);
      if (!next) return { result, json: null as string | null, updatedAt: 0, slice };
      const json = JSON.stringify(next);
      // Newer than anything this client or the server has seen, so every other client's
      // listener treats it as a fresh change rather than a stale echo.
      const updatedAt = Math.max(Date.now(), (lastWriteAt.get(industryId) ?? 0) + 1, Number(raw.updatedAt ?? 0) + 1);
      tx.update(ref, { json, updatedAt });
      return { result, json, updatedAt, slice: next };
    });
    // Install the result locally - unless a newer version already arrived, which must not be
    // rolled back. Same tick, no await in between, so nothing can interleave.
    if (out.json && isNewerThanKnown(industryId, out.updatedAt)) {
      useDataStore.getState().applyCommittedSlice(industryId, out.slice);
      // Cache EXACTLY what the next store write will serialise for this unit, so that write is
      // recognised as a no-op instead of re-sending (and possibly reverting) the committed doc.
      const own = shardByIndustry(useDataStore.getState()).get(industryId);
      markSynced(industryId, own ? JSON.stringify(own) : out.json, out.updatedAt);
    }
    return { ok: true, result: out.result, wrote: !!out.json };
  } catch (e) {
    if (e instanceof TenantTxAbort) return { ok: false, error: e.message };
    const code = (e as { code?: string }).code ?? "";
    if (code === "permission-denied") return { ok: false, error: "You do not have permission to change this unit's data." };
    if (code === "aborted" || code === "failed-precondition") return { ok: false, error: "The data changed while saving. Please try again." };
    return { ok: false, error: "Could not save. Check your connection and try again." };
  }
}
