# `/dashboard/etp-entry` — ETP Data Entry (Daily Water-Balance)

> Route: `/dashboard/etp-entry` · File: `app/dashboard/etp-entry/page.tsx` · Roles: **`etp` operators only** · Rendered by: `DashboardShell` (`app/dashboard/layout.tsx` → `components/dashboard/dashboard-shell.tsx`), page component `EtpEntryPage` (default export)

---

## Purpose

The daily **water-balance logbook** for a single ETP (Effluent Treatment Plant) operator. An `etp`-role user records one day's flows across eight meter points; the app auto-derives **Total Water Intake**, runs three client-side validation gates, predicts which alerts the entry will raise, and — on submit — writes an `EtpEntry` + an `Approval` (for the Monitoring Body to verify) + any fired `Alert`s into the per-tenant store.

It is the only data-entry surface an ETP operator has. The Monitoring Body (`monitoring-admin`) never sees this page (see gating below); it only ever consumes the resulting entries/approvals/alerts.

Key page-level behaviors (all in `app/dashboard/etp-entry/page.tsx`):

- **Date is locked to "today"** — no picker; set client-side after mount (`page.tsx:76-81`).
- **Total Water Intake auto-calculates** as `freshWaterConsumption + etpReuse + roPermeate` (`page.tsx:87`) — note it is **not** the sum of all eight fields.
- **ETP Inlet ≤ sanctioned ETP capacity** — a breach blocks the entry, fires a standalone alert to the Monitoring Body, and freezes the other fields read-only (`page.tsx:89-125`).
- **Every downstream flow must be strictly less than Fresh Water Consumption** — per-field error + banner + submit block (`page.tsx:94-109`).

---

## Access & gating

The route lives under `app/dashboard/`, so it inherits the dashboard layout and its role gate.

**1. Layout wrapper** — `app/dashboard/layout.tsx` wraps every dashboard route in `theme-dash` and `<DashboardShell>`:

```tsx
// app/dashboard/layout.tsx
<div className="theme-dash">
  <DashboardShell>{children}</DashboardShell>
</div>
```

**2. Auth + role gate** — `DashboardShell` (`components/dashboard/dashboard-shell.tsx:21-31`) runs an effect on every navigation:

```tsx
if (!authReady) return;                       // wait for Firebase's first auth report
if (!role) { router.replace("/login"); ... }  // unauthenticated → /login
if (!canAccessPath(role, pathname)) {
  router.replace("/dashboard");                // wrong role → bounce to overview
}
```

While `!authReady || !role`, the shell renders a full-screen "Loading command center…" splash instead of the page (`dashboard-shell.tsx:33-43`).

**3. `canAccessPath`** — the authoritative role→path check (`lib/constants.ts:65-72`):

```ts
export const ETP_ONLY_PATHS = ["/dashboard/etp-entry"];
export function canAccessPath(role, pathname) {
  const matches = (p) => pathname === p || pathname.startsWith(p + "/");
  const inAdmin = ADMIN_ONLY_PATHS.some(matches);
  const inEtp = ETP_ONLY_PATHS.some(matches);
  if (role === "monitoring-admin") return !inEtp; // admin CANNOT enter etp-entry
  return !inAdmin;                                 // etp CAN (etp-entry ∉ ADMIN_ONLY_PATHS)
}
```

| Role | Can visit `/dashboard/etp-entry`? | Reason |
|------|-----------------------------------|--------|
| `etp` | ✅ Yes | Path is in `ETP_ONLY_PATHS`, not in `ADMIN_ONLY_PATHS`; etp branch returns `!inAdmin` = `true`. |
| `monitoring-admin` | ❌ No → redirected to `/dashboard` | Path is in `ETP_ONLY_PATHS`; admin branch returns `!inEtp` = `false`. |

> The `matches` helper is **segment-aware** on purpose: it uses `startsWith(p + "/")`, so the admin path `/dashboard/etp` (ETP Units list) does **not** swallow `/dashboard/etp-entry`. This prevents an ETP operator's entry route from being mistaken for the admin ETP-units route.

**4. Nav entry** — the sidebar item is registered ETP-only (`lib/constants.ts:46`):

```ts
{ label: "ETP Data Entry", href: "/dashboard/etp-entry", icon: "ClipboardCheck", group: "Overview", roles: ETP },
```

**5. Data scoping** — an ETP operator's `industryId` comes from `users/{uid}.industryId`, restored by `StoreHydrator` and stored in the auth store. For the `etp` role the hydrator loads **only that one unit** via `loadOneIndustry(industryId)` + `subscribeOne(...)` (`components/shared/store-hydrator.tsx:111-118`), so the `industries` array on this page holds a single element — the operator's own unit. Tenant isolation is enforced by `firestore.rules`.

**6. Inline "no unit" guard** — beyond the shell gate, the page itself defends against a missing unit. If `industry` cannot be resolved from `industryId` (e.g. authenticated but mid-self-registration, or `industryId` is `null`), it renders a fallback instead of the form (`page.tsx:155-162`):

> "No ETP unit linked to this session" + a link to `/login` — "Sign in or register your unit".

---

## Data — store reads & writes

### Reads

| Source | Selector | Line |
|--------|----------|------|
| `useAuthStore` | `(s) => s.industryId` | `page.tsx:45` |
| `useDataStore` | `(s) => s.industries` | `page.tsx:46` |
| `useDataStore` | `(s) => s.submitEtpEntry` | `page.tsx:47` |
| `useDataStore` | `(s) => s.raiseEtpInletAlert` | `page.tsx:48` |
| derived | `industry = industries.find((i) => i.id === industryId)` | `page.tsx:49` |

From `industry` the page reads `industry.name`, `industry.etpCapacity` (`page.tsx:90`), and `industry.permittedKLD` (`page.tsx:129-130`, `244`).

### Writes / actions

Both actions live in `lib/store/data.ts` and mutate the persisted Zustand store; the persistence middleware (`lib/data/firestore-storage.ts`) shards the write into the operator's own `industries/{industryId}` Firestore document.

| Action | Signature | Effect |
|--------|-----------|--------|
| `submitEtpEntry` | `(input: EtpEntryInput) => { entry: EtpEntry; alerts: AlertType[] }` | Prepends an `EtpEntry`, an `Approval`, and any fired `Alert`s; bumps the unit's `lastReadingAt` + `alertsCount`. (`data.ts:214-291`) |
| `raiseEtpInletAlert` | `(industryId: string, etpInlet: number) => void` | Prepends **one standalone** `capacity-exceeded` `Alert`; bumps `alertsCount` by 1. No entry, no approval. (`data.ts:296-319`) |

`EtpEntryInput` (`lib/store/data.ts:61-72`) is: `industryId`, `date`, and the eight numeric fields (`freshWaterConsumption`, `etpInlet`, `etpOutlet`, `etpReuse`, `roInlet`, `roReject`, `roPermeate`, `sludgeToTSDF`).

---

## Layout & sections

The page is a two-column CSS grid inside a single `<form>`: `lg:grid-cols-[1.55fr_1fr]` (`page.tsx:172`). Left = the input card; right = a sticky summary/submit rail.

### `PageHeader` (`page.tsx:166-170`)
- **eyebrow:** `` `${industry.name} · ETP Logbook` ``
- **title:** "ETP Water-Balance Entry"
- **description:** "Record today's water balance. All values are in cubic metres (m³). Total Water Intake is auto-calculated and sent for verification."

### Left card — "Daily Water Balance (m³)" (`page.tsx:173-233`)
Rendered in this order:

1. **`SectionTitle`** with a `Droplets` icon (`page.tsx:174`).
2. **Date (today · locked)** field (`page.tsx:176-185`) — a read-only chip showing a `Lock` icon, `formatDate(today)` (or `"…"` before mount), and a "Today" pill. The actual value is submitted via a **hidden input** `{...register("date")}`.
3. A blank spacer cell (`hidden sm:block`, `page.tsx:186`) to keep the date on its own row of the 2-column grid.
4. **The eight flow fields**, mapped from the `FIELDS` array (`page.tsx:187-222`). `etpInlet` is special-cased (capacity label + max + read-only propagation); the other seven share a common branch. See *Forms & validation*.
5. **Total Water Intake (m³ · auto)** field (`page.tsx:223-228`) — a read-only chip with a `Calculator` icon showing `formatNumber(totalWaterIntake) m³`.
6. **Helper caption** (`page.tsx:230-232`): "Total Water Intake = Fresh Water Consumption + ETP Reuse + RO Permeate. This field is non-editable."

### Right column — sticky summary rail (`page.tsx:236-300`)
A `sticky top-20` card plus a success panel below it.

1. **Total Water Intake headline** (`page.tsx:238-245`): big mono `formatNumber(totalWaterIntake) m³`, a breakdown line `Fresh {fresh} + Reuse {reuse} + Permeate {permeate} m³`, and `Permitted: {industry.permittedKLD} KLD`.
2. **"Alerts on submit" panel** (`page.tsx:247-277`) — four **mutually exclusive** states, in priority order:
   | Priority | Condition | Render |
   |----------|-----------|--------|
   | 1 | `etpInletExceeded` | Red `Ban` banner: "Entry blocked. ETP Inlet {val} m³ exceeds the sanctioned ETP capacity ({etpCapacity} KLD)…" |
   | 2 | `freshViolated` | Red `Ban` banner: "Check your values. Every field must be less than Fresh Water Consumption ({fresh} m³)." |
   | 3 | `predicted.length === 0` | Green `Check`: "No alerts — clean entry" |
   | 4 | else | List of predicted alert chips, colored via `ALERT_META[t].color` with a `TriangleAlert` icon |
3. **Submit button** (`page.tsx:279-282`): `disabled={isSubmitting || etpInletExceeded || freshViolated}`. Its label reflects the blocking reason — "Blocked — over capacity" / "Values must be under Fresh Water" / "Submitting…" / "Submit Water Balance".
4. **Success panel** (`page.tsx:285-299`) — a Framer-Motion `AnimatePresence` card shown after a successful submit: "Submitted for verification", the recorded total, and (if any) "{n} alert(s) raised."

---

## Forms & validation

### The Zod schema (`page.tsx:19-29`)

```ts
const schema = z.object({
  date: z.string().min(1, "Date required"),
  freshWaterConsumption: z.coerce.number().nonnegative("Must be ≥ 0"),
  etpInlet:              z.coerce.number().nonnegative("Must be ≥ 0"),
  etpOutlet:             z.coerce.number().nonnegative("Must be ≥ 0"),
  etpReuse:              z.coerce.number().nonnegative("Must be ≥ 0"),
  roInlet:               z.coerce.number().nonnegative("Must be ≥ 0"),
  roReject:              z.coerce.number().nonnegative("Must be ≥ 0"),
  roPermeate:            z.coerce.number().nonnegative("Must be ≥ 0"),
  sludgeToTSDF:          z.coerce.number().nonnegative("Must be ≥ 0"),
});
type FormValues = z.input<typeof schema>;
```

`z.coerce.number()` converts the string inputs to numbers; `.nonnegative()` rejects negatives with "Must be ≥ 0". Wired via `zodResolver(schema)` in `useForm`, with all numeric `defaultValues` at `0` and `date: ""` (`page.tsx:53-72`).

### The eight fields (`FIELDS`, `page.tsx:33-42`)

| # | `name` | Label | Zod rule | Feeds Total? | Special UI |
|---|--------|-------|----------|:---:|-----------|
| 1 | `freshWaterConsumption` | Fresh Water Consumption | `number ≥ 0` | ✅ | The reference value all others must stay below |
| 2 | `etpInlet` | ETP Inlet | `number ≥ 0` | ❌ | `max={etpCapacity}`; capacity check; `onBlur` alert; label suffix `· max {etpCapacity} KLD` |
| 3 | `etpOutlet` | ETP Outlet | `number ≥ 0` | ❌ | goes read-only when ETP Inlet exceeds capacity |
| 4 | `etpReuse` | ETP Reuse | `number ≥ 0` | ✅ | ″ |
| 5 | `roInlet` | RO Inlet | `number ≥ 0` | ❌ | ″ |
| 6 | `roReject` | RO Reject | `number ≥ 0` | ❌ | ″ |
| 7 | `roPermeate` | RO Permeate | `number ≥ 0` | ✅ | ″ |
| 8 | `sludgeToTSDF` | Sludge sent to TSDF | `number ≥ 0` | ❌ | ″ |

All eight render as `<input type="number" step="any" …>` with placeholder `0`. Each is wrapped in the local `Field` component (`page.tsx:309-317`) which renders a label, the input, and an optional red error line.

### Three independent validation layers

1. **Zod** (`errors[f.name]?.message`) — negativity / non-numeric.
2. **ETP capacity** (`etpInletExceeded`) — applies to `etpInlet` only.
3. **"Less than Fresh"** (`exceedsFresh` / `freshViolated`) — applies to the seven downstream fields.

**Error precedence per field:**
- `etpInlet` (`page.tsx:196`): `errors.etpInlet?.message ?? (etpInletExceeded ? "Exceeds sanctioned ETP capacity (…KLD). You cannot proceed — the Monitoring Body has been notified." : freshErr)`
- every other field (`page.tsx:210`): `errors[f.name]?.message ?? freshErr`, where `freshErr` = "Must be less than Fresh Water Consumption ({fresh} m³)".

**Visual error state:** violating inputs get `border-red-500/70 bg-red-500/5 focus:border-red-500` and `aria-invalid` set (`page.tsx:204-206`, `216-218`). When `etpInletExceeded`, the seven non-inlet inputs additionally get `readOnly` + `cursor-not-allowed opacity-60` (`page.tsx:215-216`).

### `exceedsFresh` — the "strictly less than Fresh" rule (`page.tsx:94-109`)

```ts
const DOWNSTREAM_FIELDS = ["etpInlet","etpOutlet","etpReuse","roInlet","roReject","roPermeate","sludgeToTSDF"];
const exceedsFresh = (name) => {
  const v = Number(formValues[name]) || 0;
  return v > 0 && v >= fresh;     // zero/empty ignored; note >= (equal also violates)
};
const freshViolated = DOWNSTREAM_FIELDS.some(exceedsFresh);
```

- **Zero-ignored:** a field of `0`/empty never flags (`v > 0` guard), so the pristine all-zero form is not error-flagged.
- **`>=`, not `>`:** a field *equal* to Fresh Water Consumption is a violation — the requirement is *strictly less than* Fresh.
- `freshWaterConsumption` itself is excluded (it is not in `DOWNSTREAM_FIELDS`, and the per-field `freshErr` guard at `page.tsx:188` skips `f.name === "freshWaterConsumption"`).

---

## Key flows & logic

### A. Locking the date to today (`page.tsx:74-81`)
A `useEffect` (post-mount, so hydration-safe) builds the local calendar date from `Date` parts — `${year}-${MM}-${DD}` — then `setToday(d)` (for display) and `setValue("date", d)` (for the hidden registered input). Built from **local** parts, not UTC, so it reflects the operator's own calendar day. Before the effect runs, `today === ""` and the chip shows `"…"`.

### B. Live derived values via `watch()` (`page.tsx:83-92`)
```ts
const formValues = watch();
const fresh     = Number(formValues.freshWaterConsumption) || 0;
const reuse     = Number(formValues.etpReuse) || 0;
const permeate  = Number(formValues.roPermeate) || 0;
const totalWaterIntake = fresh + reuse + permeate;         // page.tsx:87
const etpCapacity  = industry?.etpCapacity ?? 0;
const etpInletVal  = Number(formValues.etpInlet) || 0;
const etpInletExceeded = !!industry && etpInletVal > etpCapacity;
```

### C. ETP-Inlet-over-capacity flow (`page.tsx:111-125`)
- A `useRef` `alertedRef` guards against duplicate alerts. It resets to `false` whenever `etpInletExceeded` becomes `false` (`page.tsx:113-115`) — so correcting the value re-arms the alert for the next breach.
- `handleEtpInletBlur` fires **on blur** of the ETP Inlet input. If exceeded, `industryId` present, and not already alerted, it: sets `alertedRef.current = true`, calls `raiseEtpInletAlert(industryId, etpInletVal)`, and shows `toast.warning("ETP Inlet exceeds capacity", { description: "Entry blocked — the Monitoring Body has been notified." })`.
- While exceeded: the seven other fields go read-only, the "Alerts on submit" panel shows the red block banner, and the submit button is disabled.

### D. Predicted alerts (`page.tsx:127-130`)
A preview of what `submitEtpEntry` will fire, computed from the current total:
```ts
const predicted = [];
if (totalWaterIntake === 0) predicted.push("zero-reading");
if (industry && totalWaterIntake > industry.permittedKLD) predicted.push("capacity-exceeded");
else if (industry && totalWaterIntake > industry.permittedKLD * 0.85) predicted.push("high-flow");
```
This mirrors the store logic exactly (`data.ts:240-242`), so the preview matches what actually gets recorded.

### E. `onSubmit` pipeline (`page.tsx:132-153`)
`onSubmit = handleSubmit((values) => { … })` — so RHF/Zod validation runs first; the callback only runs on a schema-valid form. Inside:

1. `if (!industryId) return;` — no unit bound.
2. `if (etpInletExceeded) return;` — ETP Inlet over capacity.
3. `if (freshViolated) return;` — some downstream field ≥ Fresh.
4. `const v = schema.parse(values);` — re-parse to coerced numbers (defensive; guarantees typed numbers into the store).
5. `const { entry, alerts } = submitEtpEntry({ industryId, date: v.date, …the 8 fields });`
6. `toast.success("Water-balance entry submitted", { description: \`Total intake ${formatNumber(entry.totalWaterIntake)} m³ · sent for verification${alerts.length ? ` · ${alerts.length} alert(s)` : ""}.\` });`
7. `setSuccess({ total: entry.totalWaterIntake, alerts });` — reveals the success panel.

> The form fields are **not reset** after submit; the success panel appears but the entered values remain.

### F. What `submitEtpEntry` does in the store (`lib/store/data.ts:214-291`)
Given the input it produces **three** artifacts and updates the unit:

1. **The `EtpEntry`** (`data.ts:220-237`):
   - `id: \`E-${Date.now().toString(36).toUpperCase()}\``
   - `totalWaterIntake = freshWaterConsumption + etpReuse + roPermeate` (`data.ts:216`)
   - `unit: "KL"`, `status: "pending"`, `submittedAt: new Date().toISOString()`
   - `industryName` resolved from the unit (`ind?.name ?? "Unknown"`).
2. **Fired alerts** (`data.ts:239-256`) — same rule as the preview:
   - `zero-reading` if `totalWaterIntake === 0`
   - `capacity-exceeded` if `totalWaterIntake > permittedKLD`, **else** `high-flow` if `> permittedKLD * 0.85`
   - Each becomes an `Alert` with `severity` from `ALERT_META`, `cetpId: null`, message `"{label} on ETP water-balance for {unit}."`, `status: "active"`, `relatedReadingId: id`.
3. **The `Approval`** (`data.ts:258-279`):
   - `readingId: entry.id`, `meterPoint: "ETP Water Balance"`, `difference: totalWaterIntake`, `unit: "KL"`, `hasPhoto: true`, `remarks: "Daily ETP water-balance entry."`, `stage: "submitted"`, `alerts: fired`.
   - A 3-step `timeline`: **Submitted** (done, `by: ind?.contactPerson ?? "Operator"`) → **Under Verification** (pending) → **Approved** (pending).
4. **State update** (`data.ts:281-288`): prepend `entry` to `etpEntries`, `approval` to `approvals`, `newAlerts` to `alerts`; on the unit, set `lastReadingAt: submittedAt` and `alertsCount += fired.length`.
5. Returns `{ entry, alerts: fired }`.

The Monitoring Body later acts on this via `decideApproval` (`data.ts:321-376`), which flips both the matching `Approval.stage` and the `EtpEntry.status` to `approved`/`rejected` (and, on reject, raises a `rejected-entry` alert).

### G. What `raiseEtpInletAlert` does in the store (`lib/store/data.ts:296-319`)
This is separate from submission — it fires from the field `onBlur` while the entry is *blocked*, so the regulator is notified even though no entry/approval is created:
- Builds one `Alert`: `id: \`AL-${Date.now().toString(36)}-INLET\``, `type: "capacity-exceeded"`, `severity` from `ALERT_META`, `cetpId: null`, `relatedReadingId: null`, message `"ETP Inlet {etpInlet} m³ exceeds sanctioned ETP capacity {ind.etpCapacity} KLD for {ind.name}."`
- Prepends it to `alerts` and increments the unit's `alertsCount` by 1. No entry, no approval.

---

## Units & formatting

- **Form values are entered and displayed in m³.** The card title, every field label, the Total chip, and the summary rail all suffix `m³`. The page hardcodes the `m³` labels rather than calling `displayUnit()`.
- **Stored unit is `"KL"`.** The `EtpEntry.unit` field is the literal `"KL"` (`data.ts:234`, `lib/types.ts:96`). The KL→m³ mapping is the app-wide convention `displayUnit(u) = u === "KL" ? "m³" : u` (`lib/utils.ts:17`); this page bakes that in directly.
- **Capacity is expressed in KLD.** `industry.etpCapacity` and `industry.permittedKLD` are shown/labeled as `KLD` — e.g. the ETP Inlet label suffix `· max {etpCapacity} KLD` (`page.tsx:195`) and the summary rail's `Permitted: {permittedKLD} KLD` (`page.tsx:244`).
- **Number formatting:** `formatNumber` uses the `en-IN` locale (`lib/utils.ts:8-10`); `formatDate` renders the locked date as `dd Mon yyyy` (`lib/utils.ts:23-33`).

> ⚠️ **Unit-mismatch note:** the ETP-Inlet check compares an entered **m³ volume** (`etpInletVal`) directly against a **KLD rate** (`etpCapacity`) with `>` (`page.tsx:92`). Numerically they're treated as comparable; the label/alert text carries the `KLD` vs `m³` distinction but no conversion is applied.

---

## Edge cases & gotchas

- **Total ≠ sum of all eight.** Only Fresh + ETP Reuse + RO Permeate feed `totalWaterIntake` (`page.tsx:87`, `data.ts:216`). ETP Inlet/Outlet, RO Inlet/Reject, and Sludge do **not** contribute — by design (intake vs. internal flows).
- **All-zero entry is submittable.** With every field `0`: `etpInletExceeded` is false (0 not `> capacity`), `freshViolated` is false (zero-ignored), so the submit passes — but the total is `0`, so `submitEtpEntry` fires a **`zero-reading`** alert. The predicted panel warns of this beforehand.
- **`Fresh = 0` makes any positive downstream field a violation.** `exceedsFresh` returns `v > 0 && v >= 0` → true for any positive `v`, so you cannot enter downstream flows until Fresh is raised above them. Set Fresh first.
- **Equality counts as a violation.** Because the test is `v >= fresh`, a downstream field exactly equal to Fresh blocks submission — values must be *strictly* less.
- **Inlet breach freezes the whole form (except Inlet).** When `etpInletExceeded`, the other seven inputs become `readOnly` (`page.tsx:215`); the operator must reduce ETP Inlet before editing anything else.
- **The capacity alert fires on blur, once per breach.** It is not raised per keystroke, and `alertedRef` de-dupes within a single breach; correcting the value re-arms it (`page.tsx:113-115`, `117-125`). The alert is persisted to the operator's own unit doc and surfaces to the Monitoring Body through its all-industries subscription.
- **No per-day dedup.** Nothing prevents multiple submissions for the same locked date; each creates a new `EtpEntry`/`Approval` with a fresh id. `dailyIntake()` (`data.ts:467-471`) resolves "today" with `.find` (first match = most recently prepended), so a re-submit effectively supersedes earlier ones in that view but leaves duplicates in the arrays.
- **Form is not reset after submit.** Values persist post-submit; the success panel is additive, so an accidental second click would create a duplicate entry.
- **Admin can't reach this page.** A `monitoring-admin` who navigates here is redirected to `/dashboard` by the shell gate (see Access & gating).
- **Missing unit → fallback screen, not a crash.** If `industry` can't be resolved, the page short-circuits to the "No ETP unit linked to this session" view (`page.tsx:155-162`) before rendering any form.
- **`schema.parse` runs twice.** Once via the resolver, once inside `onSubmit` (`page.tsx:136`) — the second call is defensive and guarantees coerced numbers reach `submitEtpEntry`.

---

## Related files

| File | Role |
|------|------|
| `app/dashboard/etp-entry/page.tsx` | This page — form, validation gates, submit pipeline |
| `app/dashboard/layout.tsx` | Wraps the route in `theme-dash` + `DashboardShell` |
| `components/dashboard/dashboard-shell.tsx` | Auth/role redirect gate (`canAccessPath`) + loading splash |
| `components/dashboard/page-header.tsx` | `PageHeader` (eyebrow/title/description) |
| `lib/store/data.ts` | `submitEtpEntry` (`214-291`), `raiseEtpInletAlert` (`296-319`), `decideApproval` (`321-376`) |
| `lib/store/auth.ts` | `industryId` / session (set from `users/{uid}`) |
| `lib/constants.ts` | `canAccessPath`, `ETP_ONLY_PATHS`, `DASHBOARD_NAV`, `ALERT_META` |
| `lib/types.ts` | `EtpEntry`, `Alert`, `AlertType`, `Approval`, `Industry` |
| `lib/utils.ts` | `formatNumber`, `formatDate`, `displayUnit` |
| `components/shared/store-hydrator.tsx` | Per-tenant data scoping (`loadOneIndustry`/`subscribeOne` for `etp`) |
| `lib/data/firestore-storage.ts` | Sharded persistence — writes land in `industries/{industryId}` |
| `firestore.rules` | The tenant-isolation security boundary |
