# CLAUDE.md — JalRakshak ETP project guide

Authoritative guide for working in this repo. Read this first; it reflects the codebase as of commit `8c5c6ec` (per-tenant Firestore era).

## What this is

**RSPCB JalRakshak — ETP** is a smart wastewater-monitoring & compliance platform for **individual Effluent Treatment Plant (ETP)** textile units in the Balotra cluster, for the Rajasthan State Pollution Control Board (RSPCB). It is a **client-only Next.js app** (no API routes / server actions) that talks **directly to Firebase Auth + Firestore** from the browser. Presentation-grade, but with a real backend and real per-tenant access control.

Two user roles:
- **`monitoring-admin`** — the RSPCB regulator ("Monitoring Body"); sees/administers **every** ETP unit.
- **`etp`** — an industry operating its own ETP; self-registers and sees **only its own** unit.

## Commands

```bash
pnpm install
pnpm dev      # next dev (Turbopack) → http://localhost:3000
pnpm build    # next build (Turbopack) — must pass; ESLint runs and unused vars FAIL the build
pnpm start    # serve the production build
pnpm lint     # eslint
```
- Package manager is **pnpm** on **Windows**. The Bash tool here is Git Bash; a PowerShell tool is also available.
- Next.js **16.2.9** uses **Turbopack** for both dev and build. `--no-turbopack` / `NEXT_DISABLE_TURBOPACK` do NOT work in this version. Consequence: **no post-processing** (EffectComposer/bloom) in the 3D scene — realism is done with geometry/lighting/shadows only.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui on the unified `radix-ui` package + `cva` · **Firebase 12** (Auth email/password + Firestore) · **Zustand 5** (persist) · Three.js 0.184 + @react-three/fiber 9 + @react-three/drei 10 (only `Html` used) · GSAP · Framer Motion · TanStack Table · React Hook Form + Zod · Lucide · Sonner (toasts) · Recharts (installed but the wrappers are currently unused).

## Architecture (read this before any data change)

### Client-only, Firebase-backed
There is **no server layer**. `lib/firebase.ts` initializes the client SDK from `NEXT_PUBLIC_FIREBASE_*` env vars with the **real public web config hardcoded as fallback** (so deploys need zero Vercel env vars). The Firebase web API key is committed on purpose — it is public by design; **`firestore.rules` is the entire security boundary.**

### Three Zustand stores
- **`useAuthStore`** (`lib/store/auth.ts`) — session: `uid, role, industryId, isAuthed, authReady`. `setSession` is called by the Firebase auth listener (authoritative). `login()` is an optimistic post-signin set. `logout()` signs out + resets data (guarded so it doesn't persist).
- **`useDataStore`** (`lib/store/data.ts`) — the domain data + all mutating actions. State is **six flat arrays**: `industries, readings, etpEntries, approvals, alerts, compliance`. Persisted via a **custom Firestore adapter** (not localStorage), `name: "jalrakshak-data"`, `version: 4`, `skipHydration: true`.
- **`useUIStore`** (`lib/store/ui.ts`) — sidebar/nav prefs, **localStorage only** (`jalrakshak-etp-ui`), unrelated to auth/Firestore.
- **`useAccountsStore`** (`lib/store/accounts.ts`) — `signup()` / `authenticate()` wrapping Firebase Auth + the `users/{uid}` profile.

### The per-tenant data model (THE key concept)
The dataset used to live in one shared doc (`state/app`) any signed-in user could overwrite — a broken-access-control + cross-tenant PII hole. It is now **sharded into one document per industry: `industries/{industryId}`**, each holding that unit's slice serialized as a `json` string plus structured `industryId` + `ownerUid` fields the rules scope on. Profiles live in **`users/{uid}`** (`{name, email, role, industryId}`).

**`lib/data/firestore-storage.ts` is the sole bridge** between the flat store and the sharded docs. The store's actions never change shape — this file shards on write and merges on read:
- `shardByIndustry(data)` / `mergeSlices(slices)` — split flat arrays into per-industry `IndustrySlice`s and back. (Alerts with a null `industryId` are intentionally dropped so a system alert can't leak into a tenant doc.)
- `writeSlice(id, slice, ownerUid?)` — write `industries/{id}` (`setDoc merge`); dedups by exact JSON; passing `ownerUid` forces the write and stamps ownership (used once at self-registration).
- `firestoreStorage.setItem` — the write path: bails if `remoteApply.active` or `!syncContext.ready`; shards; writes only docs the caller may write (`role === "monitoring-admin" || id === industryId`).
- `loadAllIndustries()` / `loadOneIndustry(id)` — role-scoped reads; prime the dedup cache so a later reconcile only writes changed docs (never clobbers untouched tenants).
- `subscribeAll()` / `subscribeOne(id)` — live `onSnapshot`; ignore echoes of our own writes via `lastWriteAt` vs the doc's `updatedAt`.
- `seedIndustries(seed)` — regulator-only bootstrap. `writeOwnedIndustry(...)` — operator self-registration write.
- Coordination globals: **`remoteApply`** (when true, `setItem` no-ops — set while applying a remote snapshot or resetting on logout, so those never persist/clobber), **`syncContext`** (`{uid, role, industryId, ready}` — `setItem` refuses to write until `ready`), **`lastWriteAt`** (echo/stale suppression).

### Hydration flow (`components/shared/store-hydrator.tsx`)
Headless (renders `null`), the **only** driver of data-store hydration. On `onAuthStateChanged`:
1. No user → clear session, null `syncContext`, `resetSyncCaches()`, apply `emptyData()`.
2. User → read `users/{uid}` for `role`+`industryId` (missing/broken profile → least-privilege `etp`, no industry). `setSession(...)`. Set `syncContext` with `ready:false` (suppress writes during load).
3. Load the authorized slice: **admin** → `loadAllIndustries()` (+ first-run `seedIndustries(buildSeedState())` if the collection is empty) + `subscribeAll`; **operator with industryId** → `loadOneIndustry()` + `subscribeOne`; **authed but unbound** (mid self-registration) → `emptyData()`.
4. `syncContext.ready = true`. Remote applies go through `applyData()` which wraps `setState` in `remoteApply` so they aren't re-persisted.

### Security model (`firestore.rules` — the real enforcement)
- `users/{uid}`: read/update your own only; **create forces `role == 'etp'`** and **update keeps role immutable** → clients cannot self-assign `monitoring-admin` (regulators are provisioned out-of-band via console/Admin SDK).
- `industries/{id}`: **read** = `isAdmin() || ownsIndustry(id)`; **create** = admin, or a signed-in user stamping `ownerUid == own uid` (self-registration); **update** = admin, or the owner (matched by profile `industryId` or the `ownerUid` stamp); **delete** = admin only. Everything else denied.
- Client-side scoping (`firestoreStorage` write filter, `StoreHydrator` role-scoped load, `canAccessPath`/nav `roles`) **mirrors** the rules for UX but is **not** the boundary — the rules are.

## Directory & file map

```
app/                              Next.js App Router
  layout.tsx                      root layout: fonts, metadata (favicon = /rspcb-logo.jpeg),
                                  <StoreHydrator/> + <Providers/> + <DevWatermark/> + <Toaster/>
  globals.css                     Tailwind v4 + 3 palettes: :root light (marketing/auth),
                                  .dark (deep-slate, unused on dashboard), .theme-dash (light indigo — the dashboard)
  page.tsx                        "/" → <LandingExperience/> (3D scroll landing)
  login/page.tsx                  "/login" sign-in ONLY (show-pw; demo accounts shown)
  register/page.tsx               "/register" public self-registration (input filters + password checklist)
  dashboard/
    layout.tsx                    wraps children in .theme-dash → <DashboardShell/>
    page.tsx                      "/dashboard" role split: admin→<AdminOverview/>, etp→<EtpOverview/>
    etp-entry/page.tsx            ETP-only: daily water-balance form (validation rules below)
    etp/page.tsx                  admin: ETP units master/detail
    industries/page.tsx           admin: registry table + dialog
    industries/register/page.tsx  admin: lean onboarding form
    approvals/page.tsx            admin: approve/reject workflow
    alerts/page.tsx               admin: ack/resolve alerts
    compliance/page.tsx           admin: scorecards
    reports/page.tsx              admin (URL-only, no sidebar): 7 CSV exports
    settings/page.tsx             both (URL-only): prefs + reset demo data
components/
  shared/store-hydrator.tsx       Firebase→store bridge (role-scoped load; see Architecture)
  shared/{logo,digital-hammer-logo,dev-watermark,status-badge,icon,section-reveal,animated-counter}.tsx
  providers.tsx                   MotionConfig + Radix TooltipProvider
  dashboard/dashboard-shell.tsx   auth gate (authReady + canAccessPath), sidebar+topbar+animated main
  dashboard/{sidebar,topbar,page-header,metric-card}.tsx
  dashboard/admin-overview.tsx    regulator home (metrics, aggregate pipeline, panels)
  dashboard/etp-overview.tsx      operator home (compliance, today-vs-yesterday intake, history)
  dashboard/{reports-panel,pipeline-flow,data-table,approval-timeline}.tsx
  landing/landing-experience.tsx  scroll orchestrator; lazy-loads RiverScene, static fallback
  landing/{scroll-overlay,static-hero-background,site-header,site-footer}.tsx
  landing/home/{home-content,hero-section,about-slideshow,contact-section}.tsx
  three/river-scene.tsx           R3F <Canvas> + CameraRig (shadows on)
  three/scene-environment.tsx     the diorama: Atmosphere, Sun, Land, Factory, Pipeline, Trees, Fish
  three/water-plane.tsx           GLSL river plane
  three/shaders/water.ts          water vertex/fragment shaders
  three/types.ts                  TransitionRef = ref<{value:number}> (0→1 scroll driver)
  charts/index.tsx                Recharts wrappers — UNUSED (dead)
  ui/*                            shadcn primitives; MANY unused (see Dead code)
lib/
  firebase.ts                     Firebase init + public config fallback
  store/{auth,data,ui,accounts}.ts   Zustand stores (see Architecture)
  data/firestore-storage.ts       per-tenant shard/merge/sync bridge (THE key file)
  data/seed.ts                    deterministic mock-data generator (mulberry32 PRNG; DEMO_TODAY 2026-06-20)
  data/etp-flow.ts                buildEtpStageFlow/buildEtpFlow — pipeline node builders
  types.ts                        all domain types (Industry, EtpEntry, FlowMeterReading, Approval, Alert, ...)
  constants.ts                    ROLES, DASHBOARD_NAV, canAccessPath, ALERT_META, COMPLIANCE thresholds
  utils.ts                        cn, formatNumber, displayUnit (KL→m³), formatKLD, toCSV (injection-hardened)
  hooks/{use-hydrated,use-capabilities}.ts   client hydration + device (WebGL/reduced-motion) hooks
data/industries.json             seed source: 2 units (IND-019, IND-020), full capacities + PII
firestore.rules                  per-tenant isolation (the security boundary)
firebase.json / firestore.indexes.json / .firebaserc   Firebase CLI config (indexes empty)
.mcp.json                        Firebase MCP server (Windows: cmd /c firebase mcp)
```

## Conventions

- **Units:** treatment **capacities are `KLD`**; daily water-balance **volumes are stored as `"KL"` but displayed as `m³`** — always render volumes through `displayUnit(u)` (`lib/utils.ts`; `"KL"→"m³"`, `"kWh"` unchanged) or the literal `m³`. 1 KL = 1 m³, so it's labels only. When editing volume labels, never corrupt the adjacent `KLD`.
- **Total Water Intake** = `freshWaterConsumption + etpReuse + roPermeate`. The dashboard "Today vs Yesterday" card is **date-keyed** (`dailyIntake(entries, todayStr, yesterdayStr)` on the stored local `YYYY-MM-DD`), so values roll over by calendar date; today computed client-side to avoid hydration mismatch.
- **Theming:** the dashboard uses the **`.theme-dash`** (light indigo) palette applied in `app/dashboard/layout.tsx`; marketing/auth use `:root` (light teal). Use semantic Tailwind tokens (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`).
- **Forms:** React Hook Form + Zod. Public `/register` filters input per-keystroke (alphabets-only Company/Owner/Area, digits-only Mobile) and has a live password checklist (≥8 + letter + number + special). Raw styled `<input>`s are used (the `ui/input.tsx` component is unused).
- **IDs:** `IND-###` (max existing + 1), and `Date.now()`-base36 for `R-/E-/A-/AL-` (per-submission alert ids are `AL-{id}-{idx}`).
- **Icons in data:** use `components/shared/icon.tsx` (string → Lucide) when an icon name comes from constants/data.

## Gotchas / pitfalls

- **Persistence is silent & best-effort** — `writeSlice` swallows all errors; a rules rejection or offline write fails with no UI feedback. The local store can drift from Firestore until the next successful reconcile.
- **Echo/stale suppression is client-clock based** (`updatedAt = Date.now()` + `lastWriteAt`). Robust for the single-writer-per-tenant case; concurrent admin writes rely on client clocks.
- **First admin must sign in before operators** on an empty project — the first `monitoring-admin` login bootstraps the `industries/*` docs from the local seed; until then operators bound to a seed unit see empty.
- **Old `state/app` doc is orphaned** (superseded by per-tenant; denied by rules). Don't read/write it; data there does not auto-migrate.
- **Demo credentials are published** on `/login` and in the README (`admin@rspcb.in`/`rspcb123`, `etp@demo.in`/`demo123`) — left intentionally per the user.
- **Turbopack**: no `--no-turbopack`; no 3D post-processing (see Commands).
- **Firebase MCP on Windows**: `.mcp.json` must use `command: "cmd", args: ["/c","firebase","mcp",...]` (bare `npx` → "Connection closed").
- **Build fails on unused imports/vars** (ESLint via `next build`) — clean up when removing usages.

## Deployment

- **Git remotes (two):** `origin` → `github.com/ManavBhati2004/Jalrakshak---ETP`; `inception` → `github.com/inceptionretreats-stack/Jalrakshak---ETP--RSPCB`. **Push to BOTH:** `git push origin main && git push inception main`. (Harmless recurring warning `update_ref failed for refs/remotes/...` — the push still succeeds; resync with `git update-ref refs/remotes/<remote>/main $(git rev-parse HEAD)`.)
- **Vercel (two projects, both Git-connected → auto-deploy on push):** manav (`jalrakshak-etp.vercel.app`) and inception (`jalrakshak-etp-psi.vercel.app`). No env vars needed (public config is in `lib/firebase.ts`).
- **Firebase project:** `jalrakshak-etp` (region asia-south1, Spark/free), owned by the `inceptionretreats@gmail.com` Google account. Deploy rules with `firebase deploy --only firestore:rules` or the Firebase MCP; verify live with the MCP read tools.
- Commit style: end messages with the `Co-Authored-By: Claude ...` trailer; only commit/push when asked. Currently the workflow commits directly to `main`.

## Common tasks

- **Add a field to a unit:** update `Industry` in `lib/types.ts`, the `RegisterInput` + `registerIndustry` in `lib/store/data.ts`, and the form(s) in `app/register/page.tsx` (public) and/or `app/dashboard/industries/register/page.tsx` (admin). Keep type fields optional if only one form supplies them.
- **Add/modify a store action:** edit `lib/store/data.ts`. It mutates the flat arrays; the persist adapter shards automatically — no Firestore code needed in the action.
- **Change access rules:** edit `firestore.rules`, deploy, and mirror the client scoping in `firestoreStorage.setItem` / `StoreHydrator` / `canAccessPath` if relevant.
- **Verify live data:** use the Firebase MCP tools (`firestore_get_document` on `industries/{id}` and `users/{uid}`, `auth_get_users`). Prefer testing against a throwaway `state/qatest`-style doc for writes; never clobber real tenant docs.
- **After any change:** `pnpm build` must pass, then commit + push **both** remotes.

## Known dead code (safe to ignore / candidates for removal)
- `components/charts/index.tsx` — the entire Recharts wrapper module is unused.
- `components/ui/*` unused primitives: `input, card, badge, select, tabs, avatar, progress, scroll-area, textarea, skeleton, separator, label`.
- `SortHeader` (data-table.tsx), `StaggerReveal`/`staggerItem` (section-reveal.tsx).
- `reports-panel.tsx` hardcodes `TODAY = "2026-06-20"` (data-freshness quirk vs the live date in `etp-overview.tsx`).
