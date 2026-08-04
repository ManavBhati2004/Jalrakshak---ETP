# Security & Roles

> The authorization model for **RSPCB JalRakshak — ETP**. Two roles, an
> identity→role binding in `users/{uid}`, and a per-tenant Firestore boundary
> enforced by `firestore.rules`. Everything the client does — write filtering,
> data scoping, route gating — **mirrors** that boundary for UX, but is **not**
> the boundary itself.

---

## Overview

This is a **client-only** Next.js app (App Router, Turbopack) that talks to
Firebase (Auth + Firestore) **directly from the browser**. There is no server,
no API route layer, and **no Next.js middleware** — `middleware.ts` does not
exist in the repo, so route gating is done purely in a client component. The
practical consequence:

> **The only trustworthy security boundary is `firestore.rules`.** Anyone can
> open dev-tools, import the Firebase SDK, and issue arbitrary reads/writes with
> their real auth token. Whatever the rules allow, a determined client can do;
> whatever the rules deny, no client trick can bypass. All the client-side
> checks documented below (write skipping, role-scoped hydration, redirect
> gating) exist to make the UI coherent and to save round-trips — they are
> **cosmetic** from a security standpoint.

The system has exactly **two roles**:

| Role id            | Display name     | Who                              | Scope                                        |
| ------------------ | ---------------- | -------------------------------- | -------------------------------------------- |
| `monitoring-admin` | Monitoring Body  | The RSPCB regulator (provisioned out-of-band) | **Super-admin** — reads/writes *every* industry |
| `etp`              | ETP              | An industry operator (self-registers) | **Single-tenant** — reads/writes *only its own* unit |

Identity is a Firebase Auth account (email/password). Role and tenant binding
live in a Firestore profile document `users/{uid}` shaped
`{ name, email, role, industryId }`. The dataset itself is **sharded one
document per industry** at `industries/{industryId}`, each stamped with an
`ownerUid` and `industryId` that the rules scope on. `role` decides *breadth*
(all industries vs. one); `industryId` decides *which* one for an operator.

---

## Files

| Path | Role in the security model |
| ---- | -------------------------- |
| `firestore.rules` | **The security boundary.** Server-enforced read/write matrix for `users/{uid}` and `industries/{industryId}`, plus default-deny. |
| `lib/types.ts` | Defines `RoleId = "monitoring-admin" \| "etp"` (`lib/types.ts:5`) and the `Role` display interface (`lib/types.ts:7`). |
| `lib/constants.ts` | `ROLES` display metadata, `ADMIN_ROLE`, `DASHBOARD_NAV` (per-item `roles`), `ADMIN_ONLY_PATHS`, `ETP_ONLY_PATHS`, and `canAccessPath()` — the client route-gating logic. |
| `lib/store/accounts.ts` | Firebase-backed account actions: `signup` (create Auth user + `users/{uid}` profile) and `authenticate` (sign in + read profile). |
| `lib/store/auth.ts` | In-memory session store (`uid`, `role`, `industryId`, `authReady`); `setSession`/`login`/`logout`; `isAdmin`/`isEtp` helpers. |
| `components/shared/store-hydrator.tsx` | Wires Firebase `onAuthStateChanged` → reads the profile → loads the **role-scoped** slice of data and live-subscribes to it. |
| `lib/data/firestore-storage.ts` | The store⇄Firestore bridge. Shards the store on write and, in `setItem`, **skips** industry docs the caller isn't allowed to write. Loaders/subscribers for admin (all) vs. operator (one). |
| `components/dashboard/dashboard-shell.tsx` | Client route guard: redirects unauthenticated users to `/login` and role-mismatched routes to `/dashboard` via `canAccessPath`. |
| `app/register/page.tsx` | Self-registration flow: creates an `etp` account, then an `ownerUid`-stamped industry doc, then links `users/{uid}.industryId`. |

---

## How it works

### 1. Identity → role → tenant binding

An account is a Firebase Auth uid. Its **authority** is not in the token — it's
in the Firestore profile the rules `get()` on every request.

```
Firebase Auth uid ──1:1──▶ users/{uid} { name, email, role, industryId }
                                              │            │
                                    role decides breadth   │
                                    (all vs. one industry) │
                                                           ▼
                              industryId ──▶ industries/{industryId} { json, industryId, ownerUid, updatedAt }
```

- **Sign-up** (`lib/store/accounts.ts:52`): `createUserWithEmailAndPassword`,
  then `setDoc(doc(db,"users",uid), { name, email, role, industryId })`
  (`accounts.ts:66`). The caller passes `role`, but the create rule (below)
  **forces it to `etp`** — a client-supplied `monitoring-admin` is rejected.
- **Sign-in** (`lib/store/accounts.ts:77`): `signInWithEmailAndPassword`, then
  `getDoc(users/{uid})`. If the profile is missing, `role` **defaults to `etp`**
  and `industryId` to `null` (`accounts.ts:87-88`) — least-privilege fallback.
- **Session restore** (`components/shared/store-hydrator.tsx:60`):
  `onAuthStateChanged` re-reads the profile on every load; a missing/broken read
  again falls back to `role: "etp"`, `industryId: null`
  (`store-hydrator.tsx:76-85`).

### 2. The Firestore rules walkthrough (`firestore.rules`)

`rules_version = '2'`, one match block on
`/databases/{database}/documents`.

**Helpers** (`firestore.rules:7-26`):

| Helper | Definition | Meaning |
| ------ | ---------- | ------- |
| `signedIn()` | `request.auth != null` (`:7`) | Any authenticated user. |
| `hasProfile()` | `signedIn() && exists(users/$(uid))` (`:10`) | Auth user *and* a profile doc exists. |
| `profile()` | `get(users/$(uid)).data` (`:14`) | The caller's profile fields (a server `get`, billed as a read). |
| `isAdmin()` | `hasProfile() && profile().role == 'monitoring-admin'` (`:19`) | The regulator. Trustworthy because clients can't self-assign the role. |
| `ownsIndustry(industryId)` | `hasProfile() && profile().industryId == industryId` (`:24`) | The operator bound to exactly this industry via its profile. |

**`match /users/{uid}`** (`firestore.rules:29-45`) — the anti-privilege-escalation core:

| Op | Rule (`file:line`) | Effect |
| -- | ------------------ | ------ |
| `read` | `signedIn() && request.auth.uid == uid` (`:31`) | You can read **only your own** profile — never anyone else's. |
| `create` | `signedIn() && request.auth.uid == uid && request.resource.data.role == 'etp'` (`:36`) | You may create only *your own* profile, and **`role` is forced to `etp`**. A create carrying `role: "monitoring-admin"` is denied outright (no profile is written). Regulator accounts are provisioned out-of-band (console / Admin SDK). |
| `update` | `signedIn() && request.auth.uid == uid && request.resource.data.role == resource.data.role` (`:41`) | You may update your own profile, but **`role` is immutable** — the new value must equal the stored one. Closes the "register as etp, then promote self to admin" path. `industryId`, `name`, `email` *can* change. |
| `delete` | *(none)* | No client deletes. |

**`match /industries/{industryId}`** (`firestore.rules:53-69`) — per-tenant isolation:

| Op | Rule (`file:line`) | Admin | Operator |
| -- | ------------------ | ----- | -------- |
| `read` | `isAdmin() \|\| ownsIndustry(industryId)` (`:54`) | reads **every** industry | reads **only** the industry its profile is bound to |
| `create` | `isAdmin() \|\| (signedIn() && request.resource.data.ownerUid == request.auth.uid)` (`:58`) | may create any | may create a doc **only if** it stamps `ownerUid == its own uid` (self-registration — runs *before* the profile's `industryId` link exists) |
| `update` | `isAdmin() \|\| ownsIndustry(industryId) \|\| (signedIn() && resource.data.ownerUid == request.auth.uid)` (`:64`) | may update any | may update its own — matched **either** by the profile link (`ownsIndustry`) **or** by the stored `ownerUid` (covers the brief window before `industryId` is set) |
| `delete` | `isAdmin()` (`:68`) | may delete any | **cannot delete** |

Everything not matched is **denied by default** (`firestore.rules:71`).

> **Why two operator-matching paths (`ownsIndustry` *and* `ownerUid`)?** At
> self-registration the operator creates the industry doc *before*
> `users/{uid}.industryId` is written, so `ownsIndustry()` is momentarily false.
> The `ownerUid == request.auth.uid` clause on `create`/`update` bridges that
> window; once the profile is linked, `ownsIndustry()` takes over.

### 3. Effective read / write matrix (server-enforced)

| Collection / doc | `monitoring-admin` | `etp` operator (owns *X*) | Anonymous |
| ---------------- | ------------------ | ------------------------- | --------- |
| `users/{ownUid}` read | ✅ own | ✅ own | ❌ |
| `users/{otherUid}` read | ❌ | ❌ | ❌ |
| `users/{ownUid}` create | ✅ (out-of-band; role forced `etp` via app) | ✅ (role forced `etp`) | ❌ |
| `users/{ownUid}` update (role change) | ❌ (immutable) | ❌ (immutable) | ❌ |
| `users/{ownUid}` update (other fields) | ✅ | ✅ | ❌ |
| `industries/X` read | ✅ | ✅ (its own) | ❌ |
| `industries/Y` read (≠ X) | ✅ | ❌ | ❌ |
| `industries/*` create | ✅ any | ✅ only if `ownerUid == self` | ❌ |
| `industries/X` update | ✅ | ✅ (own) | ❌ |
| `industries/Y` update (≠ X) | ✅ | ❌ | ❌ |
| `industries/*` delete | ✅ | ❌ | ❌ |
| anything else | ❌ | ❌ | ❌ |

The takeaway: an operator **cannot read another tenant's PII** and **cannot
overwrite or delete another tenant's regulatory data**, no matter what the
client does.

### 4. The client-side mirror (cosmetic, for UX + fewer round-trips)

Three layers on the client echo the rules. None of them is a security control —
each just shapes what the UI attempts.

```
                        onAuthStateChanged (StoreHydrator)
                                    │
                 read users/{uid} → { role, industryId }
                                    │
             ┌──────────────────────┴──────────────────────┐
     role == monitoring-admin                        role == etp
             │                                              │
   loadAllIndustries()                        industryId? ─ yes → loadOneIndustry(id)
   + subscribeAll()                                        │        + subscribeOne(id)
   (every industries/*)                                    no → emptyData()
             │                                              │
             └──────────────► useDataStore (six flat arrays) ◄──────────┘
                                    │  (writes) 
                        firestoreStorage.setItem
                                    │  shard by industryId
                         canWrite = role=='monitoring-admin' || id==industryId
                                    │  skip docs you can't write (rules would reject anyway)
                                    ▼
                            industries/{id}  (setDoc merge)
```

**(a) Write filter — `firestoreStorage.setItem`** (`lib/data/firestore-storage.ts:191`):
- Returns early if `remoteApply.active` (a *remote* snapshot is being applied —
  don't echo it back) or `!syncContext.ready` (initial load not finished — the
  seed must never clobber real docs) or no `uid` (`:192-194`).
- Shards the flat store into per-industry slices (`shardByIndustry`, `:201`).
- For each slice: `canWrite = role === "monitoring-admin" || id === industryId`
  (`:203`). If not writable, it **`continue`s** — the comment is explicit:
  *"rules would reject it anyway — skip the round-trip"* (`:204`). This is an
  optimization, not a guard.
- `writeSlice` does `setDoc(doc(db,"industries",id), { json, industryId, updatedAt }, { merge: true })` (`:178`). `ownerUid` is stamped **only** via
  `writeOwnedIndustry` at registration (`:214`).

**(b) Role-scoped hydration — `StoreHydrator`** (`components/shared/store-hydrator.tsx`):
- `monitoring-admin`: `loadAllIndustries()` then live `subscribeAll(...)`
  (`store-hydrator.tsx:97-110`). On a first sign-in against an empty project,
  it bootstraps the seed via `seedIndustries(buildSeedState())` (regulator-only
  write, `:102-104`).
- `etp` with an `industryId`: `loadOneIndustry(industryId)` then
  `subscribeOne(industryId, ...)` (`:111-118`).
- `etp` with no `industryId` (mid-registration): `emptyData()` (`:119-121`).
- On sign-out: session cleared, caches reset, store emptied (`:63-72`).

Because an operator only ever *asks* for its own doc, it never trips a denied
read — but even if the client code were changed to request others, the rules
would refuse.

**(c) Route gating — `canAccessPath` + `DashboardShell`:**
- `canAccessPath(role, pathname)` (`lib/constants.ts:65`) checks the path
  against `ADMIN_ONLY_PATHS` and `ETP_ONLY_PATHS` with a **segment-aware** match
  (`pathname === p || pathname.startsWith(p + "/")`, `:67`) so `/dashboard/etp`
  does not swallow `/dashboard/etp-entry`. `monitoring-admin` is allowed
  everything except ETP-only paths (`return !inEtp`, `:70`); `etp` is allowed
  everything except admin-only paths (`return !inAdmin`, `:71`).
- `DashboardShell` runs this in an effect (`dashboard-shell.tsx:21-31`): once
  `authReady`, no `role` → `router.replace("/login")`; role can't access the
  path → `router.replace("/dashboard")`. It renders a loader until `authReady`.
  This only changes what *renders*; the data behind any page is still
  rules-gated.

---

## Reference

### Types & constants

| Identifier | Where | Notes |
| ---------- | ----- | ----- |
| `RoleId` | `lib/types.ts:5` | `"monitoring-admin" \| "etp"`. |
| `Role` | `lib/types.ts:7` | Display shape: `{ id, name, description, scope, icon, accent, permissions }`. |
| `ROLES` | `lib/constants.ts:8` | Two entries. `permissions` (`["*"]` for admin; `["submit","view-own","register"]` for etp) are **display metadata only — not enforced anywhere**. Header comment even says *"(demo, no real auth)"* (`:7`). |
| `ADMIN_ROLE` | `lib/constants.ts:29` | `"monitoring-admin"`. |
| `DASHBOARD_NAV` | `lib/constants.ts:44` | Nav items each carry `roles: RoleId[]` (`ALL`/`ADMIN`/`ETP`) to decide sidebar visibility. |
| `ADMIN_ONLY_PATHS` | `lib/constants.ts:54` | `/dashboard/industries`, `/dashboard/etp`, `/dashboard/approvals`, `/dashboard/compliance`, `/dashboard/alerts`, `/dashboard/reports`. Note `/dashboard/reports` is admin-gated even though it isn't in `DASHBOARD_NAV`. |
| `ETP_ONLY_PATHS` | `lib/constants.ts:62` | `["/dashboard/etp-entry"]`. |

### Functions

| Function | Where | Purpose |
| -------- | ----- | ------- |
| `canAccessPath(role, pathname)` | `lib/constants.ts:65` | Segment-aware route permission used for redirect gating. Paths in *neither* list are open to both roles (e.g. `/dashboard`, `/dashboard/settings`). |
| `useAccountsStore().signup(input)` | `lib/store/accounts.ts:52` | Validates name/email/password, creates the Auth user, writes `users/{uid}`. Returns `{ok:true,user}` or `{ok:false,error}`. |
| `useAccountsStore().authenticate(email,password)` | `lib/store/accounts.ts:77` | Signs in, reads profile, returns an `Account` (role defaults to `etp` if profile missing). |
| `messageForCode(code)` | `lib/store/accounts.ts:36` | Maps Firebase Auth error codes to user copy. |
| `isAdmin(role)` / `isEtp(role)` | `lib/store/auth.ts:52-53` | Convenience role predicates for UI. |
| `useAuthStore().setSession(session)` | `lib/store/auth.ts:33` | Called by `onAuthStateChanged`; sets `uid/role/industryId/isAuthed` and marks `authReady`. |
| `useAuthStore().login(role, industryId?)` | `lib/store/auth.ts:37` | Optimistic session set for instant UI after sign-in/up. |
| `useAuthStore().logout()` | `lib/store/auth.ts:38` | `signOut`, clears the data store under `remoteApply` guard, resets session. |
| `firestoreStorage.setItem` | `lib/data/firestore-storage.ts:191` | Write filter (see §4a). |
| `writeSlice(id, slice, ownerUid?)` | `lib/data/firestore-storage.ts:169` | Writes one industry doc; `ownerUid` stamps ownership and forces the write. |
| `writeOwnedIndustry(data, industryId, ownerUid)` | `lib/data/firestore-storage.ts:214` | Create + stamp at self-registration. |
| `seedIndustries(seed)` | `lib/data/firestore-storage.ts:221` | Regulator-only bootstrap of all docs. |
| `loadAllIndustries()` / `loadOneIndustry(id)` | `lib/data/firestore-storage.ts:229` / `:245` | Admin (all) vs. operator (one) loaders. |
| `subscribeAll(cb)` / `subscribeOne(id, cb)` | `lib/data/firestore-storage.ts:257` / `:278` | Live listeners, scoped identically. |

### Firestore rules (quick index)

| Rule | Line |
| ---- | ---- |
| `signedIn`, `hasProfile`, `profile`, `isAdmin`, `ownsIndustry` | `firestore.rules:7-26` |
| `users/{uid}` read / create / update | `:31` / `:36` / `:41` |
| `industries/{id}` read / create / update / delete | `:54` / `:58` / `:64` / `:68` |
| Default deny | `:71` |

### `syncContext` (`lib/data/firestore-storage.ts:91`)

`{ uid, role, industryId, ready }` — the client's snapshot of "who am I" that
`setItem` reads to decide which docs to write. Set by `StoreHydrator` (and
directly by the register flow). Convenience/optimization state; **not** an
authority — the server re-derives everything from `users/{uid}`.

---

## Gotchas & invariants

- **The rules are the boundary; the client is not.** Every client check
  (`setItem` skip, scoped hydration, `canAccessPath` redirect) is UX/perf.
  Removing them would not grant new access — the rules still gate every read and
  write. Conversely, *tightening* the client without tightening the rules
  secures nothing.
- **No middleware, no server.** There is no `middleware.ts` and no API layer;
  route protection is a client `useEffect` redirect only. Treat any dashboard
  page as reachable by URL — the real protection is that its data won't load
  without rule permission.
- **Role is set once and frozen.** `create` forces `role == 'etp'`
  (`firestore.rules:37`); `update` requires `role` unchanged (`:42`). There is
  **no client path to `monitoring-admin`** — regulator accounts must be
  provisioned via the Firebase console / Admin SDK. A client `signup` call
  passing `role: "monitoring-admin"` fails the create rule and writes **no**
  profile.
- **`permissions` arrays are decorative.** `ROLES[].permissions`
  (`lib/constants.ts:16,25`) are never consulted for authorization. Do not treat
  them as a permission system.
- **`ownerUid` vs. `ownsIndustry` dual-match is intentional.** Don't "simplify"
  the `industries` `create`/`update` rules by dropping the `ownerUid` clause —
  self-registration writes the doc before `users/{uid}.industryId` exists, so
  only `ownerUid == request.auth.uid` authorizes that first write
  (`firestore.rules:58-66`; used by `app/register/page.tsx:127`).
- **Least-privilege defaults on read failure.** Both `authenticate`
  (`accounts.ts:87`) and `StoreHydrator` (`store-hydrator.tsx:76,81`) default a
  missing/broken profile to `role: "etp"`, `industryId: null` — the safe,
  minimum-visibility state, not admin.
- **`ready`/`remoteApply` guards protect the shared docs.** `setItem` refuses to
  write until `syncContext.ready` and while `remoteApply.active`
  (`firestore-storage.ts:192`). This stops the store's initial **seed** state, or
  a logout reset, from being sharded out and **clobbering** real industry docs.
  On logout the store is cleared under the same `remoteApply` guard
  (`auth.ts:42-47`).
- **Alerts without an `industryId` are dropped on write.** `shardByIndustry`
  only files an alert if `a.industryId` is truthy (`firestore-storage.ts:135`),
  so a system-level alert can't leak into a tenant's document.
- **`/dashboard/reports` is admin-gated but not in the nav.** It's in
  `ADMIN_ONLY_PATHS` (`lib/constants.ts:60`) without a `DASHBOARD_NAV` entry — an
  operator navigating there directly is redirected to `/dashboard`.
- **Segment-aware path matching matters.** `canAccessPath` uses
  `startsWith(p + "/")`, deliberately so `/dashboard/etp` (admin-only ETP Units)
  does not also match `/dashboard/etp-entry` (ETP-only data entry)
  (`lib/constants.ts:66-67`).

---

## Related files

- `firestore.rules` — the enforcement point (deploy target).
- `lib/firebase.ts` — Firebase app / `auth` / `db` initialization consumed by
  every file above.
- `lib/store/data.ts` — the six-array `useDataStore` and `buildSeedState()` the
  bridge shards/merges.
- `app/register/page.tsx` — the self-registration flow that creates the
  `ownerUid`-stamped industry doc and links the profile.
- `app/login/page.tsx` — the sign-in entry point calling `authenticate`.
- `docs/architecture/data-layer.md` — the per-tenant sharding / hydration
  mechanics in depth (this doc focuses on *authorization*).
