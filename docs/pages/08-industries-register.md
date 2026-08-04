# `/dashboard/industries/register` — Register Member (admin onboarding)

> Route: `/dashboard/industries/register` · File: `app/dashboard/industries/register/page.tsx` · Roles: `monitoring-admin` only · Rendered by: `DashboardShell` (via `app/dashboard/layout.tsx`, wrapped in `.theme-dash`)

---

## Purpose

A **lean, admin-only onboarding form** the RSPCB Monitoring Body uses to register a new individual‑ETP textile unit directly into the registry, without the operator being present. The default export is `RegisterMemberPage` (`page.tsx:30`).

It is the regulator‑side counterpart of the public `/register` self‑service page, deliberately stripped down:

- **Fewer fields** — no address, no password, no per‑stage RO capacities, no maximum‑effluent field.
- **No account creation** — it does *not* create a Firebase Auth login for the unit; it only inserts an `Industry` (and a seed compliance record) into the data store.
- **No input filtering** — raw `<input>`s with light Zod validation only (the public form filters keystrokes and enforces a password checklist).

On submit it calls one store action, `registerIndustry(...)` (`data.ts:378`), and swaps the form for a success panel. The new unit is created with `status: "pending"` and enters the RSPCB verification queue.

> Naming note: the human/nav name is "Register Member" and the success toast says **"Member registered"** (`page.tsx:58`), but the on‑page `PageHeader` title reads **"Register New ETP Unit"** (`page.tsx:99`). All three refer to the same action — see [Edge cases](#edge-cases--gotchas).

---

## Access & gating (auth / redirects / role gate)

There is **no page‑level guard inside `page.tsx`** — gating is inherited from the dashboard shell.

1. `app/dashboard/layout.tsx` wraps every `/dashboard/*` route in `.theme-dash` and renders `<DashboardShell>`.
2. `DashboardShell` (`components/dashboard/dashboard-shell.tsx:21‑31`) runs an auth/role effect on every navigation:
   - `if (!authReady) return;` → shows the "Loading command center…" shimmer (`dashboard-shell.tsx:33‑43`) until the Firebase auth listener resolves.
   - `if (!role) router.replace("/login")` → unauthenticated users are bounced to login.
   - `if (!canAccessPath(role, pathname)) router.replace("/dashboard")` → role mismatch redirects home.
3. `canAccessPath` (`lib/constants.ts:65‑72`) uses a **segment‑aware** match: `matches(p) = pathname === p || pathname.startsWith(p + "/")`.
   - `ADMIN_ONLY_PATHS` (`constants.ts:54‑61`) includes `"/dashboard/industries"`. Because this route is `"/dashboard/industries/register"`, it matches `"/dashboard/industries" + "/"` → it is treated as **admin‑only**.
   - `monitoring-admin` → `return !inEtp` → **allowed**.
   - `etp` → `return !inAdmin` → **false** → redirected to `/dashboard`.

**Server‑side boundary:** the Firestore write triggered on submit is governed by `firestore.rules`. `industries/{id}` **create** is permitted for an admin (or a self‑registering owner stamping `ownerUid`); the client role gate above only mirrors this for UX. See [Data](#data--store-reads--writes).

**Discoverability:** there is no sidebar entry for this route — `DASHBOARD_NAV` (`constants.ts:44‑52`) only lists `"Industries" → /dashboard/industries`. This page is reached from a button on the Industries page; the top of the form has a back‑link `← Industries` to `/dashboard/industries` (`page.tsx:96‑98`).

---

## Data — store reads & writes

Exactly **one** store binding, and **no** auth‑store read:

| Purpose | Binding | Source |
| --- | --- | --- |
| Create the unit | `const registerIndustry = useDataStore((s) => s.registerIndustry)` | `page.tsx:31` |
| Success panel state (local) | `const [done, setDone] = useState<null \| { name; id }>(null)` | `page.tsx:32` |

Contrast: the public `/register` reads three stores (`useDataStore.registerIndustry`, `useAuthStore.login`, `useAccountsStore.signup`) and manually drives Firestore (`register/page.tsx:51‑53`). This admin page reads **only** `registerIndustry`.

### What `registerIndustry` writes (`data.ts:378‑431`)

The action mutates the flat store arrays; the persist adapter (`lib/data/firestore-storage.ts`) shards the change into `industries/{id}` automatically — **there is no explicit Firestore code in this page**.

- **ID derivation** (`data.ts:381‑385`): next id = highest existing `IND-###` number + 1, zero‑padded to 3 → e.g. `IND-021`. Derived from the max numeric id (not array length) so ids never collide with seed ids or across a merge.
- **`industries` array** (`data.ts:387‑413`, prepended at `:415`): a new `Industry` with, from the form —
  - `name, ownerName, area, mobile, email, consentNumber, permittedKLD, etpCapacity, roCapacity, meeCapacity`
  - `contactPerson: input.ownerName` (`:393`)
  - `cetpId: input.cetpId` — hard‑coded `null` by the caller → `isIndividualETP: input.cetpId === null` = **`true`** (`:399‑400`)
  - `status: "pending"` (`:398`), `complianceScore: 75` (`score`, `:386`)
  - `lastReadingAt: null`, `alertsCount: 0`, `registeredAt: new Date().toISOString().slice(0,10)` (local date, `:410‑412`)
  - `address, maxEffluentGeneration, roStage1..roStage4` are set from `input.*` but the admin form **never supplies them**, so they land as `undefined` (all optional on `Industry`, `lib/types.ts:43,57‑61`).
- **`compliance` array** (`data.ts:416‑428`, prepended): a seed `ComplianceRecord` with `score: 75`, `status: complianceStatus(75)` → **`"warning"`** (75 ≥ 70 but < 85, `constants.ts:116‑125`), `submissionRate: 0`, `alertCount: 0`, and a flat 6‑month trend `Jan…Jun` all `= 75`.

The action **returns** the created `Industry` (`data.ts:430`); the page uses `created.name` and `created.id` for the toast and success panel.

**Not written:** no `approvals`, `alerts`, `readings`, or `etpEntries` rows; no Firebase Auth user; no `users/{uid}` profile; no `ownerUid` stamp. (An admin‑created unit therefore has no operator login until one is provisioned/linked separately.)

---

## Layout & sections

The component renders in **two mutually exclusive modes**.

### A. Success panel — when `done` is truthy (`page.tsx:62‑92`)

A centered, max‑w‑md column:

1. A spring‑animated emerald circle with a `Check` icon (Framer Motion `initial scale:0 rotate:-30 → 1/0`, `page.tsx:65‑72`).
2. Heading **"Registration submitted"** and body: *"**{done.name}** ({done.id}) has been registered and is now pending RSPCB verification."* (`page.tsx:74‑78`).
3. Two buttons (`page.tsx:80‑89`):
   - **"View industries"** → `Link` to `/dashboard/industries` (with `ListChecks` icon).
   - **"Register another"** (outline) → `onClick={() => { reset(); setDone(null); }}` — clears RHF fields and returns to the form.

### B. The form — default (`page.tsx:94‑164`)

Ordered blocks:

1. **Back‑link** `← Industries` → `/dashboard/industries` (`page.tsx:96‑98`).
2. **`PageHeader`** (`page.tsx:99`): eyebrow **"Industry Management"**, title **"Register New ETP Unit"**, description *"Onboard a textile unit running its own individual ETP. Submission enters the verification queue."*
3. A responsive `<form>` grid `lg:grid-cols-[1.6fr_1fr]` (`page.tsx:101`):

   **Left column — a single card** (`page.tsx:102‑142`) with two `Section`s:
   - **"Company Details"** (`Building2` icon) — a 2‑col field grid: Company Name, Owner Name, Area / Location, Consent Number, Mobile, Email (`page.tsx:103‑124`).
   - **"Capacity (KLD)"** (`ListChecks` icon) — a 2/4‑col grid of `type="number"` fields: Permitted, ETP, RO, MEE (`page.tsx:126‑141`).

   **Right column — two stacked cards** (`page.tsx:144‑163`):
   - **"Registration Type"** (`Droplets` icon) — a static info paragraph: *"Registered as an **Individual ETP** unit — a textile unit operating its own Effluent Treatment Plant (no CETP)."* There is **no toggle**; the type is fixed (caller passes `cetpId: null`).
   - **Submit card** — an explanatory line ("…created with a **pending** status and enters the approval workflow for RSPCB verification.") plus the submit `Button` (`page.tsx:158‑161`), which shows **"Submitting…"** while `isSubmitting`, else **"Submit Registration"**.

**Local helper components** (bottom of file): `inputCls` (`page.tsx:169`, shared input styling), `Field({label,error,children})` renders label + control + red error text (`page.tsx:172‑180`), `Section({title,icon,children})` renders an uppercase section heading (`page.tsx:182‑192`).

---

## Forms & validation

React Hook Form + Zod via `zodResolver(schema)` (`page.tsx:34‑41`). `type FormValues = z.input<typeof schema>` (`page.tsx:28`), so the numeric fields are typed as strings at input and coerced by Zod.

### Zod schema (`page.tsx:15‑26`)

| Field | RHF key | Type / rule | Error message |
| --- | --- | --- | --- |
| Company Name | `name` | `z.string().min(2)` | "Company name is required" |
| Owner Name | `ownerName` | `z.string().min(2)` | "Owner name is required" |
| Area / Location | `area` | `z.string().min(2)` | "Area is required" |
| Mobile | `mobile` | `z.string().min(8)` | "Valid mobile required" |
| Email | `email` | `z.string().regex(/^\S+@\S+\.\S+$/)` | "Valid email required" |
| Consent Number | `consentNumber` | `z.string().min(4)` | "Consent number required" |
| Permitted (KLD) | `permittedKLD` | `z.coerce.number().positive()` | "Must be > 0" |
| ETP (KLD) | `etpCapacity` | `z.coerce.number().positive()` | "Must be > 0" |
| RO (KLD) | `roCapacity` | `z.coerce.number().nonnegative()` | (default Zod message) |
| MEE (KLD) | `meeCapacity` | `z.coerce.number().nonnegative()` | (default Zod message) |

Notes:
- `permittedKLD` and `etpCapacity` must be **strictly positive**; `roCapacity` and `meeCapacity` may be **0** (`nonnegative`).
- `z.coerce.number()` turns the `type="number"` string values into numbers; an empty numeric input coerces to `NaN` and fails the `positive/nonnegative` check.
- Errors surface per field via `Field`'s red `<p>` (`page.tsx:177`), sourced from `errors.<key>.message` (e.g. `errors.name?.message`, `page.tsx:105`).

### No input filtering (the key contrast)

Unlike the public form, there is **no per‑keystroke transform** here. Every control is a plain `{...register(key)}` input:
- `name`/`ownerName`/`area` accept **any characters** (only `min(2)`), no alphabets‑only filter, no auto‑capitalisation.
- `mobile` is a free string with **`min(8)`** — it is *not* forced to 10 digits and has no `inputMode`/`maxLength`.
- The four capacity inputs are `type="number"` (`page.tsx:129,132,135,138`) with `placeholder="0"`; no `step="any"`.

### Field vs public `/register` comparison

| Aspect | Admin `/dashboard/industries/register` | Public `/register` |
| --- | --- | --- |
| Fields | 10: name, ownerName, area, consentNumber, mobile, email, **permittedKLD**, etpCapacity, **roCapacity**, meeCapacity | 15: name, ownerName, area, **address**, consentNumber, mobile, email, **password**, etpCapacity, **maxEffluentGeneration**, meeCapacity, **roStage1–4** |
| Address | ✗ (left `undefined`) | ✓ required (`min(4)`) |
| Password / login | ✗ (no account created) | ✓ checklist: ≥8 + letter + number + special |
| RO capacity | single **RO (KLD)** → `roCapacity` | 4 stages; `roCapacity` derived = `roStage1` |
| Permitted KLD | explicit **Permitted** field | derived = `maxEffluentGeneration` |
| Input filters | **none** | alphabets‑only name/owner/area, `capFirst`, digits‑only 10‑digit mobile |
| `mobile` rule | `min(8)` | `regex(/^\d{10}$/)` |
| onSubmit | **sync**: `registerIndustry` + toast + success panel | **async**: signup → emptyData → registerIndustry → `writeOwnedIndustry` (stamps `ownerUid`) → link `users/{uid}` → `login` → hard nav |
| Firebase Auth | none | creates an `etp` account + `users/{uid}` profile |
| After submit | in‑place success panel (stay in dashboard) | redirect to `/dashboard` |

(Public‑side references: `app/register/page.tsx:20‑46` schema/filters, `:84‑150` onSubmit.)

---

## Key flows & logic

`onSubmit = handleSubmit((values) => { … })` (`page.tsx:43‑60`) — **synchronous** (no `async`/`await`, no network in the handler). Pipeline:

1. **Validate** — RHF's `zodResolver` runs first; the callback only fires when the schema passes.
2. **Re‑parse for coercion** — `const parsed = schema.parse(values)` (`page.tsx:44`). `values` is typed `z.input` (numeric fields still strings), so this second parse yields the **coerced output** (`permittedKLD` etc. as real numbers). This is a redundant double parse but is what converts string→number before the store call.
3. **Create the unit** — `registerIndustry({...parsed, cetpId: null})` (`page.tsx:45‑57`). Only the ten schema fields plus a hard‑coded `cetpId: null` are passed — the optional `address`/RO‑stage/`maxEffluentGeneration` inputs of `RegisterInput` (`data.ts:41‑59`) are omitted → they become `undefined` on the created `Industry`.
4. **Toast** — `toast.success("Member registered", { description: \`${created.name} added with status "pending".\` })` (`page.tsx:58`).
5. **Switch to success panel** — `setDone({ name: created.name, id: created.id })` (`page.tsx:59`); the next render returns the panel branch.

Inside `registerIndustry` (`data.ts:378‑431`): derive `IND-###` id → build the `Industry` (`status:"pending"`, `complianceScore:75`, `isIndividualETP:true`) → `set` prepends it to `industries` and prepends a `warning`‑status compliance record → return the industry. The Zustand `set` triggers the persist adapter, which (for an admin session with `syncContext.ready`) shards and writes `industries/{id}` to Firestore via `setDoc(merge)`. Persistence is **silent and best‑effort** — a rules rejection or offline write fails with no UI feedback (see [firestore-storage gotchas](#edge-cases--gotchas)).

"Register another" (`page.tsx:86`) calls `reset()` (clears all RHF fields) then `setDone(null)` to re‑show a blank form.

---

## Units & formatting

- All four capacity inputs live under the **"Capacity (KLD)"** section (`page.tsx:126`) and are entered/stored as **KLD** — `Permitted → permittedKLD`, `ETP → etpCapacity`, `RO → roCapacity`, `MEE → meeCapacity`. Unlike the public form, `permittedKLD` is a **distinct explicit field** here (not derived from `maxEffluentGeneration`), and RO is a **single** capacity (not four stages mapped through `roStage1`).
- This page renders **no water‑balance volumes**, so the KL→m³ display convention (`displayUnit`, `lib/utils.ts`) does **not** apply here. All quantities on this page are capacities in KLD; there is nothing to convert.

---

## Edge cases & gotchas

- **Name mismatch across the UI.** Nav/route human name = "Register Member"; on‑page title = "Register New ETP Unit" (`page.tsx:99`); success toast = "Member registered" (`page.tsx:58`). Same action, three labels.
- **No operator login is created.** This form only inserts an `Industry` + compliance row; it never touches Firebase Auth or `users/{uid}`, and never stamps `ownerUid`. An admin‑onboarded unit has no self‑service login until one is provisioned/linked out‑of‑band. (The public `/register` is the only path that mints an `etp` account and owner stamp.)
- **Fixed Individual‑ETP type.** `cetpId` is hard‑coded `null` at the call site (`page.tsx:56`) → `isIndividualETP: true`. The "Registration Type" card is informational only; there is no CETP option.
- **Redundant double Zod parse.** `zodResolver` validates, then `schema.parse(values)` runs again (`page.tsx:44`) — intentional (to coerce string→number) but duplicated work.
- **Weak `mobile` validation & no input filters.** `mobile` only requires `min(8)` and accepts any characters; name/owner/area accept non‑alphabetic input. The public form is far stricter. Data entered here can be less clean than self‑registered data.
- **Empty numeric inputs fail predictably.** `z.coerce.number()` on a blank field yields `NaN`, tripping `positive()`/`nonnegative()`; `roCapacity`/`meeCapacity` accept `0` but not blank.
- **Default compliance = 75 → "warning".** Every newly onboarded unit starts at score 75, which maps to `warning` (below the `85` compliant threshold), with a flat 6‑month trend and `submissionRate: 0` (`data.ts:416‑428`, `constants.ts:116‑125`).
- **Silent, best‑effort persistence.** The Firestore write happens through the persist adapter (`firestore-storage.ts`), which swallows errors and no‑ops when `syncContext.ready` is false or `remoteApply.active` is true. The unit still appears locally/optimistically even if the remote write is later rejected — the store can drift from Firestore until the next successful reconcile.
- **`registeredAt` is local‑clock based** — `new Date().toISOString().slice(0,10)` (`data.ts:412`); the admin's browser date, not a server timestamp.

---

## Related files

| File | Role |
| --- | --- |
| `app/dashboard/industries/register/page.tsx` | This page — `RegisterMemberPage`, schema, form, success panel |
| `lib/store/data.ts` | `registerIndustry` action (`:378‑431`), `RegisterInput` (`:41‑59`) |
| `app/register/page.tsx` | Public self‑registration form — the contrast case (filters, password, Firebase Auth, `writeOwnedIndustry`) |
| `app/dashboard/industries/page.tsx` | Admin registry table; entry point that links to this route |
| `lib/constants.ts` | `canAccessPath`, `ADMIN_ONLY_PATHS`, `DASHBOARD_NAV`, `complianceStatus` |
| `components/dashboard/dashboard-shell.tsx` | Auth/role gate + loading state wrapping the route |
| `components/dashboard/page-header.tsx` | `PageHeader` used at the top of the form |
| `app/dashboard/layout.tsx` | Applies `.theme-dash` and renders `DashboardShell` |
| `lib/types.ts` | `Industry` (`:38‑65`), `RegisterInput`/`CetpId` types |
| `lib/data/firestore-storage.ts` | Persist adapter that shards the created unit into `industries/{id}` |
| `lib/constants.ts` → `COMPLIANCE` / `complianceStatus` | Thresholds behind the seed `warning` status |
| `firestore.rules` | Server‑side boundary governing the `industries/{id}` create write |
