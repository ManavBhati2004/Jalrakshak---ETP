# `/dashboard/compliance` — Compliance Scorecard

> Route: `/dashboard/compliance` · File: `app/dashboard/compliance/page.tsx` · Roles: **monitoring-admin only** · Rendered by: `CompliancePage` (default export, `"use client"` component)

---

## Purpose

A read-only **governance scorecard** for the RSPCB Monitoring Body. It grades every monitored unit on a single 0–100 **compliance score** and rolls those scores up into a cluster view:

- A **cluster average** headline number, color-graded green/amber/red.
- Three **summary counters** — how many units are Compliant, Warning, or Non-Compliant against fixed thresholds.
- A grid of **per-unit cards**, sorted by score (highest first), each showing the unit's score, submission rate, and open alert count.

The page is purely presentational over the store's `compliance` array — it reads, sorts, aggregates, and renders. It performs **no writes** and no recomputation of scores; the score is a stored value per unit (`industry.complianceScore`).

The eyebrow/title/description come from `PageHeader` (`app/dashboard/compliance/page.tsx:33-37`):

- eyebrow: `"Governance"`
- title: `"Compliance Scorecard"`
- description: *"Every unit scored on submission discipline, alerts and treatment performance — green, amber or red at a glance."*

---

## Access & gating

This is an **admin-only** route. Gating happens at two layers, both keyed off `canAccessPath`:

**1. Navigation visibility** — the sidebar entry is restricted to the admin role. In `lib/constants.ts:50`:

```ts
{ label: "Compliance", href: "/dashboard/compliance", icon: "ShieldCheck", group: "Governance", roles: ADMIN },
```

where `ADMIN: RoleId[] = ["monitoring-admin"]` (`lib/constants.ts:41`). An `etp` operator never sees the link.

**2. Route redirect guard** — `/dashboard/compliance` is listed in `ADMIN_ONLY_PATHS` (`lib/constants.ts:54-61`). The gate function (`lib/constants.ts:65-72`):

```ts
export function canAccessPath(role: RoleId, pathname: string): boolean {
  // segment-aware match: "/dashboard/etp" must NOT swallow "/dashboard/etp-entry"
  const matches = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const inAdmin = ADMIN_ONLY_PATHS.some(matches);
  const inEtp = ETP_ONLY_PATHS.some(matches);
  if (role === "monitoring-admin") return !inEtp;
  return !inAdmin; // etp
}
```

For `/dashboard/compliance`: `inAdmin` is `true` (it's in `ADMIN_ONLY_PATHS`) and `inEtp` is `false`. So `monitoring-admin` returns `!inEtp` ⇒ **`true`** (allowed); `etp` returns `!inAdmin` ⇒ **`false`** (blocked).

Enforcement lives in `DashboardShell` (`components/dashboard/dashboard-shell.tsx:21-31`):

```ts
useEffect(() => {
  if (!authReady) return;
  if (!role) { router.replace("/login"); return; }
  if (!canAccessPath(role, pathname)) { router.replace("/dashboard"); }
}, [authReady, role, router, pathname]);
```

So an ETP operator who navigates directly to `/dashboard/compliance` is bounced to `/dashboard`; an unauthenticated visitor is bounced to `/login`. Until `authReady` is true, the shell shows a loading splash instead of the page (`dashboard-shell.tsx:33-43`).

> Note: the page component itself contains **no role check** — it trusts the shell guard. It would render for any role if reached, but the shell prevents that.

---

## Data — store reads & writes

**Reads** (Zustand `useDataStore`, `app/dashboard/compliance/page.tsx:16`):

```ts
const compliance = useDataStore((s) => s.compliance);
```

`compliance` is a `ComplianceRecord[]`. The record shape (`lib/types.ts:194-203`):

| Field | Type | Used on this page? | Meaning |
|---|---|---|---|
| `industryId` | `string` | yes — React `key` | Unit id (`IND-###`) |
| `industryName` | `string` | yes — card title | Display name |
| `cetpId` | `CetpId \| null` | yes — card subtitle | `"balotra" \| "jasol" \| "bithuja"`, or `null` ⇒ Individual ETP |
| `score` | `number` | yes — score % + sort + avg + status | Stored 0–100 compliance score |
| `status` | `ComplianceStatus` | yes — badge, color, summary counts | `"compliant" \| "warning" \| "non-compliant"` |
| `submissionRate` | `number` | yes — "Submission" row | Percent of expected submissions filed |
| `alertCount` | `number` | yes — "Alerts" row | Open alerts on the unit |
| `trend` | `TrendPoint[]` | **no** | 6-month score history — present on the record but **not rendered** on this page |

**Writes:** none. This page calls no store actions and no `useAuthStore` selectors. The only local mutation is React `useState` for the filter pill (see below).

**Where the data comes from (context, not this file):**

- **Admin bootstrap / seed** — `buildCompliance()` (`lib/data/seed.ts:240-260`) maps each seed industry to a record, deriving `status` via `complianceStatus(ind.complianceScore)`, `submissionRate` from a seeded jitter around the score, and `alertCount` from `ind.alertsCount`. It also fills a synthetic 6-month `trend` (unused here).
- **Live per-tenant hydration** — `StoreHydrator` loads the admin's authorized slice. For `monitoring-admin` it calls `loadAllIndustries()` and live-subscribes with `subscribeAll(...)` (`components/shared/store-hydrator.tsx:97-110`), merging every industry shard's compliance slice into the flat `compliance` array. (An `etp` operator only loads its own shard — but never reaches this page.)
- **New-unit append** — `addIndustry` (`lib/store/data.ts:414-428`) prepends a fresh record with `score: 75` (⇒ `"warning"`), `submissionRate: 0`, `alertCount: 0`.

---

## Layout & sections

The page is a vertical stack (`space-y-6`) with four blocks, in order (`app/dashboard/compliance/page.tsx:31-101`):

### 1. Page header (`:33-37`)
`PageHeader` with the Governance eyebrow, "Compliance Scorecard" title, and the descriptive subtitle.

### 2. Cluster summary row (`:39-57`)
A two-column responsive grid `grid gap-4 lg:grid-cols-[1fr_2fr]` (stacks on small screens):

**(a) Cluster Compliance card** (`:40-51`)
- Big 5xl number `{summary.avg}%`, colored inline by threshold (`:42`):
  ```ts
  color: STATUS_COLOR[summary.avg >= 85 ? "compliant" : summary.avg >= 70 ? "warning" : "non-compliant"]
  ```
- Caption `"cluster avg"`, heading `"Cluster Compliance"`, subtext `"Average across all monitored units"`.

**(b) Three summary counters** (`:52-56`) — a `grid-cols-3` of `SummaryCard`s (helper at `:104-115`):

| Card | Icon | Value | Color | Hint |
|---|---|---|---|---|
| Compliant | `ShieldCheck` | `summary.compliant` | `#10b981` (emerald) | `≥ 85%` |
| Warning | `TriangleAlert` | `summary.warning` | `#f59e0b` (amber) | `70–84%` |
| Non-Compliant | `OctagonX` | `summary.nonCompliant` | `#ef4444` (red) | `< 70%` |

Each `SummaryCard` renders a tinted icon chip (`background: ${color}1f` = ~12% alpha), the big count, the label, and the muted threshold hint.

### 3. Filter pill row (`:59-72`)
A `flex-wrap` row of pills built from `FILTERS`. `FILTERS` currently has **exactly one** entry (`:11-13`):

```ts
const FILTERS = [{ key: "all", label: "All" }] as const;
```

The active pill (`filter === f.key`) gets `bg-primary/15 text-primary ring-...` styling; others are muted. Clicking sets `filter`. Because there is only one option and the list is never filtered by it (see gotchas), this row is effectively a static "All" chip today.

### 4. Per-unit scorecard grid (`:74-99`)
Responsive card grid `grid gap-4 sm:grid-cols-2 xl:grid-cols-3`, iterating over `filtered` (the score-sorted copy). Each card (`:78-96`), keyed by `c.industryId`:

- **Header row** (`:79-85`):
  - `c.industryName` — truncated bold title.
  - `c.cetpId ?? "Individual ETP"` — muted, `capitalize` (so `"balotra"` → "Balotra"); `null` shows "Individual ETP".
  - `StatusBadge` with `status={c.status}` and `dot={false}` (pill with no leading dot).
- **Body row** (`:86-95`):
  - Big 3xl `{c.score}%`, colored `style={{ color: STATUS_COLOR[c.status] }}` (`:76`, `:88`), with caption `"score"`.
  - Two `Row`s (helper `:117-123`): `Submission → {c.submissionRate}%` and `Alerts → {c.alertCount}` (values in mono font).

---

## Forms & validation

**None.** This page has no form, no inputs, and no Zod schema. The only interactive element is the filter pill button (`:61-71`), which sets a local `useState` string. There is nothing to validate.

---

## Key flows & logic

Two derived values drive everything, both memoized:

**1. Sorted list (`:19-21`):**
```ts
const filtered = useMemo(() => {
  return [...compliance].sort((a, b) => b.score - a.score);
}, [compliance]);
```
- Spreads into a **new array** so the store's `compliance` is never mutated in place.
- Sorts **descending by `score`** — best-performing units first.
- Note: `filtered` does **not** actually consult the `filter` state — it always returns the full sorted set (the name is aspirational).

**2. Summary aggregate (`:23-29`):**
```ts
const summary = useMemo(() => {
  const compliant   = compliance.filter((c) => c.status === "compliant").length;
  const warning     = compliance.filter((c) => c.status === "warning").length;
  const nonCompliant= compliance.filter((c) => c.status === "non-compliant").length;
  const avg = Math.round(
    compliance.reduce((s, c) => s + c.score, 0) / Math.max(1, compliance.length)
  );
  return { compliant, warning, nonCompliant, avg };
}, [compliance]);
```
- Counts are keyed off the record's **stored `status`**, not recomputed from `score`.
- `avg` is the mean of all `score`s, `Math.round`ed. `Math.max(1, length)` guards against divide-by-zero on an empty list (yields `0`).

**Threshold model** (`lib/constants.ts:115-131`) — the single source of truth for banding:

```ts
export const COMPLIANCE = { compliant: 85, warning: 70 };

export function complianceStatus(score: number) {
  if (score >= COMPLIANCE.compliant) return "compliant" as const;   // >= 85
  if (score >= COMPLIANCE.warning)   return "warning" as const;     // 70–84
  return "non-compliant" as const;                                  // < 70
}

export const STATUS_COLOR = {
  compliant:      "#10b981",  // emerald
  warning:        "#f59e0b",  // amber
  "non-compliant":"#ef4444",  // red
} as const;
```

| Band | Score range | `status` | `STATUS_COLOR` |
|---|---|---|---|
| Compliant | **≥ 85** | `compliant` | `#10b981` green |
| Warning | **70–84** | `warning` | `#f59e0b` amber |
| Non-Compliant | **< 70** | `non-compliant` | `#ef4444` red |

`complianceStatus` is what the **seed** and the **`addIndustry`** action use to stamp each record's `status`. The page then trusts that stored `status` for badges, per-card color, and summary counts. The **cluster avg** card is the one place the page re-derives a band inline from the raw average (`:42`) using the same `85 / 70` cutoffs — it does not call `complianceStatus`, but the numbers match.

**Rendering pipeline per turn:**
1. Read `compliance` from the store (live-synced for admin via `subscribeAll`).
2. Recompute `filtered` (sorted) and `summary` (counts + avg) when `compliance` changes.
3. Render the cluster card (avg + inline color), the three counters, the (single) filter pill, then map `filtered` → per-unit cards.

---

## Units & formatting

This page deals only in **percentages and counts** — there are **no water volumes**, so the KLD-vs-m³ display convention (`displayUnit()`) does **not** apply here.

- `score` → rendered as `{n}%` (5xl for cluster avg, 3xl per card).
- `submissionRate` → rendered as `{n}%`.
- `alertCount` → rendered as a bare integer (`String(c.alertCount)`), mono font.
- Threshold hints on the summary cards use an en-dash range: `≥ 85%`, `70–84%`, `< 70%`.
- `cetpId` is title-cased purely via the `capitalize` CSS class (`:82`), not string transformation.

---

## Edge cases & gotchas

- **The filter row is inert.** `filter`/`setFilter` exist and toggle pill styling, but `filtered` never reads `filter`, and `FILTERS` has only one entry (`"all"`). No actual filtering occurs. This is scaffolding for future filters (e.g. by CETP or band).
- **Empty dataset ⇒ `0%`, not `NaN`.** `Math.max(1, compliance.length)` (`:27`) protects the average. The counters show `0`, and the per-unit grid renders empty — there is **no dedicated empty-state placeholder**. In practice the admin always has at least the seed set once `loadAllIndustries()` resolves (bootstrapping via `seedIndustries` on a fresh project — `store-hydrator.tsx:99-105`).
- **Score is stored, not live-computed.** The card does not recalculate compliance from readings/alerts; it displays `record.score` (originating from `industry.complianceScore`). A stale `complianceScore` shows a stale card.
- **`status` and `score` can theoretically disagree.** Summary counts use the stored `status`; the cluster avg uses raw `score`. They only stay consistent because `status` is always stamped via `complianceStatus(score)` at write time. Any record written with a mismatched `status` would miscount.
- **`trend` is carried but unused.** The 6-month `trend` array is loaded and lives on every record, yet this page renders no sparkline/chart from it. (It exists for other views.)
- **StatusBadge palette differs from `STATUS_COLOR`.** The badge maps `compliant→success/emerald`, `warning→warning/amber`, `non-compliant→danger/red` via Tailwind tone classes (`components/shared/status-badge.tsx:14-37`), while the big score number uses the raw hex from `STATUS_COLOR`. They are semantically aligned but are two independent color sources.
- **New units seed at 75% ⇒ Warning.** A self-registered/added industry lands in the Warning band with `submissionRate: 0` and `alertCount: 0` until real data accrues (`lib/store/data.ts:421-424`).
- **Admin-scoped by construction.** Because the redirect guard blocks `etp` operators, the "cluster" here is genuinely the full monitored set (admin loads all shards). An operator's single-shard load would only ever hold its own compliance slice — but it can never reach this route to render it.

---

## Related files

| File | Role |
|---|---|
| `app/dashboard/compliance/page.tsx` | The page itself — `CompliancePage`, `SummaryCard`, `Row`. |
| `lib/constants.ts` | `COMPLIANCE` thresholds (`:116-119`), `complianceStatus()` (`:121-125`), `STATUS_COLOR` (`:127-131`), `DASHBOARD_NAV` entry (`:50`), `ADMIN_ONLY_PATHS` + `canAccessPath` (`:54-72`). |
| `lib/types.ts` | `ComplianceRecord` (`:194-203`), `ComplianceStatus` (`:186`), `CetpId` (`:17`). |
| `lib/store/data.ts` | Store `compliance` slice (`:80`, `:100`); `addIndustry` appends a record (`:414-428`). |
| `lib/data/seed.ts` | `buildCompliance()` derives seed records (`:240-260`). |
| `components/shared/store-hydrator.tsx` | Per-tenant hydration; admin `loadAllIndustries` + `subscribeAll` populate `compliance` (`:97-110`). |
| `components/dashboard/dashboard-shell.tsx` | Redirect guard using `canAccessPath` (`:21-31`). |
| `components/dashboard/page-header.tsx` | Renders the eyebrow/title/description header. |
| `components/shared/status-badge.tsx` | The status pill; tone map at `:14-37`. |
| `lib/store/auth.ts` | Auth store providing `role`/`authReady` the shell guard reads. |
