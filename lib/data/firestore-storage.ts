import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  waitForPendingWrites,
  type Unsubscribe,
} from "firebase/firestore";
import type { StateStorage } from "zustand/middleware";
import { db } from "@/lib/firebase";
import type {
  Industry,
  FlowMeterReading,
  EtpEntry,
  Approval,
  Alert,
  ComplianceRecord,
  RoleId,
} from "@/lib/types";

/**
 * Per-tenant Firestore sync.
 *
 * The entire dataset used to live in ONE document (state/app) that every signed-in
 * user could read and overwrite — a broken-access-control + cross-tenant PII hole.
 * It is now SHARDED into one document per industry: `industries/{industryId}`, each
 * holding that industry's slice serialized as a `json` string plus the structured
 * `industryId` / `ownerUid` fields the Firestore rules scope on. The regulator
 * (monitoring-admin) reads/writes every industry; an ETP operator reads/writes only
 * the unit it owns. Isolation is enforced server-side by firestore.rules, not by
 * client trust.
 *
 * The zustand store keeps its flat, global shape (six arrays). This module is the
 * bridge: it shards the store on write and merges the docs the caller is allowed to
 * read on load — so none of the store's actions needed to change.
 */

/** The persisted data arrays of the store (no action functions). */
export interface StoreData {
  industries: Industry[];
  readings: FlowMeterReading[];
  etpEntries: EtpEntry[];
  approvals: Approval[];
  alerts: Alert[];
  compliance: ComplianceRecord[];
}

/** One industry's slice of the dataset. */
export interface IndustrySlice {
  industry: Industry | null;
  readings: FlowMeterReading[];
  etpEntries: EtpEntry[];
  approvals: Approval[];
  alerts: Alert[];
  compliance: ComplianceRecord | null;
}

const emptySlice = (): IndustrySlice => ({
  industry: null,
  readings: [],
  etpEntries: [],
  approvals: [],
  alerts: [],
  compliance: null,
});

export const emptyData = (): StoreData => ({
  industries: [],
  readings: [],
  etpEntries: [],
  approvals: [],
  alerts: [],
  compliance: [],
});

/**
 * When true, `setItem` is suppressed. StoreHydrator sets this while applying a
 * REMOTE snapshot to the store (and while clearing the store on logout) so those
 * changes are not written back to Firestore — preventing echo loops and, critically,
 * stopping a store reset from clobbering the shared docs.
 */
export const remoteApply = { active: false };

/**
 * Who the current caller is and whether the initial hydration has finished. Set by
 * StoreHydrator. `setItem` refuses to write until `ready` is true, so the store's
 * initial seed state can never overwrite a real industry document before we've had
 * a chance to load it.
 */
export const syncContext: {
  uid: string | null;
  role: RoleId | null;
  industryId: string | null;
  ready: boolean;
} = { uid: null, role: null, industryId: null, ready: false };

/** Per-doc timestamp of the most recent write we know about — used to ignore our
 *  own snapshot echoes and stale updates. */
export const lastWriteAt = new Map<string, number>();
/** Per-doc serialized slice we last wrote — used to skip redundant writes. */
const lastWrittenJson = new Map<string, string>();
/**
 * Ids of deleted units (`retiredUnits`). A deleted unit's id is never issued again: its operator's
 * profile still points at it (the link is write-once), so a new unit under that id would be theirs.
 * Loaded for the regulator at sign-in, and kept current as units are deleted - here or elsewhere.
 */
export const retiredUnitIds = new Set<string>();

export function resetSyncCaches() {
  lastWriteAt.clear();
  lastWrittenJson.clear();
  retiredUnitIds.clear();
}

/**
 * Record that `industries/{id}` now holds exactly `json` at `updatedAt`, written by a transaction
 * rather than by `writeSlice`. Both caches must move together:
 *  - `lastWrittenJson` so the next unrelated store change does not blindly rewrite this doc
 *    (it compares against what was last written, and the transaction wrote it, not writeSlice);
 *  - `lastWriteAt` so our own snapshot echo is not re-applied over the store as a foreign change.
 */
export function markSynced(id: string, json: string, updatedAt: number) {
  lastWrittenJson.set(id, json);
  lastWriteAt.set(id, updatedAt);
}

/* Write-loops still running. Each store change starts one; a transaction must not begin while one
   is mid-flight, because that loop holds a pre-transaction snapshot and would land it afterwards,
   blindly overwriting the commit. */
let inflightWalks = 0;
const idleWaiters: Array<() => void> = [];

/**
 * Wait until every local write has left AND been acknowledged by the server, so a transaction that
 * follows is the last word. Resolves false on timeout (e.g. offline) - the caller then refuses to
 * proceed rather than racing a write it cannot see.
 */
export async function quiesceLocalWrites(timeoutMs = 10_000): Promise<boolean> {
  const idle = inflightWalks === 0 ? Promise.resolve() : new Promise<void>((r) => idleWaiters.push(r));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((r) => {
    timer = setTimeout(() => r(false), timeoutMs);
  });
  try {
    return await Promise.race([idle.then(() => waitForPendingWrites(db)).then(() => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** True unless this client already holds a NEWER version of the doc than `updatedAt`. */
export function isNewerThanKnown(id: string, updatedAt: number): boolean {
  return updatedAt >= (lastWriteAt.get(id) ?? 0);
}

/** Group a flat dataset into per-industry slices, keyed by industryId. */
export function shardByIndustry(data: Partial<StoreData>): Map<string, IndustrySlice> {
  const map = new Map<string, IndustrySlice>();
  const slot = (id: string) => {
    let s = map.get(id);
    if (!s) {
      s = emptySlice();
      map.set(id, s);
    }
    return s;
  };
  (data.industries ?? []).forEach((i) => {
    slot(i.id).industry = i;
  });
  (data.readings ?? []).forEach((r) => {
    slot(r.industryId).readings.push(r);
  });
  (data.etpEntries ?? []).forEach((e) => {
    slot(e.industryId).etpEntries.push(e);
  });
  (data.approvals ?? []).forEach((a) => {
    slot(a.industryId).approvals.push(a);
  });
  (data.alerts ?? []).forEach((a) => {
    // Alerts always carry an industryId in practice; drop the (unused) null case
    // so a system alert can never leak into a tenant's document.
    if (a.industryId) slot(a.industryId).alerts.push(a);
  });
  (data.compliance ?? []).forEach((c) => {
    slot(c.industryId).compliance = c;
  });
  return map;
}

/** Merge per-industry slices back into a flat dataset for the store. */
export function mergeSlices(slices: IndustrySlice[]): StoreData {
  const data = emptyData();
  for (const s of slices) {
    if (s.industry) data.industries.push(s.industry);
    data.readings.push(...s.readings);
    data.etpEntries.push(...s.etpEntries);
    data.approvals.push(...s.approvals);
    data.alerts.push(...s.alerts);
    if (s.compliance) data.compliance.push(s.compliance);
  }
  return data;
}

function parseSlice(json: unknown): IndustrySlice | null {
  if (typeof json !== "string" || !json) return null;
  try {
    const s = JSON.parse(json) as IndustrySlice;
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}

/** Write one industry's slice to its document. Passing `ownerUid` stamps ownership
 *  (used once, at self-registration) and forces the write regardless of dedup. */
async function writeSlice(id: string, slice: IndustrySlice, ownerUid?: string) {
  const json = JSON.stringify(slice);
  if (ownerUid === undefined && lastWrittenJson.get(id) === json) return;
  lastWrittenJson.set(id, json);
  const at = Date.now();
  lastWriteAt.set(id, at);
  const payload: Record<string, unknown> = { json, industryId: id, updatedAt: at };
  if (ownerUid !== undefined) payload.ownerUid = ownerUid;
  try {
    await setDoc(doc(db, "industries", id), payload, { merge: true });
  } catch {
    // best-effort — persistence must never break the UI
  }
}

/**
 * zustand persist storage adapter. Hydration is driven explicitly by StoreHydrator
 * (getItem returns null); setItem shards the store and writes only the industry
 * documents the current caller is authorized to write.
 */
export const firestoreStorage: StateStorage = {
  getItem: async () => null,
  setItem: async (_name, value) => {
    if (remoteApply.active || !syncContext.ready) return;
    const { uid, role, industryId } = syncContext;
    if (!uid) return;
    let data: Partial<StoreData>;
    try {
      data = (JSON.parse(value).state ?? {}) as Partial<StoreData>;
    } catch {
      return;
    }
    const slices = shardByIndustry(data);
    inflightWalks++;
    try {
      for (const [id, slice] of slices) {
        const canWrite = role === "monitoring-admin" || id === industryId;
        if (!canWrite) continue; // rules would reject it anyway — skip the round-trip
        await writeSlice(id, slice);
      }
    } finally {
      if (--inflightWalks === 0) idleWaiters.splice(0).forEach((w) => w());
    }
  },
  removeItem: async () => {
    // no-op: we never delete the whole dataset
  },
};

/** Create/stamp an operator-owned industry document at self-registration time. */
export async function writeOwnedIndustry(data: Partial<StoreData>, industryId: string, ownerUid: string) {
  const slice = shardByIndustry(data).get(industryId) ?? emptySlice();
  await writeSlice(industryId, slice, ownerUid);
}

/** Seed every industry document from the local seed dataset (regulator-only; used
 *  the first time an admin signs in against an empty project). */
export async function seedIndustries(seed: StoreData) {
  const slices = shardByIndustry(seed);
  for (const [id, slice] of slices) {
    await writeSlice(id, slice);
  }
}

/** Load and merge every industry document (regulator). */
export async function loadAllIndustries(): Promise<{ data: StoreData; count: number }> {
  const snap = await getDocs(collection(db, "industries"));
  const slices: IndustrySlice[] = [];
  snap.forEach((d) => {
    const raw = d.data();
    lastWriteAt.set(d.id, (raw.updatedAt as number) ?? 0);
    // Prime the write-dedup cache so a later reconcile only writes docs that
    // actually changed (never rewrites — or clobbers — untouched tenants).
    if (typeof raw.json === "string") lastWrittenJson.set(d.id, raw.json);
    const s = parseSlice(raw.json);
    if (s) slices.push(s);
  });
  return { data: mergeSlices(slices), count: snap.size };
}

/** Load the ids of deleted units (regulator). Returns how many there are. */
export async function loadRetiredUnits(): Promise<number> {
  const snap = await getDocs(collection(db, "retiredUnits"));
  snap.forEach((d) => {
    retiredUnitIds.add(d.id);
  });
  return snap.size;
}

/** Load a single industry document (operator). */
export async function loadOneIndustry(industryId: string): Promise<StoreData | null> {
  const d = await getDoc(doc(db, "industries", industryId));
  if (!d.exists()) return null;
  const raw = d.data();
  lastWriteAt.set(industryId, (raw.updatedAt as number) ?? 0);
  if (typeof raw.json === "string") lastWrittenJson.set(industryId, raw.json);
  const s = parseSlice(raw.json);
  return s ? mergeSlices([s]) : emptyData();
}

/** Live listener over ALL industry documents (regulator). Rebuilds the dataset on
 *  any foreign change; skips pure echoes of our own writes. */
export function subscribeAll(onData: (data: StoreData) => void): Unsubscribe {
  return onSnapshot(collection(db, "industries"), (snap) => {
    let foreign = false;
    snap.docChanges().forEach((ch) => {
      // A deleted unit carries no newer stamp, so it is a change in itself: otherwise this session
      // would keep showing the unit - and write it back on its next store change.
      if (ch.type === "removed") {
        retiredUnitIds.add(ch.doc.id);
        foreign = true;
        return;
      }
      const at = (ch.doc.data().updatedAt as number) ?? 0;
      if (at > (lastWriteAt.get(ch.doc.id) ?? 0)) foreign = true;
    });
    if (!foreign) return;
    const slices: IndustrySlice[] = [];
    snap.forEach((d) => {
      const raw = d.data();
      lastWriteAt.set(d.id, (raw.updatedAt as number) ?? 0);
      if (typeof raw.json === "string") lastWrittenJson.set(d.id, raw.json);
      const s = parseSlice(raw.json);
      if (s) slices.push(s);
    });
    onData(mergeSlices(slices));
  });
}

/** Live listener over one industry document (operator). */
export function subscribeOne(industryId: string, onData: (data: StoreData) => void): Unsubscribe {
  return onSnapshot(doc(db, "industries", industryId), (d) => {
    if (!d.exists()) {
      // The Monitoring Body deleted this unit: clear it, so the operator is not left typing into a
      // unit whose saves can no longer land. Only a server-confirmed absence of a unit this session
      // had loaded counts - a unit not created yet, or a cache miss, changes nothing.
      if (!d.metadata.fromCache && lastWriteAt.has(industryId)) {
        lastWriteAt.delete(industryId);
        lastWrittenJson.delete(industryId);
        onData(emptyData());
      }
      return;
    }
    const raw = d.data();
    const at = (raw.updatedAt as number) ?? 0;
    if (at <= (lastWriteAt.get(industryId) ?? 0)) return; // our echo / stale
    lastWriteAt.set(industryId, at);
    if (typeof raw.json === "string") lastWrittenJson.set(industryId, raw.json);
    const s = parseSlice(raw.json);
    onData(s ? mergeSlices([s]) : emptyData());
  });
}
