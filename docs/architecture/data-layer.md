# Data Layer & Sync (Zustand stores + per-tenant Firestore)

> RSPCB **JalRakshak — ETP**. A client-only Next.js app whose backend is Firebase
> spoken to directly from the browser. This document describes the **data layer**:
> the four Zustand stores, every data-store action, the persist configuration, the
> derived selectors, and the `firestore-storage` bridge that shards the store into
> **one Firestore document per industry** and merges it back on read — plus the
> `StoreHydrator` component that wires Firebase Auth to a role-scoped load.

---

## Overview

### What it is

The app holds **all application state in memory** as Zustand stores. There is no
API server; the browser talks to Firebase Auth and Firestore directly. Persistence
and multi-user sync are handled entirely by a custom Zustand `persist` **storage
adapter** (`firestoreStorage`) plus an explicit hydration component (`StoreHydrator`).

The data store keeps a **flat, global shape** — six arrays (`industries`,
`readings`, `etpEntries`, `approvals`, `alerts`, `compliance`). None of the store's
actions know anything about Firestore. The `firestore-storage` module is the sole
bridge: on **write** it *shards* the flat store into per-industry slices and writes
only the documents the caller is authorized to write; on **read** it *merges* the
documents the caller is allowed to read back into the flat shape.

### Why per-tenant sharding

The entire dataset originally lived in **one** document, `state/app`, that every
signed-in user could read and overwrite — a broken-access-control + cross-tenant PII
hole (see the header comment in `lib/data/firestore-storage.ts:22-37`). It is now
**sharded into one document per industry**: `industries/{industryId}`. Each document
stores that industry's slice serialized as a `json` string, plus the structured
`industryId` and `ownerUid` fields the Firestore rules scope on.

- **`monitoring-admin`** (the RSPCB "Monitoring Body" regulator) reads/writes **every**
  industry document and live-syncs the whole collection.
- **`etp`** (an operator) reads/writes **only** the one industry it owns and live-syncs
  just that document.

Isolation is enforced **server-side** by `firestore.rules`, not by client trust. The
client-side write filter in `setItem` is an optimization (skip round-trips the rules
would reject), not the security boundary.

### The two-way echo problem it solves

Because the same store both *drives* Firestore writes and *receives* Firestore
snapshots, naive wiring would loop: a remote snapshot → `setState` → persist →
write → snapshot → … The bridge breaks this with three coordinated flags/caches:
`remoteApply.active` (suppress writes while applying a remote snapshot),
`syncContext.ready` (refuse writes until the initial load finishes so the local seed
never clobbers real docs), and `lastWriteAt` / `lastWrittenJson` (ignore snapshot
echoes of our own writes and skip redundant writes).

---

## Files

| Path | Role |
|------|------|
| `lib/store/data.ts` | The core **data store** (`useDataStore`): six arrays + every mutating action; persisted through `firestoreStorage`. Also exports the derived selectors `selectMetrics`, `dailyIntake`, and `buildSeedState`. |
| `lib/store/auth.ts` | The **auth/session store** (`useAuthStore`): `uid`, `role`, `industryId`, `isAuthed`, `authReady`. Not persisted (Firebase is the source of truth). Owns the sign-out flow. |
| `lib/store/ui.ts` | The **UI store** (`useUIStore`): sidebar/mobile-nav/active-CETP view state. Persisted to **localStorage** (the only store that is). |
| `lib/store/accounts.ts` | The **accounts store** (`useAccountsStore`): thin wrapper over Firebase Auth — `signup` (creates the auth user + `users/{uid}` profile) and `authenticate` (sign in + read profile). Holds no state. |
| `lib/data/firestore-storage.ts` | The **sync bridge**: `StoreData`/`IndustrySlice` types, `shardByIndustry`/`mergeSlices`/`writeSlice`, the `firestoreStorage` persist adapter, the `syncContext`/`remoteApply`/`lastWriteAt` echo-suppression state, and the load/subscribe/seed functions. |
| `components/shared/store-hydrator.tsx` | The **hydration wiring** (`StoreHydrator`): a client component mounted once that subscribes to `onAuthStateChanged`, loads the profile, sets `syncContext`, does the role-scoped load + live subscription, and clears everything on sign-out. |
| `lib/firebase.ts` | Firebase app init — exports the shared `firebaseApp`, `auth`, and `db` singletons (guarded against re-init on fast refresh). |

Supporting (referenced, not the subject): `lib/types.ts` (domain types),
`lib/constants.ts` (`ALERT_META`, `complianceStatus`), `lib/data/seed.ts` (local seed
builders), `lib/utils.ts` (`displayUnit`), `firestore.rules` (the security boundary).

---

## How it works

### The four stores at a glance

```
useAuthStore    session identity (uid, role, industryId) — mirrors Firebase, not persisted
useDataStore    the dataset (6 arrays) + actions        — persisted via firestoreStorage → Firestore
useUIStore      view prefs (sidebar, activeCetp)         — persisted via localStorage
useAccountsStore signup / authenticate (stateless)       — talks straight to Firebase Auth + users/{uid}
```

Only `useDataStore` and `useUIStore` use the `persist` middleware. `useAuthStore`
and `useAccountsStore` are plain stores; Firebase is authoritative for identity, so
persisting the session locally would risk drift.

### Firestore document model

```
users/{uid}                     ← one per account
  { name, email, role, industryId }

industries/{industryId}         ← one per tenant (the shard)
  { json:      "<stringified IndustrySlice>",
    industryId: "IND-003",
    ownerUid:   "<auth uid>"     (present only on operator self-registered docs)
    updatedAt:  <epoch ms> }     (write timestamp, drives echo suppression)
```

An `IndustrySlice` (the shape inside `json`) is one tenant's cut of the dataset:
`{ industry, readings[], etpEntries[], approvals[], alerts[], compliance }`
(`lib/data/firestore-storage.ts:50-57`).

### Write path (store → Firestore)

Any action that calls `set(...)` mutates the store; the `persist` middleware then
calls `firestoreStorage.setItem` with the serialized state (`setItem`,
`firestore-storage.ts:191-207`). `setItem`:

1. **Bails** if `remoteApply.active` (we're applying a remote snapshot) or
   `!syncContext.ready` (initial load not done) or there is no `uid`. This is the
   guard that stops the local seed from ever clobbering real docs.
2. Parses `JSON.parse(value).state` into a `Partial<StoreData>`.
3. `shardByIndustry(data)` groups the flat arrays into a `Map<industryId, IndustrySlice>`.
4. For each slice, computes `canWrite = role === "monitoring-admin" || id === industryId`
   and **skips** the ones it can't write (`firestore-storage.ts:203-204`) — the rules
   would reject them anyway.
5. `writeSlice(id, slice)` stringifies the slice, **dedups** against
   `lastWrittenJson` (skip if unchanged), stamps `lastWriteAt[id] = Date.now()`, and
   `setDoc(..., { merge: true })`. Wrapped in try/catch — *persistence must never
   break the UI* (`firestore-storage.ts:177-181`).

### Read path (Firestore → store)

Driven entirely by `StoreHydrator`, never by the persist adapter (`getItem` always
returns `null`, `firestore-storage.ts:190`). The `applyData` helper wraps every
remote → store application in `remoteApply.active = true` so the resulting `setState`
does **not** persist back (`store-hydrator.tsx:41-48`).

- **Admin:** `loadAllIndustries()` → `getDocs(collection("industries"))` → parse each
  `json` → `mergeSlices` → flat `StoreData`. Then `subscribeAll` keeps it live.
- **Operator:** `loadOneIndustry(industryId)` → `getDoc(doc("industries", id))` →
  `mergeSlices([slice])`. Then `subscribeOne` keeps it live.

### Echo suppression (why snapshots don't loop)

Every write records `lastWriteAt[id] = Date.now()` and `updatedAt` in the doc. The
snapshot listeners compare the incoming `updatedAt` to the remembered `lastWriteAt`:

- `subscribeAll` inspects `snap.docChanges()`; if **no** changed doc has
  `updatedAt > lastWriteAt` it treats the batch as a pure echo and returns early
  (`firestore-storage.ts:259-264`).
- `subscribeOne` returns early when `updatedAt <= lastWriteAt` (our echo or stale,
  `firestore-storage.ts:283`).

Only genuinely *foreign* changes (a newer `updatedAt` than we wrote) rebuild the store.

### End-to-end data flow: auth → store → Firestore

```
                                   FIREBASE AUTH
                                        │  onAuthStateChanged(fbUser)
                                        ▼
                            ┌──────────────────────────┐
                            │      StoreHydrator        │  (mounted once)
                            └──────────────────────────┘
                                        │
       ┌───────────── fbUser == null ───┴──── fbUser present ─────────────┐
       ▼                                                                   ▼
  setSession(null)                                     getDoc(users/{uid}) → { role, industryId }
  syncContext.* = null/false                           setSession({uid, role, industryId})
  resetSyncCaches()                                    syncContext = {uid,role,industryId, ready:FALSE}
  applyData(emptyData())                               resetSyncCaches()
       │                                                                   │
       ▼                                    ┌─────────────── role? ────────┴──────────────┐
   store empty                              ▼ monitoring-admin                             ▼ etp + industryId
                                   loadAllIndustries()                          loadOneIndustry(industryId)
                                   (count==0 → seedIndustries(                  getDoc(industries/{id})
                                    buildSeedState()) then reload)                     │
                                        │                                              │
                                        ▼                                              ▼
                                   applyData(data) ── remoteApply.active ──► useDataStore.setState(data)
                                        │              (write suppressed)             │
                                   unsub = subscribeAll(applyData)          unsub = subscribeOne(id, applyData)
                                        │                                              │
                                        └──────────────► syncContext.ready = TRUE ◄────┘
                                                                 │
   ── from here, USER ACTIONS mutate the store ─────────────────┤
                                                                 ▼
   useDataStore action → set(...)  ──persist──►  firestoreStorage.setItem(state)
                                                     │  guarded by remoteApply / syncContext.ready / uid
                                                     ▼
                                            shardByIndustry(state)
                                                     │  per industryId
                                                     ▼
                                    canWrite? (admin || id===industryId)
                                                     │ yes
                                                     ▼
                                    writeSlice → setDoc(industries/{id}, {json, updatedAt, ...})
                                                     │
                                                     ▼
                                              FIRESTORE
                                                     │  onSnapshot
                                                     ▼
                                    subscribeAll / subscribeOne
                                       updatedAt > lastWriteAt ?  ── no ──► ignore (echo/stale)
                                                     │ yes (foreign change)
                                                     ▼
                                        applyData(mergeSlices(...)) → back into the store
```

### Sign-out flow

Two things clear on sign-out, in two places:

1. `useAuthStore.logout()` (`auth.ts:38-49`) calls `signOut(auth)`, then wraps
   `resetData()` in `remoteApply.active = true`/`finally false` so clearing the store
   does **not** persist (a persist here would clobber the shared docs with the local
   seed), then zeroes the session fields.
2. The `onAuthStateChanged` listener also fires with `fbUser == null` and runs the
   null branch (`store-hydrator.tsx:63-72`): `setSession(null)`, null out
   `syncContext.*` + `ready=false`, `resetSyncCaches()`, `applyData(emptyData())`,
   and `detach()` the live subscription. This is the authoritative teardown even if
   sign-out originates elsewhere (session expiry, another tab).

### First-run bootstrap (regulator-only seed)

On the **first** admin sign-in against an empty project, `loadAllIndustries()`
returns `count === 0`; `StoreHydrator` then writes the local seed out as per-industry
documents via `seedIndustries(buildSeedState())` and reloads (`store-hydrator.tsx:100-104`).
Operators never seed — an operator with no `industryId` yet just gets `emptyData()`
(`store-hydrator.tsx:119-122`).

---

## Reference

### `lib/store/data.ts`

#### Input types (action payloads)

| Type | Purpose |
|------|---------|
| `ReadingInput` (`:27`) | Payload for `submitReading` — a CETP flow-meter reading. |
| `RegisterInput` (`:41`) | Payload for `registerIndustry` — a self-registering ETP unit. |
| `EtpEntryInput` (`:61`) | Payload for `submitEtpEntry` — a daily ETP water-balance entry. |

#### `DataState` (`:74`) — store shape

State arrays: `industries`, `readings`, `etpEntries`, `approvals`, `alerts`,
`compliance`. Actions: `submitReading`, `submitEtpEntry`, `raiseEtpInletAlert`,
`decideApproval`, `registerIndustry`, `acknowledgeAlert`, `resolveAlert`, `resetData`.

#### Helpers

- `seed()` (`:91`) — builds the full local seed `StoreData` from `lib/data/seed.ts`
  builders (`buildReadings`, `buildEtpEntries`, `buildApprovals`, `buildEtpApprovals`,
  `buildAlerts`, `buildCompliance`). Also spreads into the store's initial state at
  `:125` and is the target of `resetData` and the `migrate` fallback.
- `buildSeedState()` (`:106`) — public wrapper over `seed()`, used by `StoreHydrator`
  for the first-run regulator bootstrap.
- `nowISO()` (`:110`) — `new Date().toISOString()`.
- `isLateFor(readingTime)` (`:114`) — late if a morning reading is after 08:30 or an
  evening reading is after 20:30.

#### Actions — effects

| Action | Signature | Effect |
|--------|-----------|--------|
| **`submitReading`** (`:127`) | `(input: ReadingInput) => { reading, alerts: AlertType[] }` | Builds a `FlowMeterReading` (id `R-<base36>`, `difference = current − previous`, `shift` from the hour, `isLate` from `isLateFor`, `status:"pending"`). Derives alerts: `late-submission` if late; `zero-reading` if `difference===0` (non-energy); `capacity-exceeded` if `difference > permittedKLD` else `high-flow` if `> permittedKLD*0.85` (non-energy); `missing-photo` if `!hasPhoto` (`:158-163`). Builds an `Approval` (stage `submitted`, 3-step timeline). `set`: prepends the reading, approval, and new alerts; bumps the industry's `lastReadingAt` + `alertsCount` (`:202-209`). Returns `{ reading, alerts: fired }`. |
| **`submitEtpEntry`** (`:214`) | `(input: EtpEntryInput) => { entry, alerts: AlertType[] }` | Builds an `EtpEntry` (id `E-<base36>`, `unit:"KL"`, `status:"pending"`, **`totalWaterIntake = freshWaterConsumption + etpReuse + roPermeate`**, `:216`). Alerts: `zero-reading` if total===0; `capacity-exceeded` if `total > permittedKLD` else `high-flow` if `> permittedKLD*0.85` (`:239-242`). Builds an `Approval` (`meterPoint:"ETP Water Balance"`, `difference: totalWaterIntake`, submitter = `industry.contactPerson`). `set`: prepends entry, approval, alerts; bumps industry `lastReadingAt` + `alertsCount`. Returns `{ entry, alerts: fired }`. |
| **`raiseEtpInletAlert`** (`:296`) | `(industryId, etpInlet) => void` | Standalone alert with **no** approval and no entry — fired when the ETP-entry form blocks a submission because ETP Inlet exceeds sanctioned ETP capacity. Creates a `capacity-exceeded` alert (id `AL-<base36>-INLET`, message quotes `etpInlet` m³ vs `etpCapacity` KLD) and bumps `alertsCount`. No-op if the industry is not found (`:298`). |
| **`decideApproval`** (`:321`) | `(id, decision: "approved"\|"rejected", reviewer) => void` | Finds the approval; sets its `stage`, `reviewedAt`, `reviewer`, and rewrites the 3-step `timeline` (all `done:true`). Propagates the decision to the matching `readings` row **and** the matching `etpEntries` row via `approval.readingId` (`:367-372`) — one action covers both entry kinds. On `rejected`, prepends a `rejected-entry` alert (`:326-343`). |
| **`registerIndustry`** (`:378`) | `(input: RegisterInput) => Industry` | Derives the next id from the **highest existing `IND-###`** number (not array length, so ids never collide with seed ids or after a merge, `:381-385`). Builds an `Industry` (`status:"pending"`, `isIndividualETP = cetpId === null`, `complianceScore:75`, `contactPerson = ownerName`, `registeredAt` = today `YYYY-MM-DD`). `set`: prepends the industry and a seeded `ComplianceRecord` (score 75, flat 6-month trend). Returns the new `Industry`. |
| **`acknowledgeAlert`** (`:433`) | `(id) => void` | Sets the alert's `status:"acknowledged"`. |
| **`resolveAlert`** (`:435`) | `(id) => void` | Sets the alert's `status:"resolved"`. |
| **`resetData`** (`:438`) | `() => void` | `set({ ...seed() })` — replaces the whole dataset with a fresh local seed. Used by `logout` (wrapped in `remoteApply`) and the `migrate` fallback. |

> **id note:** `submitReading`/`submitEtpEntry` derive both the record id and the
> approval id from `Date.now().toString(36)`; back-to-back calls in the same
> millisecond can collide. Fine for this demo scale, worth knowing.

#### Persist config (`:440-449`)

| Key | Value | Meaning |
|-----|-------|---------|
| `name` | `"jalrakshak-data"` | Storage key passed to the adapter (unused by Firestore, but required). |
| `version` | `4` | Schema version. |
| `skipHydration` | `true` | `persist` does **not** auto-hydrate on load; `StoreHydrator` drives hydration explicitly. |
| `storage` | `createJSONStorage(() => firestoreStorage)` | The custom Firestore adapter, not localStorage. |
| `migrate` | `(persisted, version) => version < 4 ? seed() : persisted` | Anything older than v4 is reset to the current seed (older deploys lacked ETP/CETP data). Note: mostly moot because `getItem` returns `null`. |

#### Selectors

- `DashboardMetrics` (`:454`) — `{ totalIndustries, pendingApprovals, rejectedEntries, nonReporting, activeAlerts }`.
- **`selectMetrics(s)`** (`:473`) — `totalIndustries` = count; `pendingApprovals` =
  approvals in stage `submitted` **or** `verification`; `rejectedEntries` = stage
  `rejected`; `nonReporting` = industries with `status:"non-reporting"`;
  `activeAlerts` = alerts with `status:"active"`.
- **`dailyIntake(entries, todayStr, yesterdayStr)`** (`:467`) — time-synced daily
  intake keyed on the stored entry **date** (`YYYY-MM-DD`), so "today" rolls into
  "yesterday" when the calendar day changes. Returns `{ today, yesterday, difference }`
  from each day's `totalWaterIntake` (missing day ⇒ 0).

### `lib/store/auth.ts`

- `Session` (`:8`) — `{ uid, role, industryId }`.
- `AuthState` (`:14`) — `uid`, `role`, `industryId`, `isAuthed`, `authReady` +
  `setSession`, `login`, `logout`.
- **`setSession(session)`** (`:33`) — called by the `onAuthStateChanged` listener.
  Non-null → set all fields + `isAuthed:true`, `authReady:true`; null → clear all +
  `authReady:true`.
- **`login(role, industryId = null)`** (`:37`) — optimistic set right after a
  successful sign-in/sign-up for instant UI (before the auth listener fires).
- **`logout()`** (`:38`) — `signOut(auth)`; then `remoteApply.active = true` around
  `useDataStore.getState().resetData()` (clear memory **without** persisting), then
  zero the session. `authReady` is intentionally left as-is here.
- `isAdmin(role)` (`:52`) = `role === "monitoring-admin"`; `isEtp(role)` (`:53`) =
  `role === "etp"`.

> This store is **not** persisted — Firebase Auth is the source of truth; the session
> is rebuilt on every load from `onAuthStateChanged`.

### `lib/store/ui.ts`

- `UIState` (`:5`) — `sidebarCollapsed`, `mobileNavOpen`, `activeCetp: CetpId|null`
  + `toggleSidebar`, `setMobileNav`, `setActiveCetp`.
- Persist config (`:24-29`): `name:"jalrakshak-etp-ui"`, `version:1`,
  `skipHydration:true` (rehydrated by `StoreHydrator` via
  `useUIStore.persist.rehydrate()`), `partialize` → persists only `sidebarCollapsed`
  and `activeCetp` (**not** `mobileNavOpen`). Default `persist` storage =
  **localStorage** — this is the only store that touches localStorage.

### `lib/store/accounts.ts`

- `Account` (`:13`) — `{ id (auth uid), name, email, role, industryId }`.
- `SignupInput` (`:21`), `SignupResult` (`:29`) = `{ ok:true, user } | { ok:false, error }`.
- **`signup(input)`** (`:52`) — validates name/email/password locally, then
  `createUserWithEmailAndPassword`, then `setDoc(users/{uid}, {name,email,role,industryId})`.
  Returns `{ok:true,user}` or `{ok:false,error}` (Firebase error mapped by
  `messageForCode`). *Note:* the rules force a created profile's `role` to `"etp"`
  (`firestore.rules:36-37`) regardless of what the client sends.
- **`authenticate(email, password)`** (`:77`) — `signInWithEmailAndPassword`, then
  `getDoc(users/{uid})` for the profile; returns an `Account` (role defaults to
  `"etp"`, industryId to `null` if the profile is missing) or `null` on failure.
- `messageForCode(code)` (`:36`) — maps Firebase auth error codes to user copy.
- The store holds **no state** — `create<AccountsState>()(() => ({ ... }))`.

### `lib/data/firestore-storage.ts`

#### Types

- **`StoreData`** (`:40`) — the persisted data arrays (no actions): the six arrays.
- **`IndustrySlice`** (`:50`) — one tenant's cut:
  `{ industry: Industry|null, readings[], etpEntries[], approvals[], alerts[], compliance: ComplianceRecord|null }`.
- `emptySlice()` (`:59`), `emptyData()` (`:68`) — zero-value factories.

#### Sync state (module-level, mutable)

| Export | Type | Role |
|--------|------|------|
| **`remoteApply`** (`:83`) | `{ active: boolean }` | When `true`, `setItem` is suppressed. Set while applying a remote snapshot **and** while clearing on logout — stops echo loops and stops a store reset from clobbering shared docs. |
| **`syncContext`** (`:91`) | `{ uid, role, industryId, ready }` | Who the caller is + whether initial hydration finished. `setItem` refuses to write until `ready` is `true`. Set by `StoreHydrator`. |
| **`lastWriteAt`** (`:100`) | `Map<docId, epochMs>` | Timestamp of the most recent write we know about per doc — the basis for echo/stale suppression. |
| `lastWrittenJson` (`:102`) | `Map<docId, string>` | Last serialized slice we wrote per doc — used to skip redundant writes (private). |
| **`resetSyncCaches()`** (`:104`) | `() => void` | Clears both maps. Called on every auth transition so a new session starts clean. |

#### Sharding / merging

- **`shardByIndustry(data)`** (`:110`) — groups a `Partial<StoreData>` into
  `Map<industryId, IndustrySlice>`. Industries key by `id`; readings/etpEntries/
  approvals/alerts by `industryId`; compliance by `industryId`. **Alerts with a null
  `industryId` are dropped** (`:132-136`) so a system alert can never leak into a
  tenant's document.
- **`mergeSlices(slices)`** (`:144`) — inverse: concatenates all slices back into a
  flat `StoreData` (skips null `industry`/`compliance`).
- `parseSlice(json)` (`:157`) — safe `JSON.parse` of a slice string → `IndustrySlice`
  or `null`.
- **`writeSlice(id, slice, ownerUid?)`** (`:169`) — stringifies the slice; if
  `ownerUid` is omitted **and** the json equals `lastWrittenJson[id]`, returns early
  (dedup). Otherwise records `lastWrittenJson`/`lastWriteAt`, builds
  `{ json, industryId, updatedAt }` (plus `ownerUid` when provided), and
  `setDoc(doc(db,"industries",id), payload, { merge:true })` inside try/catch.
  Passing `ownerUid` (self-registration) **forces** the write regardless of dedup.

#### The persist adapter — `firestoreStorage` (`:189`, `StateStorage`)

| Method | Behavior |
|--------|----------|
| `getItem` (`:190`) | Always returns `null` — hydration is driven explicitly by `StoreHydrator`, never by `persist`. |
| `setItem` (`:191`) | Guarded (`remoteApply.active` / `!syncContext.ready` / no `uid` → bail). Parses `.state`, `shardByIndustry`, and for each slice writes only if `role === "monitoring-admin" || id === industryId`. |
| `removeItem` (`:208`) | No-op — the whole dataset is never deleted. |

#### Load / subscribe / seed functions

| Function | Signature | Role |
|----------|-----------|------|
| **`writeOwnedIndustry(data, industryId, ownerUid)`** (`:214`) | `Promise<void>` | Create/stamp an operator-owned industry doc at self-registration — extracts the slice and calls `writeSlice(..., ownerUid)` (forced write, sets `ownerUid`). |
| **`seedIndustries(seed)`** (`:221`) | `Promise<void>` | Regulator-only bootstrap: shard the local seed and `writeSlice` every industry doc. |
| **`loadAllIndustries()`** (`:229`) | `Promise<{ data, count }>` | Regulator load: `getDocs(collection("industries"))`, prime `lastWriteAt`/`lastWrittenJson` per doc (so a later reconcile only rewrites *changed* docs), parse + `mergeSlices`. `count` = `snap.size` (drives the first-run seed check). |
| **`loadOneIndustry(industryId)`** (`:245`) | `Promise<StoreData\|null>` | Operator load: `getDoc(doc("industries", id))`; `null` if absent; prime caches; `mergeSlices([slice])` (or `emptyData()`). |
| **`subscribeAll(onData)`** (`:257`) | `Unsubscribe` | Live listener over the whole collection. Ignores batches with no `updatedAt > lastWriteAt` change (echo); otherwise rebuilds + `onData(mergeSlices(...))`. |
| **`subscribeOne(industryId, onData)`** (`:278`) | `Unsubscribe` | Live listener over one doc. Ignores when `updatedAt <= lastWriteAt` (echo/stale); otherwise updates caches + `onData(mergeSlices([slice]))`. |

### `components/shared/store-hydrator.tsx` — `StoreHydrator` (`:36`)

A client component returning `null`; mount once (typically near the app root). Inside
a single `useEffect` with `[]` deps:

1. `useUIStore.persist.rehydrate()` (`:38`) — pulls UI prefs from localStorage.
2. `applyData(data)` (`:41`) — the remote→store helper; wraps
   `useDataStore.setState(data)` in `remoteApply.active = true`/`finally false`.
3. `detach()` (`:51`) — unsubscribes the current live listener.
4. `onAuthStateChanged(auth, ...)` (`:60`) — the driver. On each fire it first
   `detach()`s, then:
   - **Signed out** (`:63-72`): `setSession(null)`, null `syncContext.*` +
     `ready=false`, `resetSyncCaches()`, `applyData(emptyData())`.
   - **Signed in**: read `users/{uid}` → `role` (default `"etp"`) + `industryId`
     (default `null`), `setSession(...)`, set `syncContext = {uid, role, industryId,
     ready:false}`, `resetSyncCaches()`. Then:
     - **admin** (`:97-110`): `loadAllIndustries()`; if `count===0`,
       `seedIndustries(buildSeedState())` then reload; `applyData`; `subscribeAll`.
     - **operator with industryId** (`:111-118`): `loadOneIndustry`; `applyData`;
       `subscribeOne`.
     - **operator without industryId** (`:119-122`): `applyData(emptyData())` (e.g.
       mid self-registration).
   - Finally `syncContext.ready = true` (`:124`) — unlocks `setItem`.
5. Cleanup (`:127-130`): `unsubAuth()` + `detach()`.

### `lib/firebase.ts`

- `firebaseConfig` (`:11`) — web config from `NEXT_PUBLIC_FIREBASE_*` env vars with
  public fallbacks (public by design; access enforced by rules, not secrecy).
- `firebaseApp` (`:21`) — `getApps().length ? getApp() : initializeApp(...)` (guards
  fast-refresh re-init). `auth` (`:22`) = `getAuth`; `db` (`:23`) = `getFirestore`.

### `firestore.rules` (the security boundary)

| Match | Rule (summary) |
|-------|----------------|
| `users/{uid}` read | own profile only (`:31`). |
| `users/{uid}` create | own uid **and** `role == 'etp'` — clients cannot self-assign admin (`:36-37`). |
| `users/{uid}` update | own uid **and** role unchanged — closes privilege escalation (`:41-42`). No delete. |
| `industries/{id}` read | `isAdmin()` or `ownsIndustry(id)` (`:54`). |
| `industries/{id}` create | admin, or a signed-in user whose `request.resource.data.ownerUid == uid` (self-registration before the profile link exists) (`:58-59`). |
| `industries/{id}` update | admin, `ownsIndustry(id)`, or `resource.data.ownerUid == uid` (covers the window before the profile's `industryId` is set) (`:64-66`). |
| `industries/{id}` delete | admin only (`:68`). Everything else denied by default. |

`isAdmin()` reads the caller's `users/{uid}` profile `role`; trustworthy precisely
because the `role` field is immutable from the client.

---

## Gotchas & invariants

- **`getItem` never loads.** Hydration is *only* via `StoreHydrator`. If a screen
  reads `useDataStore` before hydration completes it sees the local **seed** (from
  `...seed()` at `data.ts:125`), not the tenant's real data. Gate on
  `useAuthStore.authReady` / `syncContext.ready` where correctness matters.
- **Three interlocked write guards.** A write reaches Firestore only when
  `!remoteApply.active && syncContext.ready && uid` (`setItem`, `:192-194`). Break any
  one (e.g. forget to wrap a remote apply in `remoteApply`) and you get either an echo
  loop or the seed clobbering real docs.
- **Never `setState` the data store outside `applyData` for remote data.** A raw
  `setState`/action persists. Remote snapshots and the logout reset must be wrapped in
  `remoteApply.active` — this is exactly what `auth.ts:42-47` and `store-hydrator.tsx:42-48`
  do.
- **The `canWrite` filter is an optimization, not the boundary.** `setItem` skips docs
  the caller can't write to avoid a rejected round-trip, but the real enforcement is
  `firestore.rules`. Client filtering could be bypassed; the rules cannot.
- **Alerts must carry an `industryId` to persist.** `shardByIndustry` drops null-
  `industryId` alerts (`:132-136`); such an alert would live only in memory and never
  sync. All current alert-creating actions set an `industryId`.
- **`totalWaterIntake` is a fixed formula.** `freshWaterConsumption + etpReuse +
  roPermeate` (`data.ts:216`, `types.ts:95`) — *not* the sum of all fields. `etpInlet`,
  `roInlet`, etc. are recorded but not part of intake.
- **Ids from `IND-###` max, not length.** `registerIndustry` scans for the highest
  numeric id (`:381-385`) so a new unit can't collide with a seed id or a merged doc.
- **Units.** Water volumes are stored as `"KL"` and *displayed* as `m³` via
  `displayUnit()` (`utils.ts:17`); capacities are KLD. `raiseEtpInletAlert` compares an
  m³-labeled inlet against a KLD capacity in its message text (`data.ts:308`).
- **Echo suppression is timestamp-based.** If two clients write within the same
  millisecond, or a clock skews, `updatedAt`/`lastWriteAt` comparisons can misjudge a
  foreign change as an echo (or vice-versa). Acceptable at this scale.
- **`writeSlice` swallows errors.** Failed writes are silent by design ("persistence
  must never break the UI", `:179-181`) — the UI shows the optimistic local state even
  if the sync failed.
- **UI store is the only localStorage user,** and only `sidebarCollapsed` + `activeCetp`
  are persisted (`partialize`, `ui.ts:28`); `mobileNavOpen` is deliberately transient.
- **`migrate` is largely dead code.** Because `getItem` returns `null`, `persist` has
  nothing to migrate; the version-4 reset (`data.ts:448`) is a safety net, not a live
  path.

---

## Related files

- `lib/types.ts` — `Industry`, `FlowMeterReading`, `EtpEntry`, `Approval`, `Alert`,
  `ComplianceRecord`, `RoleId`, `MeterPoint`, `CetpId`, `ApprovalStage`, etc.
- `lib/constants.ts` — `ALERT_META` (label/severity per `AlertType`),
  `complianceStatus()`, role/nav definitions, `canAccessPath()`.
- `lib/data/seed.ts` — `industries` seed + `buildReadings`/`buildEtpEntries`/
  `buildApprovals`/`buildEtpApprovals`/`buildAlerts`/`buildCompliance` (consumed by
  `seed()`).
- `lib/utils.ts` — `displayUnit()` (KL → m³), `toCSV()` (injection-hardened export),
  formatting helpers.
- `firestore.rules` — the server-side tenant-isolation boundary this whole layer
  relies on.
- `components/shared/store-hydrator.tsx` — mounts the auth→data wiring described above.
