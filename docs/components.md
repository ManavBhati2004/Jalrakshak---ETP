# Component Catalog — JalRakshak ETP

> A grouped, file-by-file catalog of every React component in the app. For each
> file: its path, a 1–2 line purpose, and its key export(s)/props. The catalog is
> written from the **current per-tenant Firestore code** — the data store is
> role-scoped and hydrated by `StoreHydrator`, not by any single `state/app`
> document. **Dead / unused** code is flagged explicitly throughout (and
> collected in one place under [Gotchas & invariants](#gotchas--invariants)).

---

## Overview

**What this is.** JalRakshak ETP is a client-only Next.js 16 (App Router,
Turbopack) app. All UI lives under `components/` and is split into seven groups:

| Group | Dir | Role |
| --- | --- | --- |
| **dashboard** | `components/dashboard/` | The authenticated command-center UI: overviews, tables, pipeline visualizers, nav chrome. |
| **shared** | `components/shared/` | Cross-cutting building blocks: logos, icons, counters, status badges, and the auth/data **bootstrap** (`StoreHydrator`). |
| **landing** | `components/landing/` + `components/landing/home/` | The public marketing route: a pinned 3D-scroll hero plus the below-the-fold home page. |
| **three** | `components/three/` | The WebGL/R3F river scene. **Documented separately** — see [`architecture/3d-landing-scene.md`](architecture/3d-landing-scene.md). |
| **ui** | `components/ui/` | shadcn/ui-style primitives on Radix (`radix-ui` unified package) + Tailwind v4. |
| **charts** | `components/charts/` | Recharts wrappers. **Entire module is dead code** (imported nowhere). |
| _root_ | `components/providers.tsx` | App-wide client providers (motion + tooltip). |

**Why it's shaped this way.** Two roles drive everything:
`monitoring-admin` (RSPCB "Monitoring Body", sees ALL units) and `etp` (a
single operator, sees ONLY its own unit). Components read from a Zustand data
store (`useDataStore`) whose contents are loaded and live-synced **per tenant**
by `StoreHydrator`; Firestore rules are the real security boundary, and most
components simply filter the already-authorized slice by `industryId`.

---

## Files

### `components/providers.tsx` — app-wide client providers
Wraps the whole tree in `MotionConfig reducedMotion="user"` and a
`TooltipProvider delayDuration={200}`. Mounted once in `app/layout.tsx`.
Export: `Providers({ children })`.

### Group: `components/dashboard/` (authenticated shell + panels)

| File | Purpose | Key export(s) |
| --- | --- | --- |
| `dashboard-shell.tsx` | Auth-gated layout frame for every `/dashboard/*` route: sidebar + topbar + animated page transitions. | `DashboardShell({ children })` |
| `sidebar.tsx` | Role-filtered, collapsible navigation. | `SidebarContent`, `DesktopSidebar` |
| `topbar.tsx` | Sticky header: mobile nav sheet, search, live alert badge, role/company dropdown, sign-out. | `Topbar()` |
| `page-header.tsx` | Reusable page title block (eyebrow / title / description / actions). **Server component.** | `PageHeader(props)` |
| `metric-card.tsx` | Animated KPI tile with icon, accent glow, optional delta/hint. | `MetricCard`, `MetricCardProps` |
| `admin-overview.tsx` | The `monitoring-admin` dashboard home: cluster-wide metrics, aggregate ETP pipeline, unit list, reports, recent submissions, alerts + approvals. | `AdminOverview()` |
| `etp-overview.tsx` | The `etp` operator dashboard home: own unit stats, today-vs-yesterday intake, water balance, pipeline, alerts, reading history + CSV export. | `EtpOverview()` |
| `pipeline-flow.tsx` | Vertical animated treatment-stage visualizer (flowing droplets, % bars). | `PipelineFlow({ flow })` |
| `approval-timeline.tsx` | Horizontal 4-step approval progress (submitted → verification → approved / rejected). | `ApprovalTimeline({ steps })` |
| `data-table.tsx` | Generic TanStack-Table wrapper: global search, sorting, pagination. | `DataTable`, `SortHeader` **(dead)** |
| `reports-panel.tsx` | 8 one-click CSV report exporters generated live from the store. | `ReportsPanel()` |

### Group: `components/shared/` (cross-cutting)

| File | Purpose | Key export(s) |
| --- | --- | --- |
| `store-hydrator.tsx` | **The auth + per-tenant data bootstrap.** Restores the session and loads/live-syncs the caller's authorized data slice. Renders nothing. | `StoreHydrator()` |
| `logo.tsx` | RSPCB JalRakshak wordmark + logo image, with `tone` variants. | `JalRakshakLogo(props)` |
| `icon.tsx` | String-keyed Lucide icon registry (for data-driven `icon: "Name"` fields). | `Icon({ name, … })` |
| `animated-counter.tsx` | Count-up number animation via Framer Motion motion values. | `AnimatedCounter(props)` |
| `status-badge.tsx` | Maps a status/severity string → a colored pill. | `StatusBadge(props)` |
| `section-reveal.tsx` | Scroll-in reveal wrapper. | `SectionReveal`; `StaggerReveal` **(dead)**; `staggerItem` **(dead)** |
| `dev-watermark.tsx` | Fixed "Digital Hammerr" credit badge (global, all routes). | `DevWatermark()` |
| `digital-hammer-logo.tsx` | `next/image` wrapper for the watermark logo asset. | `DigitalHammerLogo({ className })` |

### Group: `components/landing/` and `components/landing/home/`

| File | Purpose | Key export(s) |
| --- | --- | --- |
| `landing-experience.tsx` | Public route orchestrator: pinned 320vh scroll section, WebGL-vs-static decision, drives the 3D scene + overlay from one shared scroll value. | `LandingExperience()` |
| `scroll-overlay.tsx` | Text/CTA/pipeline layer over the hero; crossfades "polluted → clean" as you scroll. | `ScrollOverlay({ progress, onEnter, onSkip })` |
| `static-hero-background.tsx` | Pure CSS/SVG river fallback (no WebGL / reduced motion / loading placeholder). | `StaticHeroBackground({ clean })` |
| `site-header.tsx` | Sticky public nav bar with anchor links + "Enter Platform". | `SiteHeader()` |
| `site-footer.tsx` | Public footer: link columns + demo disclaimer. | `SiteFooter()` |
| `home/home-content.tsx` | Composes the below-the-fold home page. | `HomeContent()` |
| `home/hero-section.tsx` | Static gradient hero with `HERO_STATS` counters + CTAs. | `HeroSection()` |
| `home/about-slideshow.tsx` | Auto-advancing 4-slide Ken-Burns "About" carousel. | `AboutSlideshow()` |
| `home/contact-section.tsx` | Gradient contact card with (illustrative) demo contacts. | `ContactSection()` |

### Group: `components/three/` — 3D river scene (see the dedicated 3D doc)

These render the lazy WebGL hero. They are **out of scope for this catalog** and
fully documented in **[`architecture/3d-landing-scene.md`](architecture/3d-landing-scene.md)**;
listed here only so the map is complete.

| File | Purpose |
| --- | --- |
| `river-scene.tsx` | R3F `<Canvas>` root: `CameraRig` + `WaterPlane` + `SceneEnvironment`, all reading the shared `transition` ref. Export `RiverScene({ transition })`. |
| `water-plane.tsx` | Animated water mesh using the custom shader. |
| `scene-environment.tsx` | Sky/factory/pipeline/fish environment that morphs polluted → clean. |
| `shaders/water.ts` | GLSL vertex/fragment source for the water surface. |
| `types.ts` | `TransitionRef` = `MutableRefObject<{ value: number }>` — the shared 0→1 cinematic value driven by scroll and read in `useFrame`. |

### Group: `components/ui/` — primitives

**Live (imported somewhere in the app):** `button`, `dialog`, `dropdown-menu`,
`sheet`, `sonner`, `switch`, `table`, `tooltip`.

**Dead (defined, exported, imported nowhere):** `input`, `card`, `badge`,
`select`, `tabs`, `avatar`, `progress`, `scroll-area`, `textarea`, `skeleton`,
`separator`, `label`. See [Dead code](#dead--unused-code).

| File | Purpose | Status |
| --- | --- | --- |
| `button.tsx` | CVA button with 6 variants × 8 sizes; `asChild` via Radix `Slot`. | **live** |
| `dialog.tsx` | Radix Dialog set (overlay, content, header/footer/title/description). | **live** (`industries` page) |
| `dropdown-menu.tsx` | Full Radix dropdown-menu family. | **live** (`topbar`) |
| `sheet.tsx` | Radix Dialog styled as an edge drawer (4 sides). | **live** (`topbar` mobile nav) |
| `sonner.tsx` | Themed `Toaster` (Sonner) with custom status icons. | **live** (`app/layout.tsx`) |
| `switch.tsx` | Radix switch, `sm`/`default` sizes. | **live** (`settings` page) |
| `table.tsx` | Styled `<table>` primitives used by `DataTable`. | **live** (`data-table`) |
| `tooltip.tsx` | Radix tooltip + `TooltipProvider`. | **live** (`providers`) |
| `input.tsx` | Styled `<input>`. | **dead** |
| `card.tsx` | `Card*` family (header/title/description/action/content/footer). | **dead** |
| `badge.tsx` | CVA badge (6 variants). Note: dashboard uses `StatusBadge` instead. | **dead** |
| `select.tsx` | Radix Select family. | **dead** |
| `tabs.tsx` | Radix Tabs family (`default`/`line` variants). | **dead** |
| `avatar.tsx` | Radix Avatar + group/badge helpers. | **dead** |
| `progress.tsx` | Radix progress bar. | **dead** |
| `scroll-area.tsx` | Radix scroll-area + custom scrollbar. | **dead** |
| `textarea.tsx` | Styled `<textarea>`. | **dead** |
| `skeleton.tsx` | Pulsing placeholder box. | **dead** |
| `separator.tsx` | Radix separator (h/v). | **dead** |
| `label.tsx` | Radix label. | **dead** |

### Group: `components/charts/` — **entirely dead**

| File | Purpose | Status |
| --- | --- | --- |
| `index.tsx` | Recharts wrappers: `AreaTrend`, `MultiLineTrend`, `BarMini`, `RadialGauge`, `DonutBreakdown` (+ private `ChartTip`, `axisProps`). | **dead — module imported nowhere** |

---

## How it works

### 1. Where components mount (app shell)

`app/layout.tsx` mounts the four global pieces once, around every route:

```
<body>
  <StoreHydrator/>        ← components/shared/store-hydrator.tsx  (auth + data)
  <Providers>             ← components/providers.tsx (MotionConfig + TooltipProvider)
     {children}           ← the route (landing OR dashboard)
  </Providers>
  <DevWatermark/>         ← components/shared/dev-watermark.tsx (fixed credit)
  <Toaster/>              ← components/ui/sonner.tsx (top-right, richColors)
</body>
```

- `app/page.tsx` → `<LandingExperience/>` (public).
- `app/dashboard/*` layouts → `<DashboardShell>` wrapping each page.

### 2. Auth → per-tenant data bootstrap (`StoreHydrator`)

This is the spine of the whole app. It runs one `useEffect` that subscribes to
Firebase auth and, per session, loads exactly the slice the caller is allowed to
see (`components/shared/store-hydrator.tsx:36-131`).

```
onAuthStateChanged(auth)                         (store-hydrator.tsx:60)
        │
   ┌────┴─────────────────────────────┐
   │ no user                          │ user signed in
   ▼                                  ▼
setSession(null)              read users/{uid}  →  { role, industryId }   (79-86)
applyData(emptyData())        (default role "etp", industryId null)
resetSyncCaches()                     │
                          setSession({uid, role, industryId})
                          syncContext.ready = false   ← suppress writes (90-94)
                                      │
                 ┌────────────────────┴───────────────────────┐
                 │ role === "monitoring-admin"                 │ role === "etp" + industryId
                 ▼                                             ▼
      loadAllIndustries()  (99)                     loadOneIndustry(industryId)  (113)
      if count===0 → seedIndustries(buildSeedState())        applyData(data ?? emptyData())
                    then reload   (101-104)                   unsub = subscribeOne(industryId,…) (118)
      applyData(data)
      unsub = subscribeAll(…)   (110)                (no industryId → applyData(emptyData()))  (119-122)
                 └────────────────────┬───────────────────────┘
                                      ▼
                            syncContext.ready = true   (124)
```

Key invariants encoded here:
- **Least-privilege default.** A missing/broken `users/{uid}` profile falls back
  to `role = "etp"`, `industryId = null` (`:81-82`), never admin.
- **No seed clobber.** `applyData` flips `remoteApply.active = true` around
  `useDataStore.setState` so the remote snapshot is applied **without** being
  persisted back to Firestore (`:41-48`); `syncContext.ready` gates writes until
  the initial load finishes.
- **First-admin bootstrap.** An empty project is seeded from `buildSeedState()`
  on the first `monitoring-admin` sign-in only (`:100-104`).
- Sign-out clears the store to `emptyData()` and resets `syncContext`
  (`:63-72`). The UI store stays on localStorage (`useUIStore.persist.rehydrate()`).

### 3. Dashboard render path

```
/dashboard/*  route
   └─ DashboardShell (dashboard-shell.tsx)
        ├─ guard: authReady? role? canAccessPath(role, pathname)   (:21-31)
        │     • !role            → router.replace("/login")
        │     • wrong role path  → router.replace("/dashboard")
        │     • !authReady       → full-screen loader
        ├─ DesktopSidebar (sidebar.tsx)   ← width from useUIStore.sidebarCollapsed
        └─ Topbar (topbar.tsx) + <main>
              └─ AnimatePresence keyed on pathname → page content
```

The two dashboard **home** panels branch on role and both read the same store,
just scoped differently:

- `AdminOverview` reads all six arrays and derives cluster aggregates —
  `etpUnits = industries.filter(isIndividualETP)` (`admin-overview.tsx:27`), an
  aggregate pipeline summed across every unit (`:33-42`), and a merged
  `recentSubs` feed from `etpEntries` + `readings` (`:45-51`).
- `EtpOverview` filters everything by the session's `industryId`
  (`etp-overview.tsx:22,30,52,54`) and computes a **date-based** today/yesterday
  intake so "today" rolls over automatically at midnight (`:38-51`).

### 4. Data-driven icons & status

Two small shared components let the data layer stay string-only:

- `Icon` looks up a Lucide component from `REGISTRY` by `name` and falls back to
  `Circle` (`icon.tsx:68`). This is what lets constants like `ALERT_META`,
  `ROLES`, and `DASHBOARD_NAV` store `icon: "BellRing"` as plain strings and
  render them via `<Icon name={…}/>`.
- `StatusBadge` maps a raw status/severity string through `MAP` → a `Tone` →
  Tailwind classes in `TONE` (`status-badge.tsx:5-37`), lowercasing/​de-hyphenating
  the label. Unknown statuses fall back to the `muted` tone.

### 5. Landing scroll choreography

```
LandingExperience (landing-experience.tsx)
   reduced = usePrefersReducedMotion()      (:20)
   webgl   = useWebGLSupported()            (:21)
   use3D   = webgl !== false && !reduced    (:22)   ← optimistic 3D on first paint
   scrollYProgress (target: 320vh section)  (:24)
   t = useTransform(…, [0,0.66] → [0,1])    (:26)   ← finishes while pinned
        │  writes t → transition.current.value      (:27-29)
        ├─────────────┐
        ▼             ▼
   RiverScene      ScrollOverlay(progress=t)
   (dynamic,       (polluted↔clean crossfade + pipeline steps + Enter/Skip)
    ssr:false)     onEnter/onSkip → scroll to <HomeContent/>
   fallback: StaticHeroBackground
```

`HomeContent` then stacks `SiteHeader → HeroSection → AboutSlideshow →
ContactSection → SiteFooter` (`home/home-content.tsx:9-19`).

---

## Reference

### `components/providers.tsx`
- `Providers({ children })` — `<MotionConfig reducedMotion="user">` + `<TooltipProvider delayDuration={200}>`.

### dashboard/

**`DashboardShell({ children })`** (`dashboard-shell.tsx`)
- Reads `useUIStore.sidebarCollapsed`, `useAuthStore.role`, `useAuthStore.authReady`.
- Effect (`:21-31`): waits for `authReady`; `!role` → `/login`; `!canAccessPath(role, pathname)` → `/dashboard`.
- Renders a branded loader until `authReady && role` (`:33-43`).
- Main content is wrapped in `AnimatePresence mode="wait"` keyed on `pathname` (`:56-66`); left padding is `lg:pl-[264px]` / collapsed `lg:pl-[76px]`.

**`SidebarContent({ collapsed?, onNavigate? })`, `DesktopSidebar()`** (`sidebar.tsx`)
- `groupNav(role)` (`:16-24`) filters `DASHBOARD_NAV` by `item.roles.includes(role)` and buckets into `GROUP_ORDER = ["Overview","Monitoring","Governance"]` (`:14`).
- `isActive(pathname, href)` (`:26-29`): exact match for `/dashboard`, else prefix match.
- `DesktopSidebar` width `w-[264px]` / collapsed `w-[76px]`, toggled via `useUIStore.toggleSidebar`.

**`Topbar()`** (`topbar.tsx`)
- `admin = isAdmin(role)`; `roleMeta = ROLES.find(id===role) ?? ROLES[0]`; `company = industries.find(id===industryId)`.
- `activeAlerts` = count of `status==="active"` alerts, scoped by `admin || a.industryId === industryId` (`:36-39`); badge is gated on `useHydrated()` to avoid hydration mismatch (`:82`).
- Mobile nav via `Sheet` + `SidebarContent`; role menu via `DropdownMenu`; `signOut` = `logout()` then `router.push("/")` (`:41-44`).

**`PageHeader({ title, description?, eyebrow?, actions? })`** (`page-header.tsx`)
- Plain server component (no `"use client"`). Renders eyebrow / `<h1>` / description / right-aligned `actions`.

**`MetricCard(props: MetricCardProps)`** (`metric-card.tsx`)
- `MetricCardProps = { label; value: number; icon: string; accent?; suffix?; delta?: { value: string; positive? }; hint?; index? }`.
- Framer-Motion entrance staggered by `index` (`:31-34`); radial accent glow; value rendered via `<AnimatedCounter startOnView={false}/>` (`:61`).

**`AdminOverview()`** (`admin-overview.tsx`)
- `metrics = useDataStore(useShallow(selectMetrics))` (`:20`).
- `etpUnits = industries.filter(i => i.isIndividualETP)` (`:27`).
- `flow` — aggregate pipeline summed across units via `buildEtpStageFlow` (`:33-42`).
- `recentSubs` — merged `etpEntries` (ETP intake, m³) + `readings` (meter, `displayUnit(r.unit)`), sorted by `submittedAt`, top 6 (`:45-51`).
- `metricCards[]` — 7 KPI tiles (ETP Units, Total Industries, Pending Approvals, Rejected Entries, Non-Reporting, Active Alerts, ETP Entries) (`:53-61`).
- Private helper `ListPanel({ title, href, children, empty })` (`:180-194`) — panel with "View all" link and empty-state fallback.

**`EtpOverview()`** (`etp-overview.tsx`)
- Scoped to `industryId`: `industry = industries.find(id===industryId)`; empty state links to `/login` if no unit (`:56-63`).
- `mine` = own `etpEntries` sorted by `submittedAt` desc (`:30-33`); `latest = mine[0]`.
- Date-synced `todayStr`/`yesterdayStr` computed client-side (`:38-50`); `intake = dailyIntake(mine, todayStr, yesterdayStr)` (`:51`).
- `columns: ColumnDef<EtpEntry>[]` — Date, Fresh Water, ETP Inlet/Outlet/Reuse, RO Inlet/Reject/Permeate, Sludge→TSDF, Total Intake (m³), Status (`:75-95`).
- `handleDownload()` builds labeled rows and downloads `jalrakshak-etp-{id}-{today}.csv` via `toCSV` + local `download()` helper (`:97-117, 275-283`).
- Private helpers `Num({ v, unit? })` (`:265`) and `Stat({ icon, label, value, accent })` (`:285`).

**`PipelineFlow({ flow: FlowNode[] })`** (`pipeline-flow.tsx`)
- `STATUS` map: `normal`/`warning`/`critical` → color+label (`:9-13`); `TYPE_ICON`: `raw`/`treatment`/`recovery`/`energy` (`:15`).
- `maxVal = Math.max(...values) || 1` guards all-zero flows (avoids `NaN%`) (`:18`); each node shows `pct` of max with an animated fill bar.

**`ApprovalTimeline({ steps: ApprovalStep[] })`** (`approval-timeline.tsx`)
- `ICONS` map: `submitted→Send`, `verification→Search`, `approved→Check`, `rejected→X` (`:7`).
- Node color: rejected `#f87171`, done `#22d3ee`, else `#475569` (`:16`); connector tinted by the **next** step's `done` (`:31`).

**`DataTable<TData,TValue>(props)`** (`data-table.tsx`)
- `DataTableProps = { columns: ColumnDef[]; data: TData[]; searchPlaceholder?; toolbar?; pageSize? = 8; emptyMessage? = "No results." }` (`:26-33`).
- TanStack Table with core/sorted/filtered/pagination row models; global-filter search box; sortable headers show a `ArrowUpDown`; pager appears only when `getPageCount() > 1` (`:124`).
- **`SortHeader({ children })`** (`:144-146`) — a `<span className="font-medium">` wrapper. **Exported but imported nowhere → dead.**

**`ReportsPanel()`** (`reports-panel.tsx`)
- Local `TODAY = "2026-06-20"` constant used for the daily filter and filenames (`:20`).
- `REPORTS[]` — 8 exporters: `daily`, `monthly`, `industry`, `compliance`, `pending`, `rejected`, `nonreporting`, `etp` (`:40-49`). Each has `{ key, title, desc, icon, color, count, build() }`.
- `build()` strips nested/non-tabular fields before CSV: `compliance` drops `trend`; `pending`/`rejected` drop `timeline` + `alerts` (`:44-46`).
- `handleExport` shows a Sonner loading→success toast and downloads `jalrakshak-{key}-{TODAY}.csv` via `toCSV` (`:51-60`).

### shared/

**`StoreHydrator()`** (`store-hydrator.tsx`) — see [How it works §2](#2-auth--per-tenant-data-bootstrap-storehydrator). Renders `null`. Depends on `firestore-storage` helpers: `remoteApply`, `syncContext`, `resetSyncCaches`, `loadAllIndustries`, `loadOneIndustry`, `subscribeAll`, `subscribeOne`, `seedIndustries`, `emptyData`, `StoreData`.

**`JalRakshakLogo({ className?, size? = 36, showText? = true, tone? = "auto" })`** (`logo.tsx`)
- Renders `/rspcb-logo.jpeg` (via `next/image`, `priority`) + optional "JalRakshak / RSPCB · Balotra" wordmark. `tone`: `"auto" | "light" | "dark"`.

**`Icon({ name, className?, strokeWidth? = 2 })`** (`icon.tsx`)
- `REGISTRY: Record<string, LucideIcon>` of 24 curated icons (`:32-57`); unknown `name` → `Circle` fallback (`:68`).

**`AnimatedCounter(props)`** (`animated-counter.tsx`)
- `{ value; duration? = 1.6; decimals? = 0; prefix? = ""; suffix? = ""; compact? = false; className?; startOnView? = true }`.
- Uses `useMotionValue` + `animate`; `useInView(once, margin:"-40px")`; when `startOnView === false` it animates immediately. Renders `formatNumber`/`compactNumber`. SSR-safe: initial text is `0`.

**`StatusBadge({ status, label?, className?, dot? = true })`** (`status-badge.tsx`)
- `Tone = "success"|"warning"|"danger"|"info"|"muted"|"cyan"`; `TONE` = tailwind class map; `MAP` = status→tone (`active`/`compliant`/`approved`→success, `pending`/`warning`→warning, `rejected`/`critical`/`non-reporting`→danger, `submitted`/`verification`→info, …). Unknown → `muted`. Label auto de-hyphenated + `capitalize`.

**`section-reveal.tsx`**
- **`SectionReveal({ children, className?, delay? = 0, y? = 28, once? = true })`** — `whileInView` fade/translate reveal. **Live** (used across landing sections).
- **`StaggerReveal({ children, className?, stagger? = 0.12, once? = true })`** — staggered container. **Dead — imported nowhere.**
- **`staggerItem: Variants`** — child variant for the above. **Dead — imported nowhere.**

**`DevWatermark()`** (`dev-watermark.tsx`) — fixed bottom-right link to `https://digitalhammerr.com/`, wrapping `DigitalHammerLogo`. Global (mounted in `app/layout.tsx`).

**`DigitalHammerLogo({ className? })`** (`digital-hammer-logo.tsx`) — `next/image` of `/digital-hammer-logo.png` (32×32).

### landing/ + landing/home/

**`LandingExperience()`** (`landing-experience.tsx`)
- `RiverScene` via `dynamic(..., { ssr: false, loading: () => <StaticHeroBackground/> })` (`:11-14`).
- `use3D = webgl !== false && !reduced` (`:22`); pinned `h-[320vh]` section with a `sticky top-0 h-screen` stage (`:35-36`).
- `t = useTransform(scrollYProgress, [0, 0.66], [0, 1], { clamp: true })` written into `transition.current.value` and passed to `ScrollOverlay progress` (`:26-40`).
- `goHome()` smooth-scrolls to the `homeRef` `<HomeContent/>` (`:31`).

**`ScrollOverlay({ progress, onEnter, onSkip })`** (`scroll-overlay.tsx`)
- `STEPS = ["Flow Meter","ETP","RO","MEE","Treated"]` (`:10`); local `p` mirrors `progress` for the step math.
- Derived MotionValues: `pollutedOpacity`, `cleanOpacity`, `hintOpacity`, `topBarOpacity`, `enterOpacity`, `enterPointer`, `barWidth` (`:24-30`). Enter CTA fires `onEnter`; "Skip intro" fires `onSkip`.

**`StaticHeroBackground({ clean? = false })`** (`static-hero-background.tsx`)
- Pure CSS gradient + SVG waves; `clean` toggles polluted (olive/green) ↔ clean (blue) palettes. Used in **two** modes: `clean` (no-WebGL/reduced) and un-`clean` (dynamic-import loading placeholder).

**`SiteHeader()`** (`site-header.tsx`)
- `useScrolled(40)` toggles the condensed/blurred style; `LINKS` = `#overview #etp #platform #about #contact` anchors + `/login` CTA; mobile menu via local `open` state.

**`SiteFooter()`** (`site-footer.tsx`)
- Three `COLUMNS` (Platform / Monitoring / Governance) of links (mostly `/login`); dynamic `© {new Date().getFullYear()}`; "Demo only" disclaimer pill.

**`HomeContent()`** (`home/home-content.tsx`) — composes `SiteHeader`, `HeroSection`, `AboutSlideshow`, `ContactSection`, `SiteFooter`.

**`HeroSection()`** (`home/hero-section.tsx`) — static gradient hero; maps `HERO_STATS` to `<AnimatedCounter startOnView={false}/>` tiles; CTAs to `/login` and `#etp`.

**`AboutSlideshow()`** (`home/about-slideshow.tsx`)
- `SLIDES[]` = 4 slides (Unsplash `img` URLs, `icon`, `eyebrow`, `title`, `body`, `color`) (`:10-43`).
- Autoplay every `5200ms` unless `paused` (hover); Ken-Burns scale; arrows + dots; `AnimatePresence` crossfade.

**`ContactSection()`** (`home/contact-section.tsx`) — gradient card + 4 illustrative `CONTACTS`; CTA "Launch the demo" → `/login`.

### ui/ (live primitives — exports)

| File | Exports |
| --- | --- |
| `button.tsx` | `Button`, `buttonVariants`. Props: `React.ComponentProps<"button"> & VariantProps & { asChild? }`. `variant`: `default \| outline \| secondary \| ghost \| destructive \| link`; `size`: `default \| xs \| sm \| lg \| icon \| icon-xs \| icon-sm \| icon-lg`. |
| `dialog.tsx` | `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent` (`showCloseButton? = true`), `DialogHeader`, `DialogFooter` (`showCloseButton? = false`), `DialogTitle`, `DialogDescription`. |
| `dropdown-menu.tsx` | `DropdownMenu`, `…Trigger`, `…Content` (`align? = "start"`, `sideOffset? = 4`), `…Group`, `…Label`, `…Item` (`inset?`, `variant?: default\|destructive`), `…CheckboxItem`, `…RadioGroup`, `…RadioItem`, `…Separator`, `…Shortcut`, `…Sub`, `…SubTrigger`, `…SubContent`, `…Portal`. |
| `sheet.tsx` | `Sheet`, `SheetTrigger`, `SheetClose`, `SheetContent` (`side? = "right"`, `showCloseButton? = true`), `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`. |
| `sonner.tsx` | `Toaster` — themed via `next-themes`, custom `success/info/warning/error/loading` icons. |
| `switch.tsx` | `Switch` (`size?: sm \| default`). |
| `table.tsx` | `Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableHead`, `TableRow`, `TableCell`, `TableCaption`. |
| `tooltip.tsx` | `Tooltip`, `TooltipTrigger`, `TooltipContent` (`sideOffset? = 0`), `TooltipProvider` (`delayDuration? = 0`). |

### ui/ (dead primitives — exports, for completeness)

| File | Exports (all unused) |
| --- | --- |
| `input.tsx` | `Input` |
| `card.tsx` | `Card`, `CardHeader`, `CardFooter`, `CardTitle`, `CardAction`, `CardDescription`, `CardContent` |
| `badge.tsx` | `Badge`, `badgeVariants` (`variant`: default/secondary/destructive/outline/ghost/link) |
| `select.tsx` | `Select`, `SelectContent`, `SelectGroup`, `SelectItem`, `SelectLabel`, `SelectScrollDownButton`, `SelectScrollUpButton`, `SelectSeparator`, `SelectTrigger`, `SelectValue` |
| `tabs.tsx` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `tabsListVariants` (`variant`: default/line) |
| `avatar.tsx` | `Avatar`, `AvatarImage`, `AvatarFallback`, `AvatarGroup`, `AvatarGroupCount`, `AvatarBadge` (`size`: default/sm/lg) |
| `progress.tsx` | `Progress` |
| `scroll-area.tsx` | `ScrollArea`, `ScrollBar` |
| `textarea.tsx` | `Textarea` |
| `skeleton.tsx` | `Skeleton` |
| `separator.tsx` | `Separator` |
| `label.tsx` | `Label` |

### charts/ (dead module — exports, for completeness)
`AreaTrend`, `MultiLineTrend`, `BarMini`, `RadialGauge`, `DonutBreakdown`
(`components/charts/index.tsx`). Private: `ChartTip`, `axisProps`. All take
`TrendPoint[]`-shaped data and render Recharts. **Nothing imports this file.**

---

## Gotchas & invariants

### Dead / unused code
Confirmed by repo-wide search — imported nowhere in `app/` or `components/`
(only self-defined, and mentioned in `CLAUDE.md`):

1. **`components/charts/index.tsx` — the whole module.** `AreaTrend`,
   `MultiLineTrend`, `BarMini`, `RadialGauge`, `DonutBreakdown` are never used.
   Dashboard data-viz is done with hand-rolled `PipelineFlow` bars and inline
   stat cards, not Recharts.
2. **12 UI primitives:** `input`, `card`, `badge`, `select`, `tabs`, `avatar`,
   `progress`, `scroll-area`, `textarea`, `skeleton`, `separator`, `label`.
   Notably `badge.tsx` is shadowed by the app's own `StatusBadge`
   (`components/shared/status-badge.tsx`), and `input`/`textarea` are shadowed by
   raw styled `<input>`s (e.g. `data-table.tsx:64`, `topbar.tsx:64`).
3. **`SortHeader`** in `data-table.tsx:144` — exported, never imported. Sortable
   headers are rendered inline in `DataTable` instead.
4. **`StaggerReveal`** and **`staggerItem`** in `section-reveal.tsx:42,66` —
   exported, never imported. Only `SectionReveal` from that file is used.

### Behavioral invariants
- **Role scoping is client-side convenience, not security.** Components filter by
  `industryId` (`EtpOverview`, `Topbar.activeAlerts`) and `DashboardShell` guards
  routes with `canAccessPath`, but the real boundary is `firestore.rules` +
  `StoreHydrator` only loading the authorized slice. An operator's store simply
  never contains other tenants' data.
- **Least-privilege auth default.** `StoreHydrator` defaults an unknown/broken
  profile to `role="etp"`, `industryId=null` (`store-hydrator.tsx:81-82`).
- **Remote apply must not persist.** `applyData` sets `remoteApply.active=true`
  around `setState` so Firestore snapshots don't loop back as writes
  (`store-hydrator.tsx:41-48`); writes are additionally gated by
  `syncContext.ready`.
- **Units display quirk.** Water-balance volumes are stored as "KL" but rendered
  as **m³** — via `displayUnit()` for meter readings, and hard-coded `m³` labels
  in `EtpOverview`/`admin-overview` intake tiles. Capacities render as **KLD**.
  `Total Water Intake = freshWaterConsumption + etpReuse + roPermeate`
  (label at `etp-overview.tsx:164`).
- **Hydration safety.** `AnimatedCounter` always SSR-renders `0`; `Topbar`'s
  alert badge is gated on `useHydrated()`; `EtpOverview` computes today's date in
  an effect (not during render) to avoid a server/client mismatch.
- **`ReportsPanel` "today" is frozen.** `TODAY = "2026-06-20"`
  (`reports-panel.tsx:20`) is a hard-coded date used for the daily filter and
  filenames — it is **not** `new Date()`. (`EtpOverview`'s own CSV export does use
  the real current date.)
- **Radix comes from the unified `radix-ui` package**, not `@radix-ui/react-*`
  (e.g. `import { Dialog as DialogPrimitive } from "radix-ui"`), and `asChild` is
  wired through `Slot.Root`. Styling relies on Tailwind v4 `data-*` state variants
  (`data-open`, `data-closed`, `data-[side=…]`) and `data-slot` attributes.
- **Landing anchors without targets.** `SiteHeader`/`SiteFooter`/`HeroSection`
  link to `#etp` and `#platform`, but `HomeContent` only renders
  `#overview`/`#about`/`#contact` sections — those two anchors currently scroll
  nowhere.
- **External images on the landing carousel.** `AboutSlideshow` `SLIDES` load
  Unsplash URLs through `next/image`, so they depend on
  `next.config` remote-image allowlisting and network availability.
- **`PageHeader` is the only non-`"use client"` component in the dashboard group**
  — keep it prop-only (no hooks) so it can stay a server component.

---

## Related files

| Path | Why it matters |
| --- | --- |
| `app/layout.tsx` | Mounts `StoreHydrator`, `Providers`, `DevWatermark`, `Toaster` globally. |
| `app/page.tsx` | Renders `LandingExperience`. |
| `app/dashboard/**` | Route pages wrapped by `DashboardShell`; consume `MetricCard`, `DataTable`, `PageHeader`, `PipelineFlow`, `ApprovalTimeline`, `StatusBadge`, dialogs, etc. |
| `lib/store/data.ts` | `useDataStore`, `selectMetrics`, `dailyIntake`, `buildSeedState` — the store every dashboard component reads. |
| `lib/store/auth.ts` | `useAuthStore`, `isAdmin` — role/session state consumed by shell, sidebar, topbar, overviews. |
| `lib/store/ui.ts` | `useUIStore` — sidebar collapse + persisted UI prefs. |
| `lib/data/firestore-storage.ts` | Per-tenant load/subscribe/seed helpers `StoreHydrator` orchestrates. |
| `lib/data/etp-flow.ts` | `buildEtpStageFlow` — source of `FlowNode[]` for `PipelineFlow`. |
| `lib/constants.ts` | `DASHBOARD_NAV`, `ROLES`, `ALERT_META`, `STATUS_COLOR`, `complianceStatus`, `canAccessPath`, `HERO_STATS`. |
| `lib/utils.ts` | `cn`, `formatNumber`, `compactNumber`, `formatDate`, `timeAgo`, `displayUnit`, `toCSV`. |
| `lib/hooks/use-capabilities.ts` | `usePrefersReducedMotion`, `useWebGLSupported`, `useScrolled` — used by the landing components. |
| `lib/hooks/use-hydrated.ts` | `useHydrated` — hydration gate for `Topbar`. |
| `lib/types.ts` | `FlowNode`, `EtpEntry`, `ApprovalStep`, `RoleId`, `TrendPoint`, … the prop/domain types quoted above. |
| `firestore.rules` | The actual per-tenant security boundary the UI relies on. |
| [`architecture/3d-landing-scene.md`](architecture/3d-landing-scene.md) | Deep-dive on `components/three/*` (camera, water shader, environment, `TransitionRef`). |
| `docs/pages/01-landing.md` | Companion page-level doc for the landing route flow. |
