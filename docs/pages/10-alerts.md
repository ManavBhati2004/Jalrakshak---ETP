# `/dashboard/alerts` — Alert Center

> Route: `/dashboard/alerts` · File: `app/dashboard/alerts/page.tsx` · Roles: **`monitoring-admin` only** (RSPCB Monitoring Body) · Rendered by: `AlertsPage` (default export), wrapped by `DashboardShell` via `app/dashboard/layout.tsx`

---

## Purpose

The Alert Center is the regulator's single triage surface for every automatically-flagged event across all monitored ETP units. The engine raises alerts the moment operators submit readings or water-balance entries (or when the regulator rejects an entry), and this page lets the Monitoring Body:

- See a live severity roll-up of **active** alerts (critical / high / medium / low tiles).
- Filter the alert stream by lifecycle status (Active / Acknowledged / Resolved / All).
- Triage each alert with two actions — **Acknowledge** (mark seen) and **Resolve** (close out).

The page header (`app/dashboard/alerts/page.tsx:43-47`) frames it under the eyebrow **"Governance"**, title **"Alert Center"**, and description: *"The engine flags late, zero, excess, missing-photo, non-reporting and rejected events the moment they occur."*

This is a **read-and-triage** screen: alerts are *created* elsewhere (in the data-store submit/decide actions), and this page only mutates their `status`.

---

## Access & gating

This is a dashboard route, so access is governed at two layers:

1. **Nav visibility** — `DASHBOARD_NAV` lists Alerts under group "Governance" with `roles: ADMIN` (`lib/constants.ts:51`), so the sidebar link only renders for `monitoring-admin`. The lucide icon is `BellRing`.

2. **Route gate (redirect)** — `/dashboard/alerts` is in `ADMIN_ONLY_PATHS` (`lib/constants.ts:54-61`). `canAccessPath(role, pathname)` (`lib/constants.ts:65-72`) uses a segment-aware match and returns `false` for an `etp` operator hitting any admin-only path. `DashboardShell` enforces this in an effect (`components/dashboard/dashboard-shell.tsx:21-31`):
   - If `!authReady` → render a loading shell (logo + shimmer, `dashboard-shell.tsx:33-43`); no redirect yet.
   - If `authReady && !role` → `router.replace("/login")`.
   - If `authReady && role && !canAccessPath(role, pathname)` → `router.replace("/dashboard")`.

   So an `etp` operator who navigates directly to `/dashboard/alerts` is bounced to `/dashboard`. There is **no per-page role guard inside `AlertsPage` itself** — the shell is the boundary.

3. **Data-scope gating (the real isolation)** — even the client redirect is backstopped by data scoping. `StoreHydrator` (`components/shared/store-hydrator.tsx:97-122`) loads only the caller's authorized slice: a `monitoring-admin` loads/live-syncs **every** industry (`loadAllIndustries` + `subscribeAll`), while an `etp` operator loads/live-syncs **only its own** unit (`loadOneIndustry` + `subscribeOne`). Tenant isolation is ultimately enforced server-side by `firestore.rules`. Consequently the `alerts` array this page reads is already the full cross-tenant set for an admin.

---

## Data — store reads & writes

All state comes from the Zustand data store (`useDataStore`, `lib/store/data.ts`). No `useAuthStore` reads occur in this component.

### Reads (selectors)

| Selector | Source | Purpose |
|---|---|---|
| `alerts` | `useDataStore((s) => s.alerts)` — `page.tsx:26` | The flat `Alert[]` array (all tenants, merged) |
| `acknowledgeAlert` | `useDataStore((s) => s.acknowledgeAlert)` — `page.tsx:27` | Action, bound to `acknowledge` |
| `resolveAlert` | `useDataStore((s) => s.resolveAlert)` — `page.tsx:28` | Action, bound to `resolve` |

### Writes (actions)

Both actions are one-line status mutations in the store (`lib/store/data.ts:433-436`):

```ts
acknowledgeAlert: (id) =>
  set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "acknowledged" } : a)) })),
resolveAlert: (id) =>
  set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, status: "resolved" } : a)) })),
```

- They map over `alerts` and flip the matched alert's `status` to `"acknowledged"` / `"resolved"`; every other alert object is returned unchanged (referential identity preserved, so only the one row re-renders).
- Because the store is wrapped in `persist(..., { storage: firestoreStorage })` (`data.ts:122-123, 440-449`), this `set` triggers a write. `firestore-storage` shards the flat state by `industryId` and writes each affected `industries/{id}` document (`shardByIndustry`, `lib/data/firestore-storage.ts:110-141`). Since every alert carries an `industryId` in practice, the status change is persisted into that tenant's document and — for an admin subscribed via `subscribeAll` — mirrored to Firestore.
- The write is **suppressed during remote application**: `StoreHydrator.applyData` sets `remoteApply.active = true` around `setState`, so live-sync snapshots don't echo back as writes. User-initiated Ack/Resolve run with `remoteApply.active === false`, so they persist normally.

### Local (component) state

```ts
const [tab, setTab] = useState<(typeof STATUS_TABS)[number]["key"]>("active"); // page.tsx:29
```

Two `useMemo`-derived values:

- **`sevCounts`** (`page.tsx:31-34`) — counts of **active** alerts per severity: it first filters `alerts` to `status === "active"`, then builds a `Record<AlertSeverity, number>` over `SEVERITIES = ["critical","high","medium","low"]`. Recomputed on any `alerts` change.
- **`filtered`** (`page.tsx:36-39`) — a copy of `alerts` sorted by `createdAt` **descending** (`b.createdAt.localeCompare(a.createdAt)`), then filtered to the active tab (`tab === "all"` shows everything; otherwise `a.status === tab`). Recomputed on `alerts` or `tab` change.

---

## Layout & sections

The page is a single vertical stack (`<div className="space-y-6">`, `page.tsx:42`). Blocks in render order:

### 1. Page header — `page.tsx:43-47`
`<PageHeader>` (`components/dashboard/page-header.tsx`) with eyebrow **"Governance"**, title **"Alert Center"**, and the descriptive subline. No `actions` slot.

### 2. Severity summary tiles — `page.tsx:49-61`
A responsive grid (`grid-cols-2 sm:grid-cols-4`) of four tiles, one per severity in `SEVERITIES` order → **critical, high, medium, low**. Each tile (`rounded-2xl border bg-card p-4`) shows:
- A colored dot (`h-2.5 w-2.5 rounded-full`) whose `background` is `SEVERITY_COLOR[s]`.
- The severity name, `capitalize text-muted-foreground`.
- The **active** count `sevCounts[s]` in large display type, colored with `SEVERITY_COLOR[s]`.

Counts reflect **active alerts only** (acknowledged/resolved alerts are excluded from these tiles).

### 3. Status tabs — `page.tsx:63-76`
A wrapping flex row of four pill buttons from `STATUS_TABS` (`page.tsx:16-21`):

| Key | Label |
|---|---|
| `active` | Active |
| `acknowledged` | Acknowledged |
| `resolved` | Resolved |
| `all` | All |

The active pill gets `bg-primary/15 text-primary ring-1 ring-primary/30`; inactive pills are `text-muted-foreground hover:bg-muted` (`page.tsx:68-71`). Clicking calls `setTab(t.key)`. Default tab is **`active`**.

### 4. Alert list — `page.tsx:78-137`
A `space-y-3` column wrapping an `AnimatePresence mode="popLayout"` (`framer-motion`) over `filtered`. Each alert is a `motion.div` with `layout` animation (enter: fade + slide from `x:-12`; exit: fade + slide to `x:12`; `duration 0.3`), keyed by `a.id`. Row layout (`flex items-start gap-4 rounded-2xl border bg-card p-4`):

- **Icon chip** (`page.tsx:92-97`) — an 11×11 rounded square. `meta = ALERT_META[a.type]`; background is `${meta.color}1a` (the type color at ~10% alpha), foreground `meta.color`, rendering `<Icon name={meta.icon} />`.
- **Body** (`page.tsx:98-110`):
  - Title row: `a.title` (bold) + a severity `<StatusBadge status={a.severity} dot={false} />` + — only when `a.status !== "active"` — a status `<StatusBadge status={a.status} />` (so "acknowledged"/"resolved" get a badge; active rows show none).
  - `a.message` in muted text.
  - Footer meta row (`text-[11px]`): `a.industryName` (if set), then `· {a.cetpId}` (capitalized, if set), then always `· {timeAgo(a.createdAt)}`.
- **Action buttons** (`page.tsx:111-125`) — see next section. Rendered per `a.status`.

### 5. Empty state — `page.tsx:131-136`
When `filtered.length === 0`, a dashed-border panel shows a `BellRing` icon and **"No alerts in this view."** (This is *per-tab* — e.g. an empty Resolved tab shows it even if active alerts exist.)

---

## Forms & validation

**N/A** — this page has no form, no inputs, and no zod schema. Interaction is limited to tab switching and the two per-row action buttons.

---

## Key flows & logic

### Deriving the view
1. On mount `tab = "active"`.
2. `sevCounts` filters active alerts and tallies per severity → drives the four tiles.
3. `filtered` sorts all alerts newest-first by `createdAt`, then narrows to the selected tab.
4. The list maps `filtered`, resolving `ALERT_META[a.type]` for icon/color and rendering the appropriate action buttons for the row's `status`.

### Acknowledge / Resolve pipeline
Buttons are conditioned on `a.status`:

- **`status === "active"`** (`page.tsx:111-120`) → two buttons:
  - **Ack** — `<Button variant="outline">`: `onClick={() => { acknowledge(a.id); toast("Alert acknowledged"); }}` (icon `Check`).
  - **Resolve** — primary `<Button>`: `onClick={() => { resolve(a.id); toast.success("Alert resolved"); }}` (icon `CircleCheck`).
- **`status === "acknowledged"`** (`page.tsx:121-125`) → a single **Resolve** button (same handler/toast). No re-Ack.
- **`status === "resolved"`** → **no buttons** (neither branch matches).

Effect of a click, step by step:
1. Handler calls `acknowledge(a.id)` or `resolve(a.id)` → store `set` flips that alert's `status` (`data.ts:433-436`).
2. A Sonner toast fires — plain `toast("Alert acknowledged")` for Ack, `toast.success("Alert resolved")` for Resolve.
3. `sevCounts` and `filtered` re-memoize:
   - The active-severity tile count decrements (the alert left `active`).
   - On the **Active** tab, the row's `status` no longer matches `tab`, so it drops out of `filtered` and animates out via `AnimatePresence` exit (`opacity → 0`, `x → 12`).
   - On the **All** tab the row stays but now shows a status badge and (for resolve) loses its buttons.
4. The `persist` middleware serializes and writes the affected tenant's `industries/{id}` doc to Firestore (unless suppressed by `remoteApply`). The change survives reload and propagates to other admin sessions via `subscribeAll`.

### Where alerts come from (context for triage)
This page never *creates* alerts. Producers live in the data store and seed:
- `submitReading` (`data.ts:127-212`) → `late-submission`, `zero-reading`, `capacity-exceeded`/`high-flow`, `missing-photo`.
- `submitEtpEntry` (`data.ts:214-291`) → `zero-reading`, `capacity-exceeded`/`high-flow` (on `totalWaterIntake`).
- `raiseEtpInletAlert` (`data.ts:296-319`) → a standalone `capacity-exceeded` when an ETP Inlet exceeds sanctioned ETP capacity (entry blocked client-side; no approval).
- `decideApproval` with `decision === "rejected"` (`data.ts:321-343`) → `rejected-entry`.
- `buildAlerts(readings)` seed (`lib/data/seed.ts:189-229`) → the initial demo set, including the only source of `non-reporting`.

Newly-created alerts are prepended (`status: "active"`), so they land at the top of the newest-first list and increment the severity tiles.

---

## The 9 alert types (`ALERT_META`, `lib/constants.ts:93-106`)

`ALERT_META` maps each `AlertType` → `{ label, icon, severity, color }`. Severity here is the **canonical** severity stamped onto every alert of that type at creation time (`alert.severity = ALERT_META[type].severity`), and `color` drives the row's icon chip.

| Type | Label | Severity | Icon (lucide) | Color | Where produced |
|---|---|---|---|---|---|
| `late-submission` | Late Submission | `medium` | `Clock` | `#f59e0b` | `submitReading` when the reading time is past the window (morning > 08:30, evening > 20:30, `isLateFor` `data.ts:114-120`); seed late readings |
| `zero-reading` | Zero Reading | `high` | `MinusCircle` | `#f87171` | `submitReading` when `difference === 0` and meter ≠ Energy Meter; `submitEtpEntry` when `totalWaterIntake === 0`; seed |
| `high-flow` | High Flow | `high` | `TrendingUp` | `#fb923c` | `submitReading` / `submitEtpEntry` when volume > 85% of `permittedKLD` **but not over it** (the `else if` after capacity-exceeded); seed |
| `capacity-exceeded` | Capacity Exceeded | `critical` | `AlertOctagon` | `#ef4444` | `submitReading` / `submitEtpEntry` when volume > `permittedKLD`; `raiseEtpInletAlert` when ETP Inlet > `etpCapacity`; seed |
| `non-reporting` | Non Reporting | `high` | `WifiOff` | `#f87171` | **Seed only** — for industries whose `status === "non-reporting"` (`seed.ts:210-211`). No runtime producer |
| `reading-mismatch` | Reading Mismatch | `medium` | `GitCompareArrows` | `#fbbf24` | **Defined but never produced** anywhere in the codebase (see gotchas) |
| `repeated-reading` | Repeated Reading | `medium` | `Repeat` | `#fbbf24` | **Defined but never produced** anywhere in the codebase (see gotchas) |
| `missing-photo` | Missing Photo | `low` | `ImageOff` | `#94a3b8` | `submitReading` when `!hasPhoto`; seed |
| `rejected-entry` | Rejected Entry | `high` | `XCircle` | `#f87171` | `decideApproval` on `rejected`; seed (suspended consents + rejected readings) |

### Severity palette (`SEVERITY_COLOR`, `lib/constants.ts:108-113`)
Drives the **summary tile** dot + count color (independent of a type's own `color`):

| Severity | Color |
|---|---|
| `low` | `#94a3b8` (slate) |
| `medium` | `#fbbf24` (amber) |
| `high` | `#fb923c` (orange) |
| `critical` | `#ef4444` (red) |

Note two distinct color systems: **tiles** use `SEVERITY_COLOR[severity]`; **row icon chips** use `ALERT_META[type].color`. They deliberately differ — e.g. a `high` type like `zero-reading` shows a `#f87171` chip, while the `high` tile shows `#fb923c`.

### Severity badge coloring (`StatusBadge`)
The per-row severity badge (`<StatusBadge status={a.severity} dot={false} />`) maps through `StatusBadge`'s `MAP` (`components/shared/status-badge.tsx:14-37`), **not** through `SEVERITY_COLOR`: `critical`/`high` → `danger` (red), `medium`/`warning` → `warning` (amber), `low` → `muted`. The status badge (acknowledged/resolved) maps `acknowledged → info` (blue) and `resolved → success` (emerald).

---

## Units & formatting

- **Time:** row footers use `timeAgo(a.createdAt)` (`lib/utils.ts:35-45`) → "just now" / "Nm ago" / "Nh ago" / "Nd ago". Because it is relative to `Date.now()`, seed alerts render with an elapsed offset from their `createdAt`.
- **KLD vs m³:** this page displays **no volumetric values** — alert `title`/`message` are pre-composed strings from the producers. Where those messages embed volumes, the phrasing is baked in at creation. For example `raiseEtpInletAlert` writes `"ETP Inlet {etpInlet} m³ exceeds sanctioned ETP capacity {etpCapacity} KLD ..."` (`data.ts:308`) — i.e. the intake volume in **m³** against the sanctioned capacity in **KLD**, consistent with the app-wide convention (`displayUnit()` renders stored `KL` as `m³`). Reading/entry alert messages from the store use the raw `unit` (e.g. `KL`). The Alert Center itself does no unit conversion.
- Counts (tiles) are plain integers, no locale formatting.

---

## Edge cases & gotchas

- **Two unreachable alert types.** `reading-mismatch` and `repeated-reading` exist in the `AlertType` union (`lib/types.ts:164-165`) and in `ALERT_META`, complete with icons/colors, but **no code path ever creates them** (no seed `add(...)`, no store `push(...)`). They can appear in the type table but will never render as real rows. If you extend detection logic, wire producers for these.
- **`non-reporting` never fires at runtime.** It is only seeded for pre-existing non-reporting units; the live submit paths don't detect silence, so a unit going quiet after seed won't auto-raise one.
- **Tiles count active only.** The summary reflects `status === "active"` (`page.tsx:32`). Acknowledging an alert immediately decrements its tile even though the alert still exists — the tiles measure the *open queue*, not total volume.
- **Empty state is per-tab.** "No alerts in this view." shows whenever the *current tab* is empty, which can look like "no alerts" when only, say, the Resolved bucket is empty. Switch tabs / use **All** to confirm.
- **Resolved is terminal in the UI.** A `resolved` alert has no buttons — there's no un-resolve or re-open path from this page. The only way back is a data reset (`resetData`) or a fresh seed.
- **No confirmation on actions.** Ack/Resolve fire immediately on click (only a toast, no dialog). There is no undo.
- **Alerts with a null `industryId` are dropped on persist.** `shardByIndustry` skips alerts where `!a.industryId` (`firestore-storage.ts:132-135`) so a system-level alert can't leak into a tenant doc — but it also means such an alert would **not** be persisted and would vanish on the next remote sync. In current code every producer stamps an `industryId`, so this is latent, not active.
- **Live-sync can reorder / replace rows mid-triage.** For an admin, `subscribeAll` pushes fresh snapshots into the store; a concurrent submission elsewhere can prepend new alerts and re-run the memos while you're reading. `AnimatePresence` animates the churn but the list is not frozen.
- **Sort is lexicographic on ISO strings.** `createdAt.localeCompare` works because timestamps are ISO-8601; a non-ISO `createdAt` would sort incorrectly.

---

## Related files

| File | Role |
|---|---|
| `app/dashboard/alerts/page.tsx` | The page component (`AlertsPage`) — this doc's subject |
| `lib/constants.ts` | `ALERT_META` (`:93-106`), `SEVERITY_COLOR` (`:108-113`), `DASHBOARD_NAV`/`ADMIN_ONLY_PATHS`/`canAccessPath` (gating) |
| `lib/types.ts` | `Alert`, `AlertType`, `AlertSeverity`, `AlertStatus` (`:158-184`) |
| `lib/store/data.ts` | `acknowledgeAlert`/`resolveAlert` (`:433-436`) + all alert producers (`submitReading`, `submitEtpEntry`, `raiseEtpInletAlert`, `decideApproval`) |
| `lib/data/seed.ts` | `buildAlerts` (`:189-229`) — initial demo alerts, only source of `non-reporting` |
| `lib/data/firestore-storage.ts` | Per-tenant sharding of alerts on write / merge on read (`shardByIndustry` `:110-141`, `mergeSlices` `:144-155`) |
| `components/shared/store-hydrator.tsx` | Role-scoped load + live-sync that populates `alerts` (admin = all, operator = own) |
| `components/dashboard/dashboard-shell.tsx` | Auth + `canAccessPath` redirect gate for all dashboard routes |
| `app/dashboard/layout.tsx` | Wraps the page in `DashboardShell` under `theme-dash` |
| `components/dashboard/page-header.tsx` | `PageHeader` used for the title block |
| `components/shared/status-badge.tsx` | Severity + status pills (`MAP`/`TONE` tone mapping) |
| `components/shared/icon.tsx` | `Icon` registry resolving `ALERT_META[type].icon` names (fallback `Circle`) |
| `lib/utils.ts` | `timeAgo` (footer timestamps), `cn` (class merge) |
