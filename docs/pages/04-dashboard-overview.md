# `/dashboard` — Dashboard Overview (role split)

> Route: `/dashboard` · File: `app/dashboard/page.tsx` · Roles: `monitoring-admin` **and** `etp` (both allowed; content differs by role) · Rendered by: `DashboardOverview` → `AdminOverview` **or** `EtpOverview`

---

## Purpose

`/dashboard` is the landing screen every authenticated user hits after login. It is a **single route that renders two completely different pages** depending on the signed-in role:

- **`monitoring-admin`** (RSPCB "Monitoring Body", super-admin) sees the **Command Center Overview** — a cluster-wide aggregate: metric grid, combined ETP treatment pipeline, the list of individual ETP units, a live Reports/Exports panel, and rolling feeds of recent submissions, alerts and pending approvals across **all** tenants.
- **`etp`** (a single industry operator) sees **their own unit only** — compliance headline, quick stats, the date-keyed today-vs-yesterday Total Water Intake card, water-balance tiles, their own treatment pipeline, their own alerts, and a full reading-history table with a CSV export.

The route file itself is a 11-line switch; all real content lives in the two child components.

```tsx
// app/dashboard/page.tsx
export default function DashboardOverview() {
  const role = useAuthStore((s) => s.role);
  if (isAdmin(role)) return <AdminOverview />;   // line 9
  return <EtpOverview />;                          // line 10
}
```

`isAdmin` is defined in `lib/store/auth.ts:52` as `role === "monitoring-admin"`. Any non-admin role (in practice `etp`) falls through to `EtpOverview`.

---

## Access & gating (auth / redirects / role gate)

The page component does **no** gating of its own — gating is enforced one level up by the dashboard layout shell.

**Layout wrapper** — `app/dashboard/layout.tsx` wraps every `/dashboard/*` route:

```tsx
<div className="theme-dash">
  <DashboardShell>{children}</DashboardShell>
</div>
```

**`DashboardShell`** (`components/dashboard/dashboard-shell.tsx:21-31`) runs the redirect effect:

```tsx
useEffect(() => {
  if (!authReady) return;                          // wait for Firebase's first auth callback
  if (!role) { router.replace("/login"); return; } // unauthenticated → login
  if (!canAccessPath(role, pathname)) {            // wrong-role route → bounce to /dashboard
    router.replace("/dashboard");
  }
}, [authReady, role, router, pathname]);
```

While `!authReady || !role` the shell renders a "Loading command center…" splash (lines 33-43) instead of the page, so `DashboardOverview` never mounts before the role is known — the `page.tsx` role branch is always evaluated with a real role.

**`canAccessPath(role, pathname)`** (`lib/constants.ts:65-72`) decides route ownership:

```tsx
const inAdmin = ADMIN_ONLY_PATHS.some(matches);  // industries, etp, approvals, compliance, alerts, reports
const inEtp   = ETP_ONLY_PATHS.some(matches);    // etp-entry
if (role === "monitoring-admin") return !inEtp;
return !inAdmin;                                  // etp
```

`/dashboard` (the exact path) is in **neither** `ADMIN_ONLY_PATHS` nor `ETP_ONLY_PATHS`, so `canAccessPath` returns `true` for **both** roles — this is the one dashboard route that is universally reachable, which is exactly why wrong-role redirects `router.replace("/dashboard")` here as the safe fallback. Note `matches` is segment-aware (`pathname === p || pathname.startsWith(p + "/")`) so `/dashboard/etp` never swallows `/dashboard/etp-entry`.

---

## Data — store reads & writes

Everything is read from the Zustand stores; **this page writes nothing** (no store actions are invoked — CSV export is a pure client-side download, not a store mutation).

### `page.tsx`
| Selector | Store | Source |
| --- | --- | --- |
| `role` | `useAuthStore((s) => s.role)` | `lib/store/auth.ts` |

### `AdminOverview` (`components/dashboard/admin-overview.tsx:20-25`)
| Selector | Notes |
| --- | --- |
| `useDataStore(useShallow(selectMetrics))` | Derived metrics object (see below); `useShallow` prevents re-render churn since a fresh object is returned each call |
| `alerts` | full alert array |
| `approvals` | full approval array |
| `etpEntries` | full ETP water-balance array |
| `readings` | full flow-meter reading array |
| `industries` | full industry array |

`selectMetrics` (`lib/store/data.ts:473-481`) returns:

```ts
{
  totalIndustries: industries.length,
  pendingApprovals: approvals where stage ∈ {submitted, verification},
  rejectedEntries:  approvals where stage === "rejected",
  nonReporting:     industries where status === "non-reporting",
  activeAlerts:     alerts where status === "active",
}
```

### `EtpOverview` (`components/dashboard/etp-overview.tsx:22-26`)
| Selector | Store | Notes |
| --- | --- | --- |
| `industryId` | `useAuthStore` | the operator's own tenant id (set at login) |
| `industries` | `useDataStore` | used to `find` the operator's own `industry` |
| `etpEntries` | `useDataStore` | filtered to `industryId` as `mine` |
| `alerts` | `useDataStore` | filtered to `industryId` + active as `myAlerts` |
| `compliance` | `useDataStore` | `find` own record as `myCompliance` |

Because the store is **sharded per tenant** on write and role-scoped on read (`components/shared/store-hydrator.tsx`), an `etp` session's store arrays contain only its own slice, so these `.filter(... === industryId)` calls are a second, defence-in-depth scoping on top of Firestore's per-tenant isolation.

---

## Layout & sections

### A) `AdminOverview` — Command Center

Rendered top-to-bottom inside `<div className="space-y-6">` (line 64):

1. **`PageHeader`** (lines 65-69) — eyebrow "Monitoring Body · Demo session", title "Command Center Overview", plus a descriptive blurb about the Balotra cluster.

2. **Metric grid** (lines 71-75) — `grid-cols-2 … lg:grid-cols-3 xl:grid-cols-6`, mapping `metricCards` (lines 53-61) to `MetricCard`. Seven cards, in order:

   | Label | Value | Icon | Accent | Extra |
   | --- | --- | --- | --- | --- |
   | ETP Units | `etpUnits.length` | Droplets | `#0d9488` | delta `live` (positive/green ↑) |
   | Total Industries | `metrics.totalIndustries` | Factory | `#8b5cf6` | — |
   | Pending Approvals | `metrics.pendingApprovals` | Clock | `#f59e0b` | hint "Awaiting review" |
   | Rejected Entries | `metrics.rejectedEntries` | XCircle | `#ef4444` | hint "This cycle" |
   | Non-Reporting | `metrics.nonReporting` | WifiOff | `#fb923c` | hint "48h+ silent" |
   | Active Alerts | `metrics.activeAlerts` | BellRing | `#0ea5e9` | delta `live` (positive:false → amber ↓) |
   | ETP Entries | `etpEntries.length` | FileSpreadsheet | `#06b6d4` | hint "Submitted" |

   `MetricCard` (`components/dashboard/metric-card.tsx`) animates in with a staggered `delay: index * 0.06` and renders the number via `AnimatedCounter`. `delta.positive` toggles an up/green vs down/amber pill — note "Active Alerts" is intentionally styled as amber-down.

3. **Two-column row** `lg:grid-cols-[1fr_1.1fr]` (lines 77-111):
   - **ETP Treatment Pipeline** card — heading + "Combined sanctioned capacity across individual ETP units" + `<PipelineFlow flow={flow} />` (the aggregate `flow`, see Key flows).
   - **ETP Units** card — heading with a "View all" link to `/dashboard/etp`; then one row per `etpUnits` entry (lines 94-107). Each row is a `Link` to `/dashboard/etp` showing a Droplets icon, `ind.name`, `<StatusBadge status={ind.status} />`, then `ind.area` (truncated) and `Permitted <permittedKLD> KLD`. Empty state (line 108): "No ETP units registered".

4. **Reports & Exports** card (lines 114-121) — heading "· generated live from current data" then `<ReportsPanel />` (see below).

5. **Recent Submissions** — `<ListPanel title="Recent Submissions" href="/dashboard/etp" empty="No submissions yet">` (lines 124-139), one row per `recentSubs` item: a Send icon, `s.name`, a `<span>{s.kind}</span> · {s.value}` line, and `formatDate(s.date)` on the right.

6. **Alerts + Approvals** two-column row `lg:grid-cols-2` (lines 142-175):
   - **Recent Alerts** `ListPanel` → `/dashboard/alerts` (empty "No active alerts"). Each of `recentAlerts` renders an icon tinted with `ALERT_META[a.type].color`, `a.title`, `<StatusBadge status={a.severity} dot={false}/>`, the message (`line-clamp-1`) and `timeAgo(a.createdAt)`.
   - **Pending Approvals** `ListPanel` → `/dashboard/approvals` (empty "All caught up"). Each of `pendingApprovals` shows a Clock icon, `a.industryName`, `a.meterPoint · {formatNumber(a.difference)} {displayUnit(a.unit)}`, and `<StatusBadge status={a.stage} dot={false}/>`.

**`ListPanel`** (lines 180-194) is a local helper: a titled card with a "View all →" link; it flattens `children`, and if `items.flat().filter(Boolean).length === 0` shows the `empty` message instead.

**`ReportsPanel`** (`components/dashboard/reports-panel.tsx`) renders 8 export tiles (Daily, Monthly, Industry-Wise, Compliance, Pending, Rejected, Non-Reporting, ETP Entries). Each tile shows a live `count` badge and, on click, `handleExport` fakes an 800 ms `setTimeout`, builds rows via its `build()` fn, and downloads `jalrakshak-<key>-<TODAY>.csv` via `toCSV`. Note `TODAY` is a hard-coded constant `"2026-06-20"` (line 20) used for both the "Daily" filter and the export filename.

### B) `EtpOverview` — the operator's own unit

**Guard first** (lines 56-63): if `industry` is undefined (no unit linked to `industryId`), the whole page short-circuits to a centered "No ETP unit linked to this session" message with a link to `/login`.

Otherwise, inside `<div className="space-y-6">` (line 120):

1. **`PageHeader`** (lines 121-132) — eyebrow "ETP Industry · Daily water balance", title `industry.name`, description `${industry.area} · Consent ${industry.consentNumber}`, and an action `Button` linking to `/dashboard/etp-entry` labelled "Add Today's Entry".

2. **Unit header + quick stats** `lg:grid-cols-[1.3fr_1fr]` (lines 135-155):
   - Left card: big `industry.complianceScore%` colored by `color` (derived from `complianceStatus`), a "compliance" caption, `<StatusBadge status={industry.status}/>`, an "Individual ETP" pill, `Permitted <permittedKLD> KLD`, and `Last entry {formatDate(industry.lastReadingAt, true)}` (with time).
   - Right: three `Stat` tiles (helper at lines 285-293) — **My Entries** = `mine.length`, **Pending** = `pending`, **Alerts** = `myAlerts.length`.

3. **Total-intake + balance** row `lg:grid-cols-[1fr_1fr_2fr]` (lines 158-204):
   - **Total Water Intake (latest)** card (lines 159-166): `latest ? formatNumber(latest.totalWaterIntake) : "—"` m³, subtitle "= Fresh Water + ETP Reuse + RO Permeate", and "Recorded {formatDate(latest.date)}".
   - **Total Water Intake** today-vs-yesterday card (lines 167-190): three rows — **Today** `formatNumber(intake.today)`, **Yesterday** `formatNumber(intake.yesterday)`, and a bordered **Difference** row that prefixes `+` / `−` (U+2212 minus) / nothing based on sign and prints `formatNumber(Math.abs(intake.difference))`. All in m³.
   - **Balance tiles** grid (lines 191-203): five tiles from the `balance` array (lines 67-73), each pulled from `latest` (or "—" when `latest`/value is null): **Fresh Water** (`freshWaterConsumption`, `#0ea5e9`), **ETP Reuse** (`etpReuse`, `#10b981`), **RO Permeate** (`roPermeate`, `#6366f1`), **RO Reject** (`roReject`, `#f59e0b`), **Sludge → TSDF** (`sludgeToTSDF`, `#a78bfa`).

4. **My Treatment Pipeline** card (lines 207-213) — `<PipelineFlow flow={buildEtpStageFlow(industry)} />` (this unit's own 7-stage capacity pipeline).

5. **My Alerts** card (lines 216-242) — empty state "No active alerts — keep it up!"; otherwise one row per `myAlerts` entry (icon tinted by `ALERT_META[a.type].color`, `a.title`, `a.message`, `timeAgo(a.createdAt)`, `<StatusBadge status={a.severity} dot={false}/>`). If `myCompliance` exists, a footer link "Record today's water balance →" points to `/dashboard/etp-entry`.

6. **Reading History & Report** card (lines 245-260) — heading + a "Download CSV" `Button` (`onClick={handleDownload}`, `disabled={mine.length === 0}`), then a `<DataTable columns={columns} data={mine} pageSize={8} emptyMessage="No readings filed yet." />` with a "Search readings…" box.

---

## Forms & validation

Neither branch contains a form. `EtpOverview`'s only interactive controls are:

- The **"Download CSV"** button (and the "Add Today's Entry" / "Record today's water balance" links, which just navigate to `/dashboard/etp-entry`).
- The `DataTable` search box, which is client-side filtering only.

All actual data entry happens on `/dashboard/etp-entry` (documented separately). `AdminOverview`'s only actions are the `ReportsPanel` export buttons.

The `DataTable` column set (`columns`, lines 75-95) defines how each `EtpEntry` row renders:

| Column (accessorKey) | Header | Cell |
| --- | --- | --- |
| `date` | Date | `formatDate(date)` |
| `freshWaterConsumption` | Fresh Water | `<Num>` |
| `etpInlet` | ETP Inlet | `<Num>` |
| `etpOutlet` | ETP Outlet | `<Num>` |
| `etpReuse` | ETP Reuse | `<Num>` |
| `roInlet` | RO Inlet | `<Num>` |
| `roReject` | RO Reject | `<Num>` |
| `roPermeate` | RO Permeate | `<Num>` |
| `sludgeToTSDF` | Sludge→TSDF | `<Num>` |
| `totalWaterIntake` | Total Intake | bold, with an `m³` suffix |
| `status` | Status | `<StatusBadge status={status}/>` |

`Num` (lines 265-272) renders `formatNumber(v)` in a mono font with an optional unit suffix (unused here — every ETP volume column omits the per-cell unit).

---

## Key flows & logic

### Admin — aggregate ETP pipeline (`flow`, lines 33-42)

```tsx
const etpUnits = industries.filter((i) => i.isIndividualETP);   // line 27
const flow = useMemo(() => {
  if (etpUnits.length === 0) return [];
  const sums: number[] = [];
  for (const ind of etpUnits) {
    buildEtpStageFlow(ind).forEach((n, i) => { sums[i] = (sums[i] ?? 0) + n.value; });
  }
  // reuse the FIRST unit's node shape (labels/units), override each value with the summed total
  return buildEtpStageFlow(etpUnits[0]).map((n, i) => ({ ...n, id: `agg-${n.short}`, value: sums[i] ?? n.value }));
}, [etpUnits]);
```

`buildEtpStageFlow` (`lib/data/etp-flow.ts:4-21`) produces a fixed **7-stage** array — `Raw` (Max. Effluent Generation), `ETP`, `RO I…IV`, `MEE` — all in **KLD**, using each unit's `maxEffluentGeneration` / `etpCapacity` / `roStage1..4` / `meeCapacity` (with sensible fallbacks derived from `permittedKLD` / `roCapacity`). The aggregate sums each stage's `value` index-by-index across all individual-ETP units, then borrows the first unit's labels/units for display and rewrites the ids to `agg-<short>`.

### Admin — recent submissions feed (`recentSubs`, lines 45-51)

```tsx
const subs = [
  ...etpEntries.map((e) => ({ id, kind: "ETP",   name: e.industryName, date: e.date, at: e.submittedAt, value: `Intake ${formatNumber(e.totalWaterIntake)} m³` })),
  ...readings.map((r)  => ({ id, kind: "Meter", name: r.industryName, date: r.date, at: r.submittedAt, value: `${r.meterPoint} ${formatNumber(r.difference)} ${displayUnit(r.unit)}` })),
];
return subs.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
```

It **merges two record types** (ETP water-balance entries and flow-meter readings), sorts by `submittedAt` (`at`) descending via string `localeCompare` (ISO timestamps sort correctly lexically), and keeps the newest 6. Note the displayed timestamp uses `formatDate(s.date)` (the reading/entry **date**), while sorting uses `submittedAt` — the two can differ.

### Admin — filtered slices
- `recentAlerts = alerts.filter(status === "active").slice(0, 5)` (line 29)
- `pendingApprovals = approvals.filter(stage ∈ {submitted, verification}).slice(0, 5)` (line 30)

### ETP — date-keyed today-vs-yesterday intake (the core logic, lines 30-51)

```tsx
const mine = etpEntries
  .filter((e) => e.industryId === industryId)
  .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));   // newest submission first
const latest = mine[0];

// todayStr is computed CLIENT-SIDE in an effect to avoid SSR/hydration mismatch
const [todayStr, setTodayStr] = useState("");
useEffect(() => {
  const n = new Date();
  const p = (x) => String(x).padStart(2, "0");
  setTodayStr(`${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`);
}, []);

const yesterdayStr = useMemo(() => {
  if (!todayStr) return "";
  const d = new Date(todayStr + "T00:00:00");
  d.setDate(d.getDate() - 1);
  // …format back to YYYY-MM-DD
}, [todayStr]);

const intake = dailyIntake(mine, todayStr, yesterdayStr);   // line 51
```

`dailyIntake` (`lib/store/data.ts:467-471`) is a pure selector keyed on the stored entry **date string**, not on array position:

```ts
export function dailyIntake(entries, todayStr, yesterdayStr) {
  const today     = entries.find((e) => e.date === todayStr)?.totalWaterIntake     ?? 0;
  const yesterday = entries.find((e) => e.date === yesterdayStr)?.totalWaterIntake ?? 0;
  return { today, yesterday, difference: today - yesterday };
}
```

Why date-keyed matters: because "today" is derived from the real calendar date at render time, when the clock rolls past midnight the entry that was "today" automatically becomes "yesterday" **with no code change or data mutation** — and a day with no entry counts as `0`. The `todayStr` computation is deliberately identical to how the entry form builds its local `YYYY-MM-DD` date, so the strings line up exactly.

### ETP — other derived values
- `myAlerts = alerts.filter(industryId === … && status === "active").slice(0, 5)` (line 52)
- `pending = mine.filter(status === "pending").length` (line 53) — counts the operator's own not-yet-decided entries.
- `myCompliance = compliance.find(industryId === …)` (line 54)
- `color = STATUS_COLOR[complianceStatus(industry.complianceScore)]` (line 65) — `complianceStatus` thresholds (`lib/constants.ts:121-125`): ≥85 `compliant` (green `#10b981`), ≥70 `warning` (amber `#f59e0b`), else `non-compliant` (red `#ef4444`).

### ETP — CSV export (`handleDownload`, lines 97-117)

```tsx
const handleDownload = () => {
  if (!mine.length) return;
  const rows = mine.map((e) => ({
    Date: e.date,
    "Fresh Water (m³)": e.freshWaterConsumption,
    "ETP Inlet (m³)": e.etpInlet,
    /* … all balance fields, each header labelled (m³) … */
    "Total Water Intake (m³)": e.totalWaterIntake,
    Status: e.status,
    "Submitted At": e.submittedAt,
  }));
  const today = /* local YYYY-MM-DD */;
  download(`jalrakshak-etp-${industry.id}-${today}.csv`, toCSV(rows));
  toast.success("ETP report exported", { description: `${rows.length} reading(s) · ${industry.name}` });
};
```

- Guards on empty (`if (!mine.length) return`), matching the button's `disabled` state.
- `toCSV` (`lib/utils.ts:63-72`) is **hardened against CSV/formula injection**: any cell text starting with `= + - @ tab CR` is prefixed with a single quote so spreadsheets treat it as literal text; all values are double-quote-wrapped with embedded quotes doubled.
- `download` (lines 275-283) is a purely local Blob → object-URL → synthetic `<a>.click()` → `revokeObjectURL`. No store mutation, no network.

---

## Units & formatting (KLD vs m³)

| Quantity | Stored as | Displayed as | Where |
| --- | --- | --- | --- |
| Plant **capacities** (permitted, ETP, RO stages, MEE) | number (KLD) | `KLD` | Unit header "Permitted … KLD", pipeline nodes (`unit: "KLD"` in `buildEtpStageFlow`) |
| **Water-balance volumes** (fresh water, reuse, permeate, intake, …) | `EtpEntry.unit === "KL"` (`lib/types.ts:96`) | `m³` | intake cards, balance tiles, table, CSV headers |
| Flow-meter reading volumes | `unit` string (e.g. "KL") | via `displayUnit(u)` → `m³` | Admin recent-submissions + pending-approvals rows |

`displayUnit` (`lib/utils.ts:17`) maps `"KL" → "m³"` (leaving e.g. `"kWh"` untouched). **Inconsistency worth noting:** `AdminOverview` uses `displayUnit(r.unit)` / `displayUnit(a.unit)` for flow-meter rows, but for ETP entries — both in `AdminOverview.recentSubs` and throughout `EtpOverview` — the `m³` string is **hard-coded in JSX** rather than routed through `displayUnit`. This is safe today only because `EtpEntry.unit` is the literal type `"KL"`; the display value is decoupled from the stored `unit` field.

`formatNumber` (`lib/utils.ts:8-10`) formats with the `en-IN` locale (Indian digit grouping). `formatDate` / `timeAgo` handle date and relative-time display; `formatDate(iso, true)` adds hour/minute.

---

## Edge cases & gotchas

- **`todayStr` is empty on first paint.** It's set in a `useEffect`, so during SSR and the first client render `todayStr === ""` → `dailyIntake` matches no entry → the today/yesterday/difference card shows `0 / 0 / 0` until the effect runs. This is intentional (avoids a hydration mismatch) but means the intake card briefly flashes zeros.
- **"latest" vs "today" are two different notions.** The "Total Water Intake (latest)" card uses `mine[0]`, i.e. the entry with the newest `submittedAt`. The today-vs-yesterday card keys on the entry **date** (`e.date`). If an operator back-dates or submits out of order, the "latest" card and the "Today" figure can disagree.
- **Sort key ≠ display key** in the admin recent-submissions feed: sorted by `submittedAt`, but the row prints `formatDate(s.date)`.
- **Empty aggregate pipeline.** If there are zero individual-ETP units, `flow` is `[]` (line 34) and `buildEtpStageFlow(etpUnits[0])` is never called (guarded), so `PipelineFlow` receives an empty array. The ETP-units list separately shows "No ETP units registered".
- **`etp` operator with no linked unit** hits the full-page guard (lines 56-63) and sees only the "No ETP unit linked to this session" message — none of the cards render. This happens if `industryId` is null or points to an industry absent from the (tenant-scoped) store.
- **Both roles can reach `/dashboard`.** It is the shared fallback; wrong-role visits to admin-only or etp-only routes are redirected *to* here (`dashboard-shell.tsx:29`).
- **The "Record today's water balance" link only renders if `myCompliance` exists** (line 237) — a freshly registered unit gets a compliance record at registration (`registerIndustry`, `lib/store/data.ts:414-429`), so in practice it's present, but a data slice missing that record would hide the CTA.
- **`ReportsPanel` uses a frozen `TODAY = "2026-06-20"`** for its "Daily" filter and export filenames, whereas `EtpOverview`'s CSV uses the *real* current date. The two exports therefore carry different date stamps.
- **`AnimatedCounter` with `startOnView={false}`** (metric cards) animates immediately on mount rather than on scroll-into-view.
- **No writes / no server round-trips** occur on this page beyond store reads; all "exports" are local Blob downloads.

---

## Related files

| File | Role |
| --- | --- |
| `app/dashboard/page.tsx` | Route entry; role switch |
| `app/dashboard/layout.tsx` | Wraps route in `theme-dash` + `DashboardShell` |
| `components/dashboard/dashboard-shell.tsx` | Auth/role redirect gating + loading splash |
| `components/dashboard/admin-overview.tsx` | Admin (Monitoring Body) dashboard body |
| `components/dashboard/etp-overview.tsx` | ETP operator dashboard body |
| `components/dashboard/reports-panel.tsx` | 8-tile CSV export panel (admin) |
| `components/dashboard/metric-card.tsx` | Animated KPI card |
| `components/dashboard/pipeline-flow.tsx` | Treatment-pipeline visual |
| `components/dashboard/page-header.tsx` | Section header (eyebrow/title/description/actions) |
| `components/dashboard/data-table.tsx` | TanStack-backed reading-history table |
| `lib/store/auth.ts` | `useAuthStore`, `isAdmin`, `isEtp`, `role`, `industryId` |
| `lib/store/data.ts` | `useDataStore`, `selectMetrics`, `dailyIntake` |
| `lib/data/etp-flow.ts` | `buildEtpStageFlow` (7-stage capacity pipeline) |
| `lib/constants.ts` | `canAccessPath`, `ADMIN_ONLY_PATHS`/`ETP_ONLY_PATHS`, `ALERT_META`, `STATUS_COLOR`, `complianceStatus` |
| `lib/utils.ts` | `formatNumber`, `formatDate`, `timeAgo`, `displayUnit`, `toCSV` |
| `lib/types.ts` | `Industry`, `EtpEntry`, `ComplianceRecord`, `FlowMeterReading` shapes |
| `components/shared/store-hydrator.tsx` | Loads role-scoped, per-tenant data into the store |
