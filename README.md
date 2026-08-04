# RSPCB JalRakshak — ETP

### Smart Textile Wastewater Monitoring & Compliance Platform — Individual ETP

> An initiative for the **Rajasthan State Pollution Control Board (RSPCB) – Balotra**.
> A command-center–style platform for monitoring **individual Effluent Treatment Plant (ETP)** textile units across the Balotra cluster.

This is the **ETP** half of JalRakshak (the CETP platform lives in a separate repository). It is a **client-only web app** (no server/API layer) backed by **Firebase** — Firebase Authentication for accounts and Cloud Firestore for a **per-tenant** dataset, with all access control enforced by Firestore security rules.

---

## ✨ Features

- **Cinematic 3D landing** — a scroll-driven WebGL "clean the river" diorama (custom GLSL water, a textile-mill factory, treatment pipeline, trees, shadows) that morphs polluted → clean. Falls back to a static hero when WebGL is unavailable or `prefers-reduced-motion` is set.
- **Real accounts & roles** — Firebase email/password auth with two roles:
  - **Monitoring Body** (`monitoring-admin`) — the RSPCB regulator; sees and administers **every** ETP unit.
  - **ETP operator** (`etp`) — an industry running its own ETP; **self-registers** and sees **only its own** unit.
- **Per-tenant data isolation** — each unit's data lives in its own Firestore document (`industries/{id}`); an operator can neither read another unit's PII nor overwrite its data. Enforced server-side by `firestore.rules`.
- **Monitoring dashboard** (light indigo command-center theme):
  - **ETP module** — animated treatment pipeline (Max Effluent → ETP → RO I–IV → MEE) and per-unit water balance.
  - **ETP Data Entry** — daily water-balance (fresh water, ETP inlet/outlet/reuse, RO inlet/reject/permeate, sludge → TSDF) with live validation (ETP inlet ≤ sanctioned capacity; every field < fresh-water consumption). Submissions create approvals + alerts and **sync live** across sessions.
  - **Industries** registry + detail, **ETP unit registration** (validated forms), **Approvals** (workflow timeline), **Alert Center**, **Compliance** (scorecards), **Reports** (real CSV export, formula-injection hardened), **Settings** (reset demo data).
- **Today-vs-yesterday intake** — the water-intake card is date-keyed, so today's value automatically becomes yesterday's when the day rolls over.

**Units:** treatment capacities are shown in **KLD**; daily water-balance volumes in **m³**.

## 🧱 Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui (Radix) · **Firebase** (Auth + Firestore) · **Zustand** (persisted through a custom Firestore adapter) · Three.js + React Three Fiber + drei · GSAP · Framer Motion · TanStack Table · React Hook Form + Zod · Recharts · Lucide · Sonner.

## 🚀 Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # production build
```

No environment variables are required — the public Firebase web config ships as a fallback in `lib/firebase.ts`.

## 🎬 Demo flow

1. Open the site → explore the cinematic scroll landing.
2. **Enter Monitoring System** → sign in with a demo account:
   - `admin@rspcb.in` / `rspcb123` — Monitoring Body (sees every ETP unit)
   - `etp@demo.in` / `demo123` — an individual ETP operator
3. As an ETP operator, open **ETP Data Entry**, submit a water balance → see it in the operator dashboard and (as the admin) in **Approvals**, raising **Alerts** and updating **Compliance**.
4. As the Monitoring Body, review **Industries → ETP units**, **Compliance**, **Alerts** and **Reports** (export any report as a real CSV). **Settings → Reset demo data** to restore the seed.
5. New operators can **Register Unit** (`/register`) to self-onboard a new ETP unit.

> Note: on a fresh Firebase project the **Monitoring Body must sign in first** — the first admin login seeds the per-unit documents from the bundled seed data.

## 🗂 Architecture

```
app/                      routes (landing, login, register, dashboard/*)
components/
  landing/ three/         3D scroll experience + home sections
  dashboard/              shell, sidebar, topbar, pipeline, data-table, overviews
  shared/                 store-hydrator (Firebase bridge), logo, status-badge, ...
  ui/  charts/            shadcn primitives · Recharts wrappers
lib/
  firebase.ts             Firebase init (public config fallback)
  store/                  zustand stores — auth, data, ui, accounts
  data/firestore-storage.ts   per-tenant shard/merge/live-sync bridge (the key file)
  data/seed.ts etp-flow.ts     deterministic seed + pipeline builders
  types.ts constants.ts utils.ts
data/industries.json      seed ETP units
firestore.rules           per-tenant isolation (the security boundary)
```

- **Data model:** the Zustand store holds six flat arrays (`industries, readings, etpEntries, approvals, alerts, compliance`). `lib/data/firestore-storage.ts` shards them into per-industry Firestore docs on write and merges them on read; `components/shared/store-hydrator.tsx` loads only the slice the signed-in role is authorized to see (admin = all units + live sync; operator = its own unit).
- **Security:** all enforcement is in `firestore.rules` — role is immutable and cannot be self-assigned to admin; industry docs are readable/writable only by the regulator or the owning operator.

For a full contributor/architecture guide (data flow, security rules, file map, conventions, gotchas, deployment), see **[CLAUDE.md](CLAUDE.md)**.

---

_RSPCB JalRakshak — ETP · demonstration platform._
