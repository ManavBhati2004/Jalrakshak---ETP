# `/dashboard/reports` — Reports & CSV Exports

> Route: `/dashboard/reports` · File: `app/dashboard/reports/page.tsx` · Roles: **monitoring-admin only** (URL-reachable; no sidebar link) · Rendered by: `ReportsPage` (default export)

---

## Purpose

A one-click **CSV export** hub for the RSPCB Monitoring Body. It turns the live client-side Zustand data store into Excel/Sheets/LibreOffice-ready `.csv` downloads for inspections, audits and review meetings. Every export is generated **entirely in the browser** — there is no server round-trip, no API, and no file is stored anywhere; the browser synthesizes a `Blob` and triggers a download.

There are **two closely-related surfaces** built from the same helpers (`download()` + `toCSV`):

| Surface | Component | File | Exports | Where it appears |
|---|---|---|---|---|
| Standalone page | `ReportsPage` | `app/dashboard/reports/page.tsx` | **7** | Route `/dashboard/reports` (no nav link) |
| Dashboard panel | `ReportsPanel` | `components/dashboard/reports-panel.tsx` | **8** | Embedded in the admin overview (`admin-overview.tsx:120`) |

The panel is the surface admins actually see day-to-day (it lives on the main `/dashboard`); the standalone page is a fuller-bleed version reachable only by typing the URL.

---

## Access & gating (auth / redirects / role gate)

The reports route has **no `DASHBOARD_NAV` entry** — it is intentionally not linked in the sidebar (`lib/constants.ts:44-52`). It is reachable only by navigating to the URL directly, and only admins survive the gate.

Gating is enforced by **`DashboardShell`** (`components/dashboard/dashboard-shell.tsx`), which wraps every `/dashboard/*` page:

- It reads `role` and `authReady` from `useAuthStore` (`dashboard-shell.tsx:16-17`).
- In an effect (`dashboard-shell.tsx:21-31`):
  - if `!authReady` → wait (render the loading shimmer at `:33-43`);
  - if `!role` → `router.replace("/login")`;
  - if `!canAccessPath(role, pathname)` → `router.replace("/dashboard")`.

`canAccessPath` (`lib/constants.ts:65-72`) decides via `ADMIN_ONLY_PATHS`, which **includes `/dashboard/reports`** (`lib/constants.ts:54-61`):

```ts
export const ADMIN_ONLY_PATHS = [
  "/dashboard/industries", "/dashboard/etp", "/dashboard/approvals",
  "/dashboard/compliance", "/dashboard/alerts",
  "/dashboard/reports",            // ← reports is admin-only
];
// monitoring-admin: return !inEtp   → true for /dashboard/reports  → allowed
// etp:              return !inAdmin → false for /dashboard/reports → redirected to /dashboard
```

Net effect:
- **`monitoring-admin`** → allowed.
- **`etp` operator** → `canAccessPath` returns `false` → redirected to `/dashboard`.

> This client redirect is **UX only, not a security boundary.** Per the project architecture (`CLAUDE.md:62`), Firestore rules are the real boundary; the client scoping just mirrors them. The reports data is whatever the store already holds, which for an `etp` role would be their own slice only — but the redirect means an operator never reaches this page regardless.

The embedded `ReportsPanel` is rendered inside `admin-overview.tsx` (`:120`), which itself only renders for the admin dashboard, so the 8-export panel is also admin-scoped in practice.

---

## Data — store reads & writes

**Reads only. This page writes nothing to the store** (no `useDataStore` actions are called, no `useAuthStore` mutations). It is a pure read → serialize → download pipeline.

### `ReportsPage` (standalone, 7 exports) — `page.tsx:23-26`

```ts
const readings   = useDataStore((s) => s.readings);
const industries = useDataStore((s) => s.industries);
const approvals  = useDataStore((s) => s.approvals);
const compliance = useDataStore((s) => s.compliance);
```

It does **not** read `etpEntries` — hence 7 reports, not 8.

### `ReportsPanel` (embedded, 8 exports) — `reports-panel.tsx:33-37`

```ts
const readings   = useDataStore((s) => s.readings);
const industries = useDataStore((s) => s.industries);
const approvals  = useDataStore((s) => s.approvals);
const compliance = useDataStore((s) => s.compliance);
const etpEntries = useDataStore((s) => s.etpEntries);   // ← extra selector → 8th export
```

Local UI state in both: `const [busy, setBusy] = useState<string | null>(null)` — holds the `key` of the report currently exporting so its button shows a spinner and disables.

The store arrays come from `lib/store/data.ts` (six flat arrays hydrated per-tenant by `StoreHydrator` and persisted/sharded via `lib/data/firestore-storage.ts`). Their element shapes are the domain types in `lib/types.ts` (`FlowMeterReading`, `Industry`, `Approval`, `ComplianceRecord`, `EtpEntry`).

---

## Layout & sections

### Standalone page (`page.tsx:50-88`)

Top-to-bottom, inside a `space-y-6` container:

1. **`PageHeader`** (`:52-56`) — eyebrow `"Governance"`, title `"Reports & Exports"`, description: *"Generate Excel-ready exports for inspections, audits and review meetings. Demo exports download real CSV files."*

2. **Report grid** (`:58-79`) — `grid gap-4 sm:grid-cols-2 xl:grid-cols-4`, mapping `REPORTS` to cards. Each card (`:60-77`) contains:
   - a rounded icon tile tinted with the report's `color` (`background: ${r.color}1a`, i.e. ~10% alpha) — `:62-64`;
   - a **`{count} rows` badge** (`:65`) driven by the report's live `count`;
   - the report **title** (`:67`) and **description** (`:68`);
   - an **Export button** (`:69-76`): disabled while `busy === r.key`; shows `Loader2` spinner + "Exporting…" when busy, else `Download` icon + "Export".

3. **Footer note card** (`:81-86`) — a `FileSpreadsheet` icon + copy explaining exports are generated client-side from live demo state.

### Embedded panel (`reports-panel.tsx:62-85`)

A denser `grid grid-cols-2 gap-3 sm:grid-cols-4`. Here **the entire card is the `<button>`** (`:65-83`) rather than a card containing a button:
- icon tile (swaps to `Loader2` spinner while busy) — `:72-74`;
- a compact count badge (just the number, no "rows") — `:75`;
- title + description — `:77-78`;
- a persistent "Export CSV" affordance with a `Download` icon — `:79-81`.

The panel is wrapped by the admin overview under a "Reports & Exports" heading with a `FileSpreadsheet` icon (`admin-overview.tsx:113-121`).

### The report catalog

Each entry is `{ key, title, desc, icon, color, count, build }`. `count` is evaluated on every render (live); `build()` is called lazily at export time to produce the row array.

**Standalone `REPORTS` (7)** — `page.tsx:29-37`:

| key | title | `count` predicate | `build()` rows | Fields stripped |
|---|---|---|---|---|
| `daily` | Daily Report | `readings.filter(r => r.date === TODAY).length` | readings on `TODAY` | none |
| `monthly` | Monthly Report | `readings.length` | all readings | none |
| `industry` | Industry-Wise | `industries.length` | `industries.map(({ flow, ...rest }) => rest)` | `flow` (**no-op**, see gotchas) |
| `compliance` | Compliance Report | `compliance.length` | `compliance.map(({ trend, ...rest }) => rest)` | `trend` |
| `pending` | Pending Entries | approvals with `stage === "submitted" \|\| "verification"` | same filter, `.map(({ timeline, alerts, ...rest }) => rest)` | `timeline`, `alerts` |
| `rejected` | Rejected Entries | approvals with `stage === "rejected"` | same filter, `.map(({ timeline, alerts, ...rest }) => rest)` | `timeline`, `alerts` |
| `nonreporting` | Non-Reporting | `industries.filter(i => i.status === "non-reporting")` | same filter | none |

**Embedded `REPORTS` (8)** — `reports-panel.tsx:40-49`: same seven **plus** an eighth, with two differences from the page:

| key | title | `build()` rows | Difference vs. page |
|---|---|---|---|
| `industry` | Industry-Wise | `industries` (raw) | **No `flow` strip** — passes the array through as-is |
| `etp` | ETP Entries | `etpEntries` (all) | **Panel-only** 8th export; `count = etpEntries.length` |

Titles/descriptions/colors also differ cosmetically (e.g. page "Daily Report" vs panel "Daily"; page uses cyan `#22d3ee`, panel indigo `#6366f1`), but the underlying data selection is identical for the shared seven except the `industry` strip noted above.

---

## Forms & validation

**None.** There is no form, no zod schema, no text input, and no user-entered data. The only interaction is clicking an export button. Nothing is validated because nothing is entered — the "input" is the current store state.

---

## Key flows & logic

### `TODAY` — the hardcoded reference date

Both files declare, at module scope:

```ts
const TODAY = "2026-06-20";   // page.tsx:10  and  reports-panel.tsx:20
```

This is a **fixed literal**, not `new Date()`. It matches `DEMO_TODAY` in the seed generator (`lib/data/seed.ts:19`), so the demo data is internally consistent with it. It drives:
- the **Daily** report filter (`r.date === TODAY`), and
- the **filename** of every export (`jalrakshak-${key}-${TODAY}.csv`).

Because it never advances, "today" is frozen at 2026-06-20 regardless of the real calendar date (the auto-memory `currentDate` is 2026-08-04, for contrast). See gotchas.

### `handleExport(r)` — the export pipeline

`page.tsx:39-48` (panel is identical bar timings/strings — `reports-panel.tsx:51-60`):

```ts
const handleExport = (r) => {
  setBusy(r.key);                                   // 1. mark this card busy (spinner + disable)
  const id = toast.loading(`Generating ${r.title}…`); // 2. loading toast (panel: "…report…")
  setTimeout(() => {                                 // 3. simulated 900ms latency (panel: 800ms)
    const rows = r.build() as Record<string, unknown>[]; // 4. materialize rows from live store
    download(`jalrakshak-${r.key}-${TODAY}.csv`, toCSV(rows)); // 5. serialize + download
    toast.success(`${r.title} exported`, {          // 6. success toast, resolves the loading one
      id, description: `${rows.length} rows · Excel-ready CSV`,
    });
    setBusy(null);                                   // 7. clear busy
  }, 900);
};
```

Notes:
- The `setTimeout` (900 ms page / 800 ms panel) is purely cosmetic — a fake "generating…" delay so the spinner and toast feel real. The work itself is synchronous.
- `toast.loading` returns an `id` that is reused in the `toast.success` call so the single toast transitions from spinner → checkmark rather than stacking.
- `r.build()` is invoked **at click time**, so exports always reflect the latest store state (submit a reading elsewhere, come back, re-export — it reflects). The footer copy states exactly this (`page.tsx:83-85`).

### `download(filename, content)` — the browser download

Identical in both files (`page.tsx:12-20`, `reports-panel.tsx:22-30`):

```ts
function download(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
```

Classic client-side download: build an in-memory `Blob`, mint an object URL, click a synthetic `<a download>`, then revoke the URL. UTF-8 charset is declared in the MIME type. No server, no persistence.

### `toCSV(rows)` — serialization + formula-injection hardening

`lib/utils.ts:63-72`. This is the security-relevant core.

```ts
export function toCSV(rows: Record<string, unknown>[]) {
  if (!rows.length) return "No data";                     // (a) empty guard
  const headers = Object.keys(rows[0]);                   // (b) header = keys of FIRST row
  const escape = (v: unknown) => {
    const s = String(v ?? "");                            // (c) null/undefined → ""
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;    // (d) formula-injection guard
    return `"${safe.replace(/"/g, '""')}"`;               // (e) quote-wrap, double embedded quotes
  };
  return [headers.join(","), ...rows.map((r) =>
    headers.map((h) => escape(r[h])).join(",")
  )].join("\n");                                          // (f) header row + data rows, \n-joined
}
```

Step by step:
- **(a)** Empty input returns the literal string `"No data"` — so an export of a report whose `build()` yields `[]` produces a one-line CSV containing `No data` (not an empty file, not a header-only file).
- **(b)** Column headers are taken from `Object.keys(rows[0])` — **the first row only** (see gotchas re: heterogeneous rows).
- **(c)** Each cell is coerced with `String(v ?? "")`, so `null`/`undefined` become empty strings; objects would become `"[object Object]"` (which is why nested fields like `timeline`, `alerts`, `trend`, `flow` are stripped in `build()` before serialization).
- **(d) Formula/CSV-injection hardening:** if a cell's text **starts with** `=`, `+`, `-`, `@`, tab (`\t`) or carriage-return (`\r`) — the characters a spreadsheet treats as the start of a formula — it is prefixed with a single quote (`'`). Excel / Google Sheets / LibreOffice then render it as literal text and **never evaluate it**. This blocks payloads like `=HYPERLINK(...)`, `=cmd|...`, `+1+1`, `@SUM(...)` that could otherwise execute when a downloaded CSV is opened. The regex is anchored with `^`, so only the leading character matters. (Documented in the JSDoc at `lib/utils.ts:56-62`.)
- **(e)** Every value is wrapped in double quotes, and any embedded `"` is doubled (`"` → `""`) — RFC-4180 quoting that safely contains commas, quotes and newlines inside a field.
- **(f)** Output = header line, then one line per row, joined with `\n`.

---

## Units & formatting (KLD vs m³)

The exports dump **raw stored values verbatim** — there is **no unit conversion or number formatting** in the CSV path.

- Water-balance and reading volumes are stored as `"KL"` (see `FlowMeterReading.unit`, `EtpEntry.unit: "KL"` — `lib/types.ts:112,96`). The UI elsewhere displays these as **m³** via `displayUnit()` (`lib/utils.ts:17`: `u === "KL" ? "m³" : u`). **`toCSV` does not call `displayUnit()`** — so a `unit` column in the Daily/Monthly/ETP exports contains the literal string `KL`, not `m³`. The CSV therefore shows the *stored* unit, diverging from what the operator sees on-screen.
- Capacities (`permittedKLD`, `etpCapacity`, …) are exported as bare numbers with their field names ending in `KLD`; `formatKLD()`/`formatNumber()` (`lib/utils.ts:8-14`) are **not** applied — no thousands separators, no unit suffix in the values themselves.
- `EtpEntry.totalWaterIntake` (= `freshWaterConsumption + etpReuse + roPermeate`, computed in the store at `data.ts:216`) is exported as its stored numeric value.

In short: the CSV is a faithful dump of internal state, intentionally un-prettified so it round-trips cleanly into spreadsheets. Any KLD-vs-m³ interpretation is left to the reader.

---

## Edge cases & gotchas

- **`TODAY` is frozen at `"2026-06-20"`.** It never tracks the real date. Consequences: (1) the Daily filter only ever matches rows whose `date` equals that string; (2) every filename is stamped `…-2026-06-20.csv` regardless of when you export. To "advance the day" you must edit the literal in **both** files (and ideally `DEMO_TODAY`).
- **The Daily report is usually empty from seed data.** Seed readings are dated at day-offsets **2 and 1** back from `DEMO_TODAY` (`seed.ts:69-104`: `days = 2`, loop `d = 2 → 1`, `date: dayISO(d).slice(0,10)`), i.e. `2026-06-18` and `2026-06-19` — **never offset 0 (`2026-06-20`)**. So out of the box `readings.filter(r => r.date === TODAY)` is `[]`, the Daily card shows **0 rows**, and its export produces the single line `No data`. A Daily row appears only after someone submits a reading/entry dated `2026-06-20`.
- **`No data` sentinel, not an empty CSV.** Any report whose `build()` returns `[]` (empty Daily, no rejected entries, etc.) downloads a file containing exactly `No data` — no headers. Opening it in Excel yields one cell.
- **The `flow` strip on the standalone Industry export is a no-op.** `industries.map(({ flow, ...rest }) => rest)` (`page.tsx:32`, typed `any`) destructures a `flow` property that **does not exist** on the `Industry` type (`lib/types.ts:38-65`). So `flow` is `undefined` and nothing is actually removed — the export is the full industry object. The embedded panel omits this strip entirely (`reports-panel.tsx:43`), so both surfaces export identical industry columns.
- **Headers come from the first row only.** `Object.keys(rows[0])` (`utils.ts:65`). If rows were heterogeneous, extra keys on later rows would be silently dropped and keys missing from row 0 would never appear as columns. These exports are homogeneous typed arrays, so it's safe today — but it's a latent trap if a report ever mixes shapes.
- **Headers are not injection-hardened.** Only *values* pass through `escape()`. `headers.join(",")` (`utils.ts:71`) emits raw, unquoted, un-guarded header text. Because headers are code-defined field names (`id`, `industryName`, …), the risk is nil today — but a header derived from user data would bypass both the quote-escaping and the formula guard.
- **Nested/object fields must be stripped before serialization.** `String(v)` turns objects into `"[object Object]"`. That's why `build()` explicitly removes `timeline`/`alerts` (Approvals), `trend` (Compliance) — otherwise those columns would be useless `[object Object]` cells. Any future report exporting an array/object field needs the same treatment.
- **No sidebar entry, admin-only.** `/dashboard/reports` is absent from `DASHBOARD_NAV`, so it's discoverable only by URL; `etp` operators hitting the URL are bounced to `/dashboard` by `DashboardShell`. The panel is the surfaced path for admins (on `/dashboard`).
- **Two sources of truth to keep in sync.** The `download()` helper, `TODAY`, and the shared seven report definitions are **duplicated** across `page.tsx` and `reports-panel.tsx`. Editing one (e.g. adding a column strip, changing a toast string, advancing the date) does not touch the other; they can drift (they already differ on the `industry` strip, the `etp` export, timings, and copy).

---

## Related files

| File | Role |
|---|---|
| `app/dashboard/reports/page.tsx` | The route component `ReportsPage` — 7 exports, `PageHeader` + card grid + footer. |
| `components/dashboard/reports-panel.tsx` | `ReportsPanel` — 8 exports (adds `etp`), embedded on the admin dashboard. |
| `lib/utils.ts` | `toCSV` (serialization + formula-injection hardening), `displayUnit`, `formatNumber`, `formatKLD`. |
| `components/dashboard/dashboard-shell.tsx` | Auth/role gate (`authReady`, `canAccessPath`) that protects the route and redirects non-admins. |
| `lib/constants.ts` | `ADMIN_ONLY_PATHS` (includes `/dashboard/reports`), `canAccessPath`, `DASHBOARD_NAV` (which omits reports). |
| `lib/store/data.ts` | `useDataStore` — the six flat arrays (`readings`, `industries`, `approvals`, `compliance`, `etpEntries`, `alerts`) the exports read. |
| `lib/types.ts` | Domain types defining exported row shapes (`FlowMeterReading`, `Industry`, `Approval`, `ComplianceRecord`, `EtpEntry`). |
| `lib/data/seed.ts` | `DEMO_TODAY = "2026-06-20"` and the seed generator whose reading dates determine the Daily count. |
| `components/dashboard/admin-overview.tsx` | Host of `ReportsPanel` (`:120`) under the "Reports & Exports" heading on the admin dashboard. |
| `components/dashboard/page-header.tsx` | `PageHeader` used at the top of the standalone page. |
