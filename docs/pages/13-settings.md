# `/dashboard/settings` — Settings

> Route: `/dashboard/settings` · File: `app/dashboard/settings/page.tsx` · Roles: **both** (`monitoring-admin` and `etp`) — URL-reachable only · Rendered by: `SettingsPage` (default export, `app/dashboard/settings/page.tsx:32`) inside `DashboardShell`

---

## Purpose

A lightweight, mostly-demo "control panel" for the signed-in session. It surfaces five cards:

1. **Session & Role** — who you are signed in as, and a link back to `/login` to switch accounts.
2. **Appearance** — two decorative, permanently-disabled theme switches.
3. **Alert Preferences** — four notification toggles that live only in local component state (no persistence, no store write).
4. **Compliance Thresholds** — read-only display of the compliance scoring bands from the `COMPLIANCE` constant.
5. **Data Management** — a destructive **Reset demo data** action (behind a confirm dialog) that calls `resetData()` to restore the original seed dataset.

The header calls it out as a demo surface: `description="Manage your demo session, alert preferences and platform data."` (`app/dashboard/settings/page.tsx:40`).

It is a `"use client"` component (`page.tsx:1`). There is **no server logic, no form submission, and no zod schema** on this page.

---

## Access & gating (auth/redirects; how the role gate applies)

This route is **not listed** in `DASHBOARD_NAV` (`lib/constants.ts:44-52`), and a repo-wide search finds **no `<Link>` or nav entry pointing at `/dashboard/settings`** anywhere in the app. It is therefore reachable **only by typing/opening the URL directly** — there is no button or menu item that navigates here.

Being under `app/dashboard/*`, the page is wrapped by `DashboardLayout` → `DashboardShell` (`app/dashboard/layout.tsx:3-9`). The shell enforces the auth/role gate in a `useEffect` (`components/dashboard/dashboard-shell.tsx:21-31`):

```ts
if (!authReady) return;                         // wait for Firebase's first auth callback
if (!role) { router.replace("/login"); return } // unauthenticated → login
if (!canAccessPath(role, pathname)) {           // wrong role for this path → home
  router.replace("/dashboard");
}
```

While `authReady` is false or `role` is null, the shell renders a full-screen "Loading command center…" splash instead of the page (`dashboard-shell.tsx:33-43`).

**Role gate result for this path** — `canAccessPath` (`lib/constants.ts:65-72`) checks the path against two allow/deny lists:

- `ADMIN_ONLY_PATHS` (`lib/constants.ts:54-61`): `/dashboard/industries`, `/dashboard/etp`, `/dashboard/approvals`, `/dashboard/compliance`, `/dashboard/alerts`, `/dashboard/reports`.
- `ETP_ONLY_PATHS` (`lib/constants.ts:62`): `/dashboard/etp-entry`.

`/dashboard/settings` is in **neither** list. So:

| Role | `inAdmin` | `inEtp` | `canAccessPath` returns | Result |
|------|-----------|---------|-------------------------|--------|
| `monitoring-admin` | false | false | `!inEtp` → **true** | allowed |
| `etp` | false | false | `!inAdmin` → **true** | allowed |

Both roles may open Settings.

---

## Data — store reads & writes (exact selectors/actions)

**Reads:**

| Selector | Source | Line | Use |
|----------|--------|------|-----|
| `useAuthStore((s) => s.role)` | `lib/store/auth.ts` | `page.tsx:33` | drives the Session & Role card |
| `useDataStore((s) => s.resetData)` | `lib/store/data.ts` | `page.tsx:35` | the reset action (only data-store touch on this page) |

Derived from the role, not a store read:

```ts
const roleMeta = ROLES.find((r) => r.id === role) ?? ROLES[0];   // page.tsx:34
```

`ROLES` is the static array in `lib/constants.ts:8-27`. For `monitoring-admin` → `{ name: "Monitoring Body", scope: "Super Admin · Sees Everything", icon: "ShieldCheck", accent: "#6366f1", description: "RSPCB authority…" }`; for `etp` → `{ name: "ETP", scope: "Individual ETP · Water Balance", icon: "Droplets", accent: "#0d9488", description: "An industry running its own Effluent Treatment Plant…" }`. The `?? ROLES[0]` fallback (Monitoring Body) only matters if `role` were null — which the shell prevents, so in practice `roleMeta` is always the real role.

**Writes:**

- The **only** store write is `resetData()`, invoked from the confirm dialog's Reset button (`page.tsx:124`). See [Key flows & logic](#key-flows--logic).
- The four **Alert Preferences** toggles write to **local React state only** (`useState`, `page.tsx:36`) — they do **not** touch `useDataStore` or Firestore.
- The **Appearance** switches are `disabled` and bound to nothing.

Local state:

```ts
const [prefs, setPrefs] = useState<Record<string, boolean>>(
  Object.fromEntries(PREFS.map((p) => [p.key, p.def])),   // page.tsx:36
);
```

`PREFS` (`page.tsx:25-30`) seeds this map: `email:true`, `late:true`, `capacity:true`, `digest:false`.

---

## Layout & sections (in visual order)

Top-level: a `space-y-6` column with a `PageHeader`, then a responsive grid `grid gap-5 lg:grid-cols-2` (`page.tsx:39-42`). Two shared helper components render the chrome:

- **`Card`** (`page.tsx:140-150`) — `rounded-2xl border bg-card p-6` with a `font-display` title row (`icon` + `title`).
- **`Row`** (`page.tsx:152-162`) — a bordered `flex items-center justify-between` row: label + description on the left, an arbitrary control (`children`) on the right.

### 0. Page header
`PageHeader` with `eyebrow="System"`, `title="Settings"`, and the demo description (`page.tsx:40`). Rendered by `components/dashboard/page-header.tsx`.

### 1. Card — "Session & Role" (icon `UserCog`)
`page.tsx:44-58`. Contents:

- A highlighted panel (`rounded-xl border bg-muted/30`) containing:
  - A 12×12 rounded avatar tile whose **background is `roleMeta.accent`** (inline style, `page.tsx:46`) holding `<Icon name={roleMeta.icon} />` (dynamic lucide icon via `components/shared/icon.tsx`; `ShieldCheck` for admin, `Droplets` for etp).
  - `roleMeta.name` (bold) and `roleMeta.scope` (muted) — `page.tsx:50-51`.
  - A **"Switch role"** button — an `asChild` outline `Button` wrapping `<Link href="/login">` (`page.tsx:53-55`). This is a plain navigation to `/login`; it does **not** call `logout()` and does not clear the session.
- Below the panel: `roleMeta.description` in muted text (`page.tsx:57`).

### 2. Card — "Appearance" (icon `Palette`)
`page.tsx:61-68`. Two `Row`s, each with a **`<Switch checked disabled />`** — purely decorative, always-on, non-interactive:

- "Command Center theme" — "Dark, high-contrast monitoring theme (default for dashboards)."
- "Reduced motion" — "Respects your system motion preference automatically."

These toggles have no `onCheckedChange` and no state binding; they change nothing.

### 3. Card — "Alert Preferences" (icon `Bell`)
`page.tsx:71-83`. Maps over `PREFS` (`page.tsx:25-30`) to render one `Row` per preference, each with an interactive `Switch` bound to `prefs[p.key]`:

| `key` | Label | Description | Default (`def`) |
|-------|-------|-------------|-----------------|
| `email` | Email notifications | Send a copy of new alerts to the registered email. | `true` |
| `late` | Late submission alerts | Flag readings recorded outside the 8AM / 8PM window. | `true` |
| `capacity` | Capacity-exceeded alerts | Raise critical alert when flow crosses permitted KLD. | `true` |
| `digest` | Daily digest | A morning summary of compliance and pending items. | `false` |

Toggling calls (`page.tsx:76-79`):

```ts
onCheckedChange={(v) => {
  setPrefs((s) => ({ ...s, [p.key]: v }));
  toast(`${p.label} ${v ? "enabled" : "disabled"}`);
}}
```

i.e. it updates the **local** `prefs` map and fires a `sonner` toast (e.g. "Daily digest enabled"). **Nothing is persisted** — see [Edge cases](#edge-cases--gotchas).

### 4. Card — "Compliance Thresholds" (icon `ShieldCheck`)
`page.tsx:86-96`. Three **read-only** `Row`s that render the bands from `COMPLIANCE` (`lib/constants.ts:116-119`, `{ compliant: 85, warning: 70 }`). The right-hand control is a colored `<span>` badge, not an input:

| Row | Description text | Badge | Colors |
|-----|-----------------|-------|--------|
| Compliant | "Score at or above `${COMPLIANCE.compliant}`% is treated as compliant." | `≥ 85%` | emerald |
| Warning | "Between `${COMPLIANCE.warning}`% and `${COMPLIANCE.compliant - 1}`% triggers a watch." | `70–84%` | amber |
| Non-compliant | "Below `${COMPLIANCE.warning}`% is flagged red." | `< 70%` | red |

These values are hard-coded constants and mirror the logic in `complianceStatus()` (`lib/constants.ts:121-125`). The page **displays** them; it cannot edit them.

### 5. Card — "Data Management" (icon `Database`)
`page.tsx:99-134`. Contents:

- Explanatory paragraph: "All submissions are stored in your browser. Resetting restores the original demo dataset and clears your changes." (`page.tsx:100-102`).
- A `Dialog` (shadcn/Radix) whose **trigger** is a red-outline `Button` labeled **"Reset demo data"** with a `RotateCcw` icon (`page.tsx:104-108`).
- The `DialogContent` (`page.tsx:109-132`):
  - Title: **"Reset demo data?"**
  - Description: "This restores all readings, approvals, alerts and industries to the original seed. Your submitted entries will be lost."
  - Footer with two buttons, **both wrapped in `DialogClose`** (so either one closes the dialog):
    - **Cancel** — outline, no handler (`page.tsx:117-119`).
    - **Reset** — red destructive button; `onClick` runs `resetData()` then `toast.success("Demo data reset to defaults")` (`page.tsx:120-130`).

---

## Forms & validation

**N/A — there is no validated form on this page.** No `react-hook-form`, no `zod` schema, no `<form>`/`onSubmit`. The only interactive inputs are:

- Four `Switch` toggles (Alert Preferences) → local `useState`, no validation.
- Two `disabled` `Switch` toggles (Appearance) → inert.
- The reset confirm `Dialog` → a single click handler, no fields.

There is nothing to validate and no error state.

---

## Key flows & logic

### Toggling an Alert Preference
1. User flips a `Switch` in the Alert Preferences card.
2. `onCheckedChange(v)` (`page.tsx:76`) merges the new value into local `prefs` via `setPrefs`.
3. A toast confirms (`toast(\`${p.label} ${v ? "enabled" : "disabled"}\`)`).
4. **No persistence.** The value survives only until the component unmounts (navigating away and back re-initializes `prefs` from `PREFS` defaults — `page.tsx:36`).

### Switching role
Clicking **Switch role** simply follows `<Link href="/login">` (`page.tsx:54`). It does not sign out; the Firebase session remains until you actually authenticate as a different user on the login page.

### Reset demo data (the load-bearing flow)
1. User clicks **Reset demo data** → `DialogTrigger` opens the confirm dialog (`page.tsx:104-108`).
2. In the dialog, clicking **Reset** (`page.tsx:120-130`):
   ```ts
   onClick={() => {
     resetData();
     toast.success("Demo data reset to defaults");
   }}
   ```
   Because the button is a `DialogClose` child, the dialog also closes. (Clicking **Cancel** just closes it, doing nothing.)
3. `resetData` is defined in the data store as (`lib/store/data.ts:438`):
   ```ts
   resetData: () => set({ ...seed() }),
   ```
4. `seed()` (`lib/store/data.ts:91-102`) builds a **fresh clone** of the original demo dataset and returns all six store arrays:
   - `industries`: `seedIndustries.map((i) => ({ ...i }))` (the two seed units **IND-019** and **IND-020**, from `data/industries.json` via `lib/data/seed.ts:17`).
   - `readings`: `buildReadings()`
   - `etpEntries`: `buildEtpEntries()`
   - `approvals`: `[...buildEtpApprovals(etpEntries), ...buildApprovals(readings)]`
   - `alerts`: `buildAlerts(readings)`
   - `compliance`: `buildCompliance()`
5. `set({ ...seed() })` replaces all six arrays in the Zustand store, so every component reading the store (dashboards, tables, alerts, etc.) immediately re-renders against the pristine seed. Any user-submitted readings / ETP entries / approvals that were in memory are discarded.

#### Persistence side-effect of `resetData` (important — see gotchas)
The data store is wrapped in `persist(...)` with a Firestore-backed storage adapter (`lib/store/data.ts:122-451`; `storage: createJSONStorage(() => firestoreStorage)`, `name: "jalrakshak-data"`, `version: 4`). Every `set(...)` — including `resetData` — triggers `firestoreStorage.setItem` (`lib/data/firestore-storage.ts:191-207`).

Crucially, the Settings page calls `resetData()` **directly**, **not** wrapped in `remoteApply`. Contrast with `useAuthStore.logout()` (`lib/store/auth.ts:38-49`), which deliberately sets `remoteApply.active = true` around its `resetData()` call so the seed is **not** written back to Firestore. The Settings reset has no such guard, so `setItem` proceeds (as long as `syncContext.ready` is true — `firestore-storage.ts:192`):

- It shards the seed by industry and, for each slice, writes it back **only if the caller is authorized** (`const canWrite = role === "monitoring-admin" || id === industryId;` — `firestore-storage.ts:203`).
- **As `monitoring-admin`:** `canWrite` is true for **every** seed slice, so `industries/IND-019` and `industries/IND-020` get **overwritten with seed data in Firestore** — this is destructive to any live regulatory data for those two units, and via `subscribeAll` other viewers converge on the seed too.
- **As `etp` operator:** `canWrite` is true only for the slice whose `id === industryId`. A self-registered operator's unit is `IND-021`+ (see `registerIndustry`, `lib/store/data.ts:378-385`), which is **not** a seed id, so **no slice matches and nothing is written to Firestore**. The reset is effectively in-memory only: the operator momentarily sees the two seed units, and a page reload (or a subsequent `subscribeOne` snapshot) restores their real single-unit data via `StoreHydrator` → `loadOneIndustry` (`components/shared/store-hydrator.tsx:111-118`).

---

## Units & formatting (KLD vs m³)

**Not applicable to this page.** Settings shows no water-balance volumes, so the "stored KL, displayed as m³ via `displayUnit()`" convention does not appear here. The only numbers are **compliance percentages** (`85`, `70`, computed `84`) pulled from the `COMPLIANCE` constant, all rendered with a literal `%`. One description string mentions "permitted KLD" as plain copy in the capacity-alert preference (`page.tsx:28`), but nothing on the page computes or converts a volume.

---

## Edge cases & gotchas

- **No navigation entry.** Settings is absent from `DASHBOARD_NAV` and unlinked anywhere; it is reachable only by direct URL. Both roles can open it (see the access table above).
- **Alert Preferences are ephemeral.** They are held in `useState` (`page.tsx:36`) with **no persistence** — not localStorage, not the store, not Firestore. Toasts imply an action, but navigating away/back or reloading resets them to `email/late/capacity = on`, `digest = off`. They also drive no real behavior (they don't influence which alerts fire — alert generation lives in `submitReading`/`submitEtpEntry`, `lib/store/data.ts:157-163,239-242`).
- **Appearance switches are inert.** Both are `checked disabled` with no handler (`page.tsx:63,66`); they cannot toggle theme or motion.
- **"Switch role" ≠ sign out.** It only navigates to `/login`; the current session persists until a different account signs in.
- **Reset is destructive for the regulator.** For `monitoring-admin`, confirming Reset overwrites the seed industry documents (`IND-019`, `IND-020`) in Firestore and can propagate to other viewers via `subscribeAll`. It is not a "local demo reset" for that role. For an `etp` operator whose unit isn't a seed id, the same click is effectively cosmetic/transient (nothing is persisted; real data returns on next load/snapshot).
- **Reset has no loading/disabled state.** The Reset button both runs `resetData()` and closes the dialog synchronously (`DialogClose`, `page.tsx:120-129`); there's no spinner and no undo.
- **Persist gate.** If a reset were somehow triggered before `syncContext.ready` is true, `setItem` would no-op (`firestore-storage.ts:192`), and the seed writes would be skipped — but in normal use the page only renders after hydration completes.
- **`roleMeta` fallback.** `ROLES.find(...) ?? ROLES[0]` (`page.tsx:34`) would default to "Monitoring Body" if `role` were null, but the `DashboardShell` gate ensures `role` is set before the page renders.

---

## Related files

| File | Role |
|------|------|
| `app/dashboard/settings/page.tsx` | The page itself (`SettingsPage`, `Card`, `Row`, `PREFS`). |
| `app/dashboard/layout.tsx` | Wraps the route in `DashboardShell`. |
| `components/dashboard/dashboard-shell.tsx` | Auth/role gate + redirects (`canAccessPath`, loading splash). |
| `components/dashboard/page-header.tsx` | The header (`eyebrow`/`title`/`description`). |
| `components/shared/icon.tsx` | Dynamic lucide `Icon` used for the role avatar. |
| `lib/constants.ts` | `ROLES` (role meta), `COMPLIANCE` thresholds, `canAccessPath`, `ADMIN_ONLY_PATHS`/`ETP_ONLY_PATHS`, `DASHBOARD_NAV`. |
| `lib/store/auth.ts` | `useAuthStore` — `role` selector; `logout()` (contrast for the reset persistence gotcha). |
| `lib/store/data.ts` | `useDataStore` — `resetData` (`:438`), `seed()` (`:91-102`), persist config (`:440-449`). |
| `lib/data/firestore-storage.ts` | Persist adapter — `setItem` shards + writes; `remoteApply`, `syncContext`, `canWrite` guard. |
| `lib/data/seed.ts` | Seed builders (`industries`, `buildReadings`, `buildEtpEntries`, `buildApprovals`, `buildEtpApprovals`, `buildAlerts`, `buildCompliance`). |
| `components/shared/store-hydrator.tsx` | Loads/live-syncs the role-scoped dataset that a reset overwrites in memory. |
| `components/ui/{dialog,switch,button}.tsx` | shadcn/Radix primitives used by the cards. |
