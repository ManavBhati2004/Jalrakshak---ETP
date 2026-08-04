# `/dashboard/etp` — ETP Units (admin master / detail)

> Route: `/dashboard/etp` · File: `app/dashboard/etp/page.tsx` · Roles: `monitoring-admin` (RSPCB Monitoring Body) only · Rendered by: `IndividualEtpPage` (default export)

---

## Purpose

The **ETP Units** page is the Monitoring Body's read-only console for every **individual-ETP** industry — i.e. industries that run their *own* on-site Effluent Treatment Plant rather than discharging to a shared CETP (`cetpId === null`, `isIndividualETP === true`).

It is a **single-component master → detail view**:

- **Master list** — one selectable card per individual-ETP unit, with compliance %, status, reading count and last-reading date.
- **Detail (`EtpDetail`)** — for the selected unit: a header card, a **capacities grid (KLD)**, the **latest water-balance snapshot (m³)**, the **KLD treatment pipeline** (`buildEtpStageFlow`), and a **reading-history TanStack table** with a **summary-stat row** and **Download CSV** export.

Navigation between master and detail is pure **local React state** (`selectedId`) — there is **no sub-route**; the URL stays `/dashboard/etp` the whole time (`app/dashboard/etp/page.tsx:22`, `:35`).

It is a monitoring/reporting surface only — this page has **no forms and performs no writes**. Operators file the underlying data on `/dashboard/etp-entry`; this page just reads it back.

---

## Access & gating

The page is **admin-only** and is gated at **two** layers; the page component itself contains **no auth code**.

1. **Navigation visibility** — the sidebar item is declared `roles: ADMIN` in `DASHBOARD_NAV` (`lib/constants.ts:48`):
   ```ts
   { label: "ETP Units", href: "/dashboard/etp", icon: "Droplets", group: "Monitoring", roles: ADMIN }
   ```
   So an `etp` operator never sees the link.

2. **Route redirect gate** — `/dashboard/etp` is listed in `ADMIN_ONLY_PATHS` (`lib/constants.ts:54-61`). `DashboardShell` (which wraps every `/dashboard/*` page via `app/dashboard/layout.tsx`) runs `canAccessPath(role, pathname)` in an effect and `router.replace("/dashboard")` on failure (`components/dashboard/dashboard-shell.tsx:21-31`).

   `canAccessPath` (`lib/constants.ts:65-72`) uses a **segment-aware** match so `/dashboard/etp` does **not** swallow `/dashboard/etp-entry`:
   ```ts
   const matches = (p) => pathname === p || pathname.startsWith(p + "/");
   const inAdmin = ADMIN_ONLY_PATHS.some(matches);
   const inEtp   = ETP_ONLY_PATHS.some(matches);
   if (role === "monitoring-admin") return !inEtp; // admin blocked only from ETP-only paths
   return !inAdmin;                                 // etp operator blocked from all admin paths
   ```
   Net effect: `monitoring-admin` → allowed; `etp` → redirected to `/dashboard`.

3. **Unauthenticated / not-ready** — `DashboardShell` redirects to `/login` when `authReady && !role`, and renders a "Loading command center…" splash while `!authReady` (`dashboard-shell.tsx:21-43`).

> Note: the gate is a client-side redirect, not a server guard. The real data-security boundary is `firestore.rules` (per-tenant isolation) — an operator that somehow reached this route would still only have loaded its own unit into the store, so it is not a data-leak vector, just a UX gate.

---

## Data — store reads & writes

All data comes from the Zustand data store `useDataStore` (`lib/store/data.ts`). The page uses **two selectors** and performs **zero store writes/actions**:

| # | Selector | Source | Used for |
|---|----------|--------|----------|
| 1 | `useDataStore((s) => s.industries)` | `page.tsx:19` | Filtered to individual-ETP units |
| 2 | `useDataStore((s) => s.etpEntries)` | `page.tsx:20` | Water-balance history / latest / counts |

Derived in-component (no external selectors):

- **`etps`** — `industries.filter((i) => i.isIndividualETP)` (`page.tsx:21`). The master list and the selected unit both come from this filtered array.
- **`latestByIndustry`** — `useMemo` over `etpEntries` (`page.tsx:24-30`): sorts a **copy** ascending by `submittedAt` (`localeCompare`) and writes each entry into a `Record<industryId, EtpEntry>`, so **last write wins → latest per unit**.
- **`selected`** — `selectedId ? etps.find((i) => i.id === selectedId) ?? null : null` (`page.tsx:32`).

Inside `EtpDetail` (`page.tsx:97-260`) the passed-in `entries` prop (= `etpEntries`) is re-derived:

- **`mine`** — `entries.filter((e) => e.industryId === ind.id).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))` → this unit's entries, **newest first** (`page.tsx:100-103`).
- **`latest`** — `mine[0]` (`page.tsx:104`).
- **`approved` / `pending` / `rejected`** — counts of `mine` by `e.status` (`page.tsx:105-107`).

### Where the store data itself comes from (per-tenant era)

`useDataStore` is persisted through `firestoreStorage` and hydrated by `StoreHydrator` (`components/shared/store-hydrator.tsx`). For a `monitoring-admin`, `loadAllIndustries()` + `subscribeAll(...)` merge **every** `industries/{id}` shard into the six flat store arrays, so `industries` and `etpEntries` here already contain all tenants' individual-ETP units and their filed water-balances (`store-hydrator.tsx:97-110`). No fetching happens in this page — it reads whatever the hydrator loaded.

### `EtpEntry` shape (the row model)

Defined in `lib/types.ts:82-99`. Values are **stored in `KL`** (`unit: "KL"`) and **displayed as `m³`**:

```ts
interface EtpEntry {
  id, industryId, industryName, date,
  freshWaterConsumption, etpInlet, etpOutlet, etpReuse,
  roInlet, roReject, roPermeate, sludgeToTSDF,
  totalWaterIntake,     // = freshWaterConsumption + etpReuse + roPermeate
  unit: "KL",
  status: "pending" | "approved" | "rejected",
  submittedAt,
}
```

---

## Layout & sections

### A. Master list (`selected == null`) — `page.tsx:38-94`

1. **`PageHeader`** (`page.tsx:40-44`) — `components/dashboard/page-header.tsx`:
   - eyebrow `"Monitoring"`, title **"Individual ETP Units"**, description "Industries operating their own Effluent Treatment Plants. Select a unit to view its capacities, treatment pipeline, reading history and report."

2. **Empty state** (`page.tsx:46-49`) — when `etps.length === 0`, a dashed-border panel: *"No individual ETP units registered."*

3. **Unit cards** (`page.tsx:51-91`) — one `<button>` per unit (`etps.map`), each `onClick={() => setSelectedId(ind.id)}`. Card contents:
   - Teal droplet icon tile (`Droplets`).
   - `ind.name` (bold, truncated) + a `sm`-only "Individual ETP" pill.
   - `ind.area` (muted).
   - A meta row: `<StatusBadge status={ind.status} />` + `"{count} reading(s)"` (count = `etpEntries.filter(e => e.industryId === ind.id).length`, `page.tsx:54`) + `"Last: {latest ? formatDate(latest.date) : "—"}"`.
   - Right side (`sm`+): `ind.complianceScore%` in a color from `STATUS_COLOR[complianceStatus(...)]` (`page.tsx:55`, `82-84`) over the caption "compliance".
   - A `ChevronRight` affordance.

   Seeded individual-ETP units (from `data/industries.json`): **IND-019 "Pali Road Processors"** and **IND-020 "Jodhpur Textile Park Unit-12"** (both `isIndividualETP: true`, `cetpId: null`).

### B. Detail view (`selected != null`) — `EtpDetail`, `page.tsx:164-259`

Rendered by early return `if (selected) return <EtpDetail ... />` (`page.tsx:34-36`).

1. **Back link** (`page.tsx:166-168`) — `ArrowLeft` + "All ETP Units", `onClick={onBack}` → parent `setSelectedId(null)`.

2. **Detail header card** (`page.tsx:171-223`):
   - Droplet tile, `ind.name`, `ind.area`, `StatusBadge` + "Individual ETP" pill.
   - Large `ind.complianceScore%` (4xl) tinted by `color` (`page.tsx:184-187`).

   - **Capacities (KLD) grid** (`page.tsx:190-199`) — `grid-cols-4`, 8 tiles from the `caps` array (`page.tsx:109-118`), each showing `formatNumber(v)` + label:

     | Tile label | Value source (`page.tsx`) |
     |------------|----------------------------|
     | Permitted | `ind.permittedKLD` |
     | ETP | `ind.etpCapacity` |
     | Max Effluent | `ind.maxEffluentGeneration ?? ind.permittedKLD` |
     | MEE | `ind.meeCapacity` |
     | RO I | `ind.roStage1 ?? ind.roCapacity` |
     | RO II | `ind.roStage2 ?? 0` |
     | RO III | `ind.roStage3 ?? 0` |
     | RO IV | `ind.roStage4 ?? 0` |

   - **Latest Water Balance (m³)** panel (`page.tsx:201-215`) — header `Waves` icon + `"Latest Water Balance"` and a date chip (`latest ? formatDate(latest.date) : "No entry"`). Four `<Mini>` tiles (`page.tsx:270-279`) reading `latest?.*`, each rendering `formatNumber(value)` or `"—"` when undefined, with a `(m³)` suffix baked into the caption:

     | Mini tile | Field | Accent |
     |-----------|-------|--------|
     | Total Intake | `latest?.totalWaterIntake` | `#0d9488` |
     | ETP Reuse | `latest?.etpReuse` | `#10b981` |
     | RO Permeate | `latest?.roPermeate` | `#6366f1` |
     | Sludge→TSDF | `latest?.sludgeToTSDF` | `#a78bfa` |

   - **Treatment Pipeline** (`page.tsx:217-222`) — `Recycle` heading + `<PipelineFlow flow={buildEtpStageFlow(ind)} />`. See *Key flows & logic*.

3. **Reading History & Report card** (`page.tsx:226-257`):
   - Header `ClipboardList` "Reading History & Report" + sub-copy "Every water-balance reading filed earlier by this unit."
   - **Download CSV** `Button` (`variant="outline"`), `disabled={mine.length === 0}`, `onClick={handleDownload}` (`page.tsx:234-236`).
   - **Summary-stat row** (`page.tsx:240-245`) — four `<SummaryStat>` tiles (`page.tsx:281-290`) rendering big numbers:

     | Stat | Value | Accent |
     |------|-------|--------|
     | Total Readings | `mine.length` | `#0d9488` |
     | Approved | `approved` | `#10b981` |
     | Pending | `pending` | `#f59e0b` |
     | Rejected | `rejected` | `#ef4444` |

   - **History table** (`page.tsx:248-256`) — `<DataTable columns={columns} data={mine} searchPlaceholder="Search readings…" pageSize={8} emptyMessage="No readings filed yet." />`.

---

## Forms & validation

**None.** This page renders no `<form>`, no RHF/Zod schema, and calls no store mutations. The only interactive controls are:

- The master-list unit `<button>`s → `setSelectedId(id)`.
- The detail **back** button → `onBack()` (`setSelectedId(null)`).
- **Download CSV** button → `handleDownload` (export, not a mutation).
- The `DataTable`'s built-in **global search input** and **prev/next pagination** (local table state only — `components/dashboard/data-table.tsx:43-57`, `124-139`).

Data entry / validation lives on the operator route `/dashboard/etp-entry`, backed by `submitEtpEntry` in the store (`lib/store/data.ts:214-291`).

---

## Key flows & logic

### 1. Master → detail selection

- Click a unit card → `setSelectedId(ind.id)` (`page.tsx:59`).
- On next render, `selected` resolves via `etps.find(...)` (`page.tsx:32`); the guard `if (selected) return <EtpDetail .../>` swaps the whole view (`page.tsx:34-36`).
- Back link → `onBack()` → `setSelectedId(null)` → master list returns.
- State is component-local; a page refresh loses the selection and returns to the master list.

### 2. "Latest" resolution (two independent computations)

- **Master card `Last:` date** uses `latestByIndustry[ind.id]`, built by ascending-sort + last-write-wins (`page.tsx:24-30`).
- **Detail `latest`** uses `mine[0]` after a **descending** sort by `submittedAt` (`page.tsx:100-104`).

Both key off `submittedAt` (the ISO submission timestamp), **not** the reading `date`, so "latest" = most-recently-*filed* entry.

### 3. Treatment pipeline — `buildEtpStageFlow(ind)` (`lib/data/etp-flow.ts:4-21`)

Builds a **7-node** `FlowNode[]` in **KLD**, derived from the unit's stored capacities with **fallbacks** when the optional RO-stage / max-effluent fields are absent:

```ts
const raw = ind.maxEffluentGeneration ?? Math.round(ind.permittedKLD * 0.96);
const etp = ind.etpCapacity;
const r1  = ind.roStage1 ?? ind.roCapacity;
const r2  = ind.roStage2 ?? Math.round(ind.roCapacity * 0.68);
const r3  = ind.roStage3 ?? Math.round(ind.roCapacity * 0.42);
const r4  = ind.roStage4 ?? Math.round(ind.roCapacity * 0.24);
const mee = ind.meeCapacity;
```

Node order (all `unit: "KLD"`, `status: "normal"`): **Max. Effluent Generation (Raw) → ETP Capacity → RO Stage I → RO Stage II → RO Stage III → RO Stage IV → MEE Capacity**.

> The nearby `buildEtpFlow` in the same file (`etp-flow.ts:24-38`) is a **different, 5-stage** pipeline (Raw → ETP → RO → MEE → Recovery) with a `< permittedKLD*0.2` warning heuristic. **This page uses `buildEtpStageFlow`, not `buildEtpFlow`.**

`PipelineFlow` (`components/dashboard/pipeline-flow.tsx`) renders each node as an animated Framer-Motion card: a colored rail with flowing-droplet animation, `Stage {i+1}` label, `formatNumber(value) {unit}`, a `{pct}% of inlet` figure and a progress bar where `pct = round(value / max(values) * 100)` (`pipeline-flow.tsx:18`, `24`). Because every node is `status: "normal"`, all rails render indigo `#6366f1` (the `STATUS.normal` color, `pipeline-flow.tsx:10`).

### 4. Reading-history table — column model (`page.tsx:120-140`)

`columns: ColumnDef<EtpEntry>[]` — 12 columns:

| Header | `accessorKey` | Cell render |
|--------|---------------|-------------|
| Date | `date` | `formatDate(row.original.date)` |
| Fresh Water | `freshWaterConsumption` | `<NumCell>` → `formatNumber(v) m³` |
| ETP Inlet | `etpInlet` | `<NumCell>` |
| ETP Outlet | `etpOutlet` | `<NumCell>` |
| ETP Reuse | `etpReuse` | `<NumCell>` |
| RO Inlet | `roInlet` | `<NumCell>` |
| RO Reject | `roReject` | `<NumCell>` |
| RO Permeate | `roPermeate` | `<NumCell>` |
| Sludge→TSDF | `sludgeToTSDF` | `<NumCell>` |
| Total Intake | `totalWaterIntake` | bold `formatNumber(v) m³` (`page.tsx:130-138`) |
| Status | `status` | `<StatusBadge status={...} />` |

`<NumCell>` (`page.tsx:262-268`) = monospace `formatNumber(v)` + a muted `m³` suffix. The `DataTable` wrapper adds global fuzzy search, sortable headers, and pagination at `pageSize={8}` (`data-table.tsx`).

### 5. CSV export — `handleDownload` (`page.tsx:142-162`)

Pipeline:

1. **Guard** — `if (!mine.length) return;` (button is also `disabled` when empty, `page.tsx:234`).
2. **Map rows** — each entry → an object with human, unit-suffixed headers, e.g. `"Fresh Water (m³)"`, `"Total Water Intake (m³)"`, plus `Date`, `Status`, `Submitted At` (`page.tsx:144-157`). Numeric values are exported **as-stored** (the `(m³)` is only in the header label — no KL→m³ math, the values are numerically identical).
3. **Filename** — builds a local `today` string `YYYY-MM-DD` from `new Date()` and names the file `jalrakshak-etp-${ind.id}-${today}.csv` (`page.tsx:158-160`).
4. **Serialize** — `toCSV(rows)` (`lib/utils.ts:63-72`) joins headers + rows, wraps every cell in double-quotes (doubling embedded quotes), and **hardens against CSV/formula injection**: any cell whose text starts with `= + - @ \t \r` is prefixed with a `'`.
5. **Download** — the local `download(filename, content)` helper (`page.tsx:293-301`) creates a `text/csv` `Blob`, an object URL, a synthetic `<a download>` click, then `URL.revokeObjectURL`.
6. **Toast** — `toast.success("ETP report exported", { description: "{n} reading(s) · {ind.name}" })` (Sonner, `page.tsx:161`).

---

## Units & formatting (KLD vs m³)

This page deliberately mixes two unit systems — matching the domain model:

- **Capacities → KLD** (kilolitres/day, a *plant rating*). The capacities grid tiles and every pipeline node are labelled **KLD** (`page.tsx:191`; `etp-flow.ts` nodes all set `unit: "KLD"`). These are hard-coded/static labels, **not** run through `displayUnit()`.
- **Water-balance volumes → m³.** `EtpEntry` values are **stored as `KL`** (`unit: "KL"`, `lib/types.ts:96`) but **displayed as `m³`**. Here the `m³` suffix is written **literally** in the JSX (`NumCell`, the Total-Intake cell, the `Mini` captions, the CSV headers — `page.tsx:135`, `265`, `276`, `148-154`) rather than via the shared `displayUnit()` helper (`lib/utils.ts:17`, which maps `"KL" → "m³"`). The net displayed unit is the same; only the mechanism differs.
- **Numbers** are formatted with `formatNumber` = `Intl.NumberFormat("en-IN", ...)` (`lib/utils.ts:8-10`) → Indian-grouping (e.g. `1,00,000`).
- **Dates** via `formatDate` = `toLocaleString("en-IN", { day:"2-digit", month:"short", year:"numeric" })` (`lib/utils.ts:23-33`), e.g. `20 Jun 2026`; `null` → `"—"`.

> Because `totalWaterIntake` is stored as KL and 1 KL = 1 m³ numerically, the m³ presentation involves **no conversion** — it is purely a label change.

---

## Edge cases & gotchas

- **No units at all** → dashed empty panel "No individual ETP units registered." (`page.tsx:46-49`). This only appears when *no* industry has `isIndividualETP === true`.
- **Unit with zero readings** → detail still renders; capacities/pipeline come from the `Industry` record. The Latest Water Balance shows the date chip **"No entry"** and every `Mini` tile shows **"—"** (`value != null` guard, `page.tsx:274`). Summary stats read `0/0/0/0`. Table shows **"No readings filed yet."** Download CSV is **disabled** (`mine.length === 0`).
- **`selectedId` points at a since-removed unit** → `etps.find(...) ?? null` returns `null` (`page.tsx:32`), so the view falls back to the master list rather than crashing.
- **Optional capacity fields absent** → the grid and `buildEtpStageFlow` both apply `??` fallbacks (RO II/III/IV grid tiles fall back to `0`; the pipeline derives them from ratios of `roCapacity`). A unit with only legacy `roCapacity` still renders a full 7-stage pipeline.
- **All-zero pipeline** → `PipelineFlow` guards division with `Math.max(...values) || 1` so percentages never become `NaN` (`pipeline-flow.tsx:18`).
- **Two different "latest" computations** (ascending last-write-wins on the master card vs `mine[0]` descending in detail) can theoretically disagree only if two entries share an identical `submittedAt` string; both order by `submittedAt`, so in practice they match.
- **`latestByIndustry` sorts a copy** (`[...etpEntries]`, `page.tsx:26`) — it does **not** mutate the store array. Good, since the array is the live Zustand state.
- **Table search is client-side over `mine` only** — searching filters just this unit's rows; there is no cross-unit search on this page.
- **CSV export is client-only** — a `Blob` download in the browser; nothing is written to Firestore. Values are raw numbers (no thousands separators), so the CSV is spreadsheet-friendly.
- **Compliance color band** — `complianceStatus` thresholds are `>= 85` compliant (green `#10b981`), `>= 70` warning (amber `#f59e0b`), else non-compliant (red `#ef4444`) (`lib/constants.ts:116-131`). Both seeded units (80, 84) fall in the **amber** band.
- **No CETP units here** — the filter is strictly `isIndividualETP`; CETP-member industries never appear on this page (they surface under `/dashboard/industries`).

---

## Related files

| File | Role |
|------|------|
| `app/dashboard/etp/page.tsx` | This page — `IndividualEtpPage` + `EtpDetail` + local `NumCell`/`Mini`/`SummaryStat`/`download` helpers |
| `lib/data/etp-flow.ts` | `buildEtpStageFlow` (7-node KLD pipeline used here) and `buildEtpFlow` (unused 5-stage variant) |
| `lib/store/data.ts` | `useDataStore` — `industries` + `etpEntries` selectors; `submitEtpEntry` is what fills `etpEntries` (from the operator route) |
| `lib/types.ts` | `Industry` (`:38-65`), `EtpEntry` (`:82-99`), `FlowNode`, `ReadingStatus` |
| `lib/constants.ts` | `DASHBOARD_NAV`, `ADMIN_ONLY_PATHS`, `canAccessPath`, `STATUS_COLOR`, `complianceStatus` |
| `lib/utils.ts` | `formatNumber`, `formatDate`, `toCSV` (injection-hardened), `displayUnit` |
| `components/dashboard/page-header.tsx` | `PageHeader` (title block) |
| `components/dashboard/pipeline-flow.tsx` | `PipelineFlow` (animated KLD treatment rail) |
| `components/dashboard/data-table.tsx` | `DataTable` (TanStack table: search + sort + pagination) |
| `components/shared/status-badge.tsx` | `StatusBadge` (status/compliance pill) |
| `components/dashboard/dashboard-shell.tsx` | Route gate (`canAccessPath` redirect) + shell chrome |
| `app/dashboard/layout.tsx` | Wraps the route in `DashboardShell` |
| `components/shared/store-hydrator.tsx` | Loads/live-syncs per-tenant `industries/{id}` shards into the store (admin = all units) |
| `data/industries.json` | Seed source; individual-ETP units **IND-019** and **IND-020** |
| `app/dashboard/etp-entry/page.tsx` | Operator counterpart that *creates* the `EtpEntry` rows shown here |
