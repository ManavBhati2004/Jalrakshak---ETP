# `/dashboard/industries` — Industries Registry (Industry Management)

> Route: `/dashboard/industries` · File: `app/dashboard/industries/page.tsx` · Roles: **`monitoring-admin` only** · Rendered by: `IndustriesPage` (default export), wrapped by `DashboardShell` via `app/dashboard/layout.tsx`

---

## Purpose

The Industries registry is the Monitoring Body's (RSPCB) master roster of every **individual‑ETP textile unit** on the platform. It answers, at a glance:

- How many units are **Active / Pending / Suspended / Non‑Reporting** (status chips).
- For each unit: company + area, ETP/CETP mapping, consent number, permitted capacity (KLD), a compliance bar, and lifecycle status.
- A per‑unit **detail dialog** (owner, contacts, capacities, alerts, last reading) reachable from an inline eye icon.
- A **Register Member** call‑to‑action that routes to the onboarding form at `/dashboard/industries/register`.

It is a **read/browse** surface — no data is mutated here. The only mutation in this feature area (`registerIndustry`) lives on the `/register` subpage.

---

## Access & gating (auth / redirects / role gate)

This is a dashboard route, so the gate is applied by the shared shell, **not** by the page component itself (the page has no guard of its own).

**Layout wiring** — `app/dashboard/layout.tsx:1‑9` wraps all `/dashboard/*` children in `<DashboardShell>`.

**Redirect gate** — `components/dashboard/dashboard-shell.tsx:21‑31`:

```ts
useEffect(() => {
  if (!authReady) return;
  if (!role) { router.replace("/login"); return; }
  if (!canAccessPath(role, pathname)) { router.replace("/dashboard"); }
}, [authReady, role, router, pathname]);
```

- Until Firebase reports the initial auth state (`authReady`), the shell renders a "Loading command center…" splash (`dashboard-shell.tsx:33‑43`) — the page never mounts early.
- No session → bounce to `/login`.
- Session present but path not allowed for the role → bounce to `/dashboard`.

**The path rule** — `lib/constants.ts:54‑72`. `/dashboard/industries` is listed in `ADMIN_ONLY_PATHS` (`constants.ts:55`):

```ts
export function canAccessPath(role: RoleId, pathname: string): boolean {
  const matches = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const inAdmin = ADMIN_ONLY_PATHS.some(matches);
  const inEtp = ETP_ONLY_PATHS.some(matches);
  if (role === "monitoring-admin") return !inEtp;   // admin: allowed here
  return !inAdmin;                                    // etp: BLOCKED here
}
```

- `monitoring-admin` → allowed (the path is not an ETP‑only path).
- `etp` operator → `inAdmin === true` → returns `false` → redirected to `/dashboard`.
- The `matches` helper is **segment‑aware** (`pathname === p || startsWith(p + "/")`), so the `/dashboard/industries/register` subpage is *also* covered by the same admin‑only rule — the CTA target inherits the gate.

**Navigation visibility** — `DASHBOARD_NAV` (`constants.ts:47`) declares the "Industries" item (icon `Factory`, group `Monitoring`) with `roles: ADMIN`, so the sidebar link only appears for `monitoring-admin`. Gating (redirect) and visibility (nav filtering) are enforced separately but agree.

**Auth source** — role comes from `useAuthStore` (`lib/store/auth.ts`), populated by `StoreHydrator` from the Firestore profile `users/{uid}.role` (`components/shared/store-hydrator.tsx:78‑86`). A missing/broken profile defaults to the least‑privileged `etp` role, which cannot reach this page.

---

## Data — store reads & writes

### Reads (this page)

| Selector | Source | Line |
|---|---|---|
| `industries` | `useDataStore((s) => s.industries)` | `page.tsx:22` |

That single array is the entire data dependency. There are **no** `useAuthStore` reads and **no** store actions invoked from the listing page.

### How `industries` is populated (per‑tenant hydration)

The array is not fetched by the page — it is hydrated globally by `StoreHydrator` (`components/shared/store-hydrator.tsx`). Because this page is admin‑only, the relevant branch is the regulator branch (`store-hydrator.tsx:97‑110`):

- `monitoring-admin` → `loadAllIndustries()` merges **every** `industries/{id}` shard, then `subscribeAll(...)` live‑syncs all of them. So the admin sees the full roster.
- (An `etp` operator would instead get only `loadOneIndustry(industryId)` — but such a user never reaches this route.)
- First‑ever admin sign‑in against an empty project bootstraps the local seed into per‑industry documents (`store-hydrator.tsx:99‑106`).

### Writes

None on `/dashboard/industries`. The write for this feature is `registerIndustry` on the `/register` subpage — see **Forms & validation** and **Key flows**.

---

## Layout & sections

The page returns a single `space-y-6` column (`page.tsx:101‑148`) with four stacked blocks, in order:

### 1. `PageHeader` (page.tsx:103‑115)

- `eyebrow="Monitoring"`, `title="Industry Management"`,
- `description="All individual ETP textile units — consent, capacity and compliance at a glance."`
- `actions` = the **Register Member** button: a `Button asChild` wrapping `<Link href="/dashboard/industries/register">` with a `Plus` icon (`page.tsx:108‑113`). This is the only CTA in the header.

### 2. Status chips row (page.tsx:117‑122)

A responsive grid (`grid-cols-2 sm:grid-cols-4`) of four `Chip` cards. Values come from the `counts` memo (`page.tsx:28‑36`) which buckets `industries` by `status`:

| Chip label | Counts where `status ===` | Tone class |
|---|---|---|
| Active | `"active"` | `text-emerald-400` |
| Pending | `"pending"` | `text-amber-400` |
| Suspended | `"suspended"` | `text-red-400` |
| Non‑Reporting | `"non-reporting"` | `text-orange-400` |

`Chip` (`page.tsx:151‑158`) is a local component: a rounded bordered card with an uppercase label and the numeric value in a large `font-display` weight, colored by the passed `tone`. **These chips are display‑only counters — they are not clickable and do not filter the table.**

### 3. `DataTable` (page.tsx:124‑144)

The registry table (component: `components/dashboard/data-table.tsx`). Props passed:

- `columns` — the seven `ColumnDef<Industry>` below.
- `data={filtered}` where `filtered = useMemo(() => industries, [industries])` (`page.tsx:26`) — i.e. **all** industries, unconditionally (see gotchas).
- `searchPlaceholder="Search company, area, consent…"`.
- `toolbar` — a pill row rendered from the `FILTERS` array (`page.tsx:17‑19`), which currently contains only `{ key: "all", label: "All" }`. The active pill is highlighted; clicking sets `filter` state (`page.tsx:133`) that is otherwise unused.

**Columns** (`page.tsx:38‑99`):

| # | `accessorKey` / `id` | Header | Cell render |
|---|---|---|---|
| 1 | `name` | **Company** | `name` (semibold) over `area` (muted `text-xs`). `page.tsx:42‑47` |
| 2 | `cetpId` | **Mapping** | If `isIndividualETP` → violet chip **"Individual ETP"** (`bg-violet-500/10 text-violet-400`); else the `cetpId` value, `capitalize`. `page.tsx:52‑57` |
| 3 | `consentNumber` | **Consent No.** | `consentNumber` in `font-mono text-xs` muted. `page.tsx:62` |
| 4 | `permittedKLD` | **Permitted KLD** | `formatNumber(permittedKLD)`, `font-mono`. `page.tsx:67` |
| 5 | `complianceScore` | **Compliance** | A 14px‑wide track (`w-14`) with an inner bar `width: {score}%` and `background = STATUS_COLOR[complianceStatus(score)]`, followed by `{score}%` text in the same color. `page.tsx:72‑82` |
| 6 | `status` | **Status** | `<StatusBadge status={status} />`. `page.tsx:88` |
| 7 | `actions` (id) | *(empty)* | Ghost icon `Button` with an `Eye` icon; `onClick={() => setSelected(row.original)}` opens the detail dialog. `page.tsx:93‑97` |

**DataTable behavior** (from `data-table.tsx`): a global search input (top‑left, `Search` icon), sortable column headers (each accessor column renders an `ArrowUpDown` toggle via `getToggleSortingHandler`), client pagination at `pageSize = 8` (default, not overridden here), an `emptyMessage="No results."` row, and a pager that appears only when `getPageCount() > 1` (`data-table.tsx:124`). The whole table scrolls horizontally inside `overflow-x-auto` (`data-table.tsx:75`).

### 4. `IndustryDialog` (page.tsx:146, defined 160‑220)

A modal (shadcn `Dialog`) that is **always mounted** but only open when `selected !== null` (`open={!!industry}`). Closing (`onOpenChange`) clears `selected`. Content is a `max-w-lg` panel with:

- **Title** — `industry.name` (`page.tsx:167`).
- **Left identity column** (`page.tsx:170‑182`): "Owner" label + `ownerName`, then three icon rows — `Phone` → `mobile`, `Mail` → `email`, `FileText` → `consentNumber`.
- **Right score badge** (`page.tsx:183‑188`): the `complianceScore%` in a large `font-display` numeral, colored by `STATUS_COLOR[complianceStatus(...)]`, under a small "compliance" caption.
- **Capacity/metadata grid** (`page.tsx:190‑204`) — a 3‑column grid of six tiles:
  | Tile label | Value |
  |---|---|
  | Permitted | `${formatNumber(permittedKLD)} KLD` |
  | ETP | `${formatNumber(etpCapacity)} KLD` |
  | RO | `${formatNumber(roCapacity)} KLD` |
  | MEE | `${formatNumber(meeCapacity)} KLD` |
  | Mapping | `isIndividualETP ? "Individual ETP" : (cetpId ?? "—")` |
  | Alerts | `String(alertsCount)` |
- **Last reading** row (`page.tsx:205‑208`): `formatDate(industry.lastReadingAt, true)` — date **with time** (`—` when null).
- **Footer** (`page.tsx:209‑214`): a `StatusBadge` for `status` on the left, and a **"View ETP data"** button linking to `/dashboard/etp` on the right.

---

## Forms & validation (the `/register` subpage)

The listing page has no form; the **Register Member** CTA leads to `app/dashboard/industries/register/page.tsx` (component `RegisterMemberPage`). Documented here because it is the write path for the registry and shares the admin gate.

### Zod schema (`register/page.tsx:15‑26`)

```ts
const schema = z.object({
  name:          z.string().min(2, "Company name is required"),
  ownerName:     z.string().min(2, "Owner name is required"),
  area:          z.string().min(2, "Area is required"),
  mobile:        z.string().min(8, "Valid mobile required"),
  email:         z.string().regex(/^\S+@\S+\.\S+$/, "Valid email required"),
  consentNumber: z.string().min(4, "Consent number required"),
  permittedKLD:  z.coerce.number().positive("Must be > 0"),
  etpCapacity:   z.coerce.number().positive("Must be > 0"),
  roCapacity:    z.coerce.number().nonnegative(),
  meeCapacity:   z.coerce.number().nonnegative(),
});
type FormValues = z.input<typeof schema>;   // pre-coercion (string inputs)
```

Form is wired with `react-hook-form` + `zodResolver(schema)` (`register/page.tsx:34‑41`).

### Fields

| Field | Zod rule | Error message | Notes |
|---|---|---|---|
| `name` | `string().min(2)` | "Company name is required" | Company Details section |
| `ownerName` | `string().min(2)` | "Owner name is required" | Also copied to `contactPerson` on create |
| `area` | `string().min(2)` | "Area is required" | Location / industrial phase |
| `consentNumber` | `string().min(4)` | "Consent number required" | e.g. `RPCB/CTO/2024/XXXXX` |
| `mobile` | `string().min(8)` | "Valid mobile required" | |
| `email` | `regex(/^\S+@\S+\.\S+$/)` | "Valid email required" | |
| `permittedKLD` | `coerce.number().positive()` | "Must be > 0" | `type="number"` input; Capacity (KLD) section |
| `etpCapacity` | `coerce.number().positive()` | "Must be > 0" | `type="number"` |
| `roCapacity` | `coerce.number().nonnegative()` | *(default zod)* | `type="number"`, 0 allowed |
| `meeCapacity` | `coerce.number().nonnegative()` | *(default zod)* | `type="number"`, 0 allowed |

- Errors render beneath each field via the local `Field` component (`register/page.tsx:172‑180`) in `text-red-400`.
- The number inputs are plain `type="number"`; there is no additional keystroke filtering — `z.coerce.number()` turns the string value into a number at parse time.
- **Registration Type is fixed to "Individual ETP"** — there is no CETP option in the UI (`register/page.tsx:146‑150`); `cetpId` is hard‑coded to `null` on submit.

---

## Key flows & logic

### A. Open a unit's detail dialog

1. Admin clicks the row's `Eye` button → `setSelected(row.original)` (`page.tsx:94`).
2. `<IndustryDialog industry={selected} …/>` opens because `open={!!industry}` becomes true.
3. Closing the dialog (`onOpenChange(false)`) calls `onClose` → `setSelected(null)` (`page.tsx:146,162`).
4. "View ETP data" navigates to `/dashboard/etp` (the ETP Units monitoring list — **not** filtered to this unit).

### B. Register a new member (write path)

`onSubmit` in `register/page.tsx:43‑60`:

```ts
const onSubmit = handleSubmit((values) => {
  const parsed = schema.parse(values);              // re-parse → coerced numbers
  const created = registerIndustry({
    name, ownerName, area, mobile, email, consentNumber,
    permittedKLD, etpCapacity, roCapacity, meeCapacity,
    cetpId: null,                                    // always Individual ETP
  });
  toast.success("Member registered", { description: `${created.name} added with status "pending".` });
  setDone({ name: created.name, id: created.id });
});
```

`registerIndustry` (`lib/store/data.ts:378‑431`) then:

1. Derives the next id from the **highest existing** `IND-###` number (not array length), so ids never collide after a Firestore merge (`data.ts:381‑385`).
2. Creates the `Industry` with `status: "pending"`, `complianceScore: 75`, `isIndividualETP: (cetpId === null)` → **always true** here, `contactPerson = ownerName`, `lastReadingAt: null`, `alertsCount: 0`, `registeredAt = new Date().toISOString().slice(0,10)` (`data.ts:387‑413`).
3. Prepends the new unit to `industries` and seeds a matching `compliance` record (score 75, `submissionRate: 0`, a flat 6‑month trend) (`data.ts:414‑429`).
4. Returns the created `Industry`.

The set() triggers the persist middleware → `firestoreStorage` shards the write per tenant. On the registry page this new unit appears at the top of the table and increments the **Pending** chip.

**Success screen** (`register/page.tsx:62‑92`): an animated check, "Registration submitted", the created id, and two buttons — **View industries** (`Link` back to `/dashboard/industries`) and **Register another** (`reset()` the form + clear `done`).

---

## Units & formatting (KLD vs m³)

This page deals **only in capacities**, which are expressed in **KLD** (kilolitres per day) — there is no water‑balance *volume* on this surface, so the `KL → m³` display conversion (`displayUnit` in `lib/utils.ts:17`) is **not** used here.

- `permittedKLD` column header literally says "Permitted **KLD**"; the value is `formatNumber(...)` only (no unit suffix in the cell) — `page.tsx:65‑67`.
- The dialog's capacity tiles append the unit explicitly: `` `${formatNumber(...)} KLD` `` for Permitted / ETP / RO / MEE (`page.tsx:192‑195`).
- `formatNumber` (`lib/utils.ts:8‑10`) uses the `en-IN` locale (Indian digit grouping).
- `formatDate(lastReadingAt, true)` (`lib/utils.ts:23‑33`) renders `dd MMM yyyy, HH:mm` in `en-IN`, or `—` for null.

The `m³` display convention applies to ETP water‑balance entries elsewhere (e.g. the ETP Units / entry pages), not to this registry.

---

## Edge cases & gotchas

- **The status chips do not filter.** They are read‑only counters. `filtered` is `useMemo(() => industries, [industries])` (`page.tsx:26`), so the table always shows every unit regardless of chip or pill state.
- **The filter pills are effectively inert.** `FILTERS` has a single `"all"` entry (`page.tsx:17‑19`); clicking sets `filter` state that is never read to narrow the data.
- **`area` is searchable‑by‑placeholder but not by column.** The search box placeholder says "Search company, area, consent…", but the DataTable's global filter only matches **accessor** columns (`name`, `cetpId`, `consentNumber`, `permittedKLD`, `complianceScore`, `status`). `area` is rendered inside the Company cell without its own accessor, so typing an area name will **not** match. Company name and consent number do match.
- **Every self‑registered unit is "Individual ETP".** `registerIndustry` is always called with `cetpId: null` from the form, so `isIndividualETP` is always true → the violet Mapping chip. Only seed data can carry a non‑null `cetpId` (rendered capitalised).
- **Status vs. compliance are independent.** `IndustryStatus` (`active | pending | suspended | non-reporting`, `lib/types.ts:32‑36`) drives the Status chip/badge; the compliance bar is derived separately from `complianceScore` via `complianceStatus()` thresholds (`≥85` compliant/green, `≥70` warning/amber, else non‑compliant/red — `constants.ts:116‑131`). A unit can be `active` yet show a red compliance bar, or `pending` (new registration, score 75) yet show amber.
- **New registrations land in "pending".** Fresh units get `complianceScore: 75` (amber bar) and `status: "pending"` — they count toward the **Pending** chip until an admin acts elsewhere (Approvals/Compliance).
- **"View ETP data" is not deep‑linked.** The dialog footer button always goes to `/dashboard/etp` (the whole ETP Units list), not a per‑unit view.
- **No page‑level guard.** Security depends entirely on `DashboardShell`'s redirect + Firestore rules. An `etp` operator is redirected to `/dashboard` before render; independently, their hydrated store only contains their own shard, so even the data isn't present.
- **Pager is hidden with the default seed.** `pageSize` defaults to 8 and the shipped seed has few units, so `getPageCount() > 1` is false and the pager doesn't show (`data-table.tsx:124`).
- **`address` isn't collected by the form.** `Industry.address` exists in the type and `RegisterInput`, but the `/register` form doesn't include an address field, so registered units have `address` undefined; it isn't surfaced on this page anyway.

---

## Related files

| File | Role |
|---|---|
| `app/dashboard/industries/page.tsx` | This page — `IndustriesPage`, `Chip`, `IndustryDialog`. |
| `app/dashboard/industries/register/page.tsx` | Register Member form (`RegisterMemberPage`) + zod schema. |
| `app/dashboard/layout.tsx` | Wraps the route in `DashboardShell`. |
| `components/dashboard/dashboard-shell.tsx` | Auth/role redirect gate (`canAccessPath`). |
| `components/dashboard/page-header.tsx` | `PageHeader` (eyebrow/title/description/actions). |
| `components/dashboard/data-table.tsx` | `DataTable` — search, sort, pagination. |
| `components/shared/status-badge.tsx` | `StatusBadge` — status → tone mapping. |
| `components/shared/store-hydrator.tsx` | Per‑tenant Firestore hydration of `industries` (regulator loads all). |
| `lib/store/data.ts` | Zustand data store — `industries` array + `registerIndustry` action. |
| `lib/store/auth.ts` | Auth store — `role`, `authReady`, `industryId`. |
| `lib/constants.ts` | `ADMIN_ONLY_PATHS`, `canAccessPath`, `DASHBOARD_NAV`, `complianceStatus`, `STATUS_COLOR`, `COMPLIANCE`. |
| `lib/utils.ts` | `formatNumber`, `formatDate`, `displayUnit`, `cn`. |
| `lib/types.ts` | `Industry`, `IndustryStatus`, `CetpId` domain types. |
| `firestore.rules` | Server‑side per‑tenant isolation (the real security boundary). |
