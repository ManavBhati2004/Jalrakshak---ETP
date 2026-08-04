# `/register` — Register (public ETP self-registration)

> Route: `/register` · File: `app/register/page.tsx` · Roles: **public / unauthenticated** (anyone; creates an `etp` operator) · Rendered by: `RegisterEtpPage` (default export, `app/register/page.tsx:50`)

---

## Purpose

`/register` is the **public self-service onboarding form** for an individual ETP operator. A visitor fills in their unit's company details + treatment capacities, and on submit the page — in one atomic client-side pipeline — creates a Firebase Auth account, provisions a brand-new per-tenant `industries/{id}` document owned by that account, links the account profile to it, and drops the user straight into their ETP panel (`/dashboard`).

The page copy frames it plainly (`app/register/page.tsx:166-171`):

> "Individual ETP · Self Registration" … "Provide your unit details and treatment capacities. All capacities are recorded in KLD. On submit you'll enter your ETP panel."

The account created always has `role: "etp"` — there is **no way to self-register a `monitoring-admin`** here (the role is hard-coded, `page.tsx:89`). The RSPCB monitoring body is a separately-provisioned account.

---

## Access & gating

- **Not a dashboard route.** `/register` lives at `app/register/page.tsx`, i.e. top-level — it is **not** under `app/dashboard/*`, so it is **not** wrapped by `DashboardShell` and the `canAccessPath` role→path machinery (`lib/constants.ts:65-72`) never runs for it. There is no auth guard, no role check, and no redirect-if-already-signed-in. The page renders for anyone, authed or not.
- **Entry points.** Linked from the login page in two places — the "Register Unit" tab (`app/login/page.tsx:110`) and the "Register" inline link (`app/login/page.tsx:158`) — and directly reachable by URL. There is also a **"Back to login"** link on the page itself (`page.tsx:158-160`, `→ /login`).
- **Gating happens the other way around.** Rather than guarding entry, the page *establishes* the session and then performs its own hard redirect to `/dashboard` (`page.tsx:147-149`). The per-tenant Firestore security boundary that actually matters (ownerUid + `firestore.rules`) is applied at write time via `writeOwnedIndustry` — see [Key flows](#key-flows--logic).
- **`"use client"`** component (`page.tsx:1`); all logic runs in the browser.

---

## Data — store reads & writes

### Store selectors / actions read (hooks)

| Binding | Source | Line |
|---|---|---|
| `registerIndustry` | `useDataStore((s) => s.registerIndustry)` | `page.tsx:51` |
| `login` | `useAuthStore((s) => s.login)` | `page.tsx:52` |
| `signup` | `useAccountsStore((s) => s.signup)` | `page.tsx:53` |

### Direct data-layer imports used in `onSubmit`

From `@/lib/data/firestore-storage` (`page.tsx:17`): `remoteApply`, `emptyData`, `writeOwnedIndustry`, `syncContext`.
From `firebase/firestore` + `@/lib/firebase` (`page.tsx:12-13`): `doc`, `setDoc`, `db`.

### Writes performed (in order)

1. **Firebase Auth user + `users/{uid}` profile** — via `signup(...)` → `createUserWithEmailAndPassword` then `setDoc(users/{uid}, {name,email,role,industryId:null})` (`lib/store/accounts.ts:58-71`).
2. **Local store cleared to empty** — `useDataStore.setState(emptyData())` under `remoteApply` guard (`page.tsx:97-102`).
3. **Local industry created** — `registerIndustry(...)` pushes a new `Industry` + `ComplianceRecord` into the store (`lib/store/data.ts:378-431`).
4. **Per-tenant industry document** — `writeOwnedIndustry(state, created.id, acct.user.id)` → `setDoc(industries/{id}, {json, industryId, updatedAt, ownerUid}, {merge:true})` (`firestore-storage.ts:214-217` → `writeSlice`, `:169-182`).
5. **Account→industry link** — `setDoc(users/{uid}, {industryId: created.id}, {merge:true})` (`page.tsx:135`).
6. **Auth store (optimistic)** — `login("etp", created.id)` sets `{role,industryId,isAuthed:true,authReady:true}` (`lib/store/auth.ts:37`).
7. **`syncContext`** mutated directly (`page.tsx:139-142`) so in-session persistence works before the auth listener re-reads the profile.

Note: the local store's own persist adapter (`firestoreStorage.setItem`) does **not** do the authoritative industry write here. During step 2 it is suppressed by `remoteApply.active`; during step 3 it would either be gated out by `syncContext.ready === false` or skipped because `id !== syncContext.industryId` (`firestore-storage.ts:192-206`). The authoritative, ownership-stamping write is the explicit `writeOwnedIndustry` in step 4.

---

## Layout & sections

Single centered column (`max-w-3xl`) over a teal→cyan gradient background (`page.tsx:152-154`). Top to bottom:

1. **Header row** (`page.tsx:155-162`) — `JalRakshakLogo` (left) + ghost "← Back to login" button linking to `/login` (right).
2. **Title block** (`page.tsx:164-172`) — a teal pill badge "Individual ETP · Self Registration", the `<h1>` "Register your ETP unit", and the KLD helper subtitle.
3. **Card 1 — "Company Details"** (`page.tsx:176-230`) — a `Building2`-iconed card with an 8-field responsive grid (`sm:grid-cols-2`): Company Name, Owner Name, Area / Location, Address, Consent Number, Mobile, Email, and Login Password (with show/hide toggle + live checklist).
4. **Card 2 — "Treatment Capacities (KLD)"** (`page.tsx:233-260`) — a `Droplets`-iconed card, 3-column grid (`sm:grid-cols-2 lg:grid-cols-3`), 7 numeric capacity fields.
5. **Submit button** (`page.tsx:262-270`) — full-width gradient button, label toggles "Register & Enter ETP Panel" ⇄ "Registering…" and is `disabled` while `submitting` (`page.tsx:264`).

Presentational helpers live at the bottom of the file: `inputCls` (shared input classes, `page.tsx:277-278`) and the `Field` wrapper (`label` + children + optional red `error` `<p>`, `page.tsx:280-288`).

---

## Forms & validation

Form is `react-hook-form` with `zodResolver(schema)` (`page.tsx:57-62`). `type FormValues = z.input<typeof schema>` (`page.tsx:48`), so numeric capacity fields are **strings in the form** and are coerced by Zod.

### Per-keystroke input transforms

Three pure transforms (`page.tsx:21-23`) are applied live via a `filtered(...)` wrapper (`page.tsx:65-74`) that decorates RHF's `register().onChange` and rewrites `e.target.value` before it reaches the field:

```ts
const alphaOnly  = (v) => v.replace(/[^A-Za-z ]/g, "");        // strip anything but letters + space
const digitsOnly = (v) => v.replace(/\D/g, "").slice(0, 10);   // digits only, hard-capped at 10
const capFirst   = (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : v);
```

`filtered` only accepts the keys `"name" | "ownerName" | "area" | "mobile"` (`page.tsx:65`). Every other field uses a plain `{...register(key)}`.

### Full field list

| # | Field label | RHF key | Live filter (per keystroke) | Zod rule | Error shown? |
|---|---|---|---|---|---|
| 1 | Company Name | `name` | `capFirst(alphaOnly(v))` — letters+space only, first char uppercased | `regex(/^[A-Za-z ]{2,}$/, "Company name — alphabets only")` | yes (`errors.name`) |
| 2 | Owner Name | `ownerName` | `alphaOnly` (no capFirst) | `regex(/^[A-Za-z ]{2,}$/, "Owner name — alphabets only")` | yes |
| 3 | Area / Location | `area` | `alphaOnly` (no capFirst) | `regex(/^[A-Za-z ]{2,}$/, "Area — alphabets only")` | yes |
| 4 | Address | `address` | none (plain `register`) | `min(4, "Address is required")` | yes |
| 5 | Consent Number | `consentNumber` | none | `min(4, "Consent number required")` | yes |
| 6 | Mobile | `mobile` | `digitsOnly` (+ `inputMode="numeric" maxLength={10}`) | `regex(/^\d{10}$/, "Enter a 10-digit mobile number")` | yes |
| 7 | Email | `email` | none | `regex(/^\S+@\S+\.\S+$/, "Valid email required")` | yes |
| 8 | Login Password | `password` | none (show/hide toggle) | `min(8)` + `regex(/[A-Za-z]/)` + `regex(/[0-9]/)` + `regex(/[^A-Za-z0-9]/)` | **no inline error** — see below |
| 9 | ETP Capacity (KLD) | `etpCapacity` | none (`type="number" step="any"`) | `z.coerce.number().positive("Must be > 0")` | yes |
| 10 | Maximum Effluent Generation (KLD) | `maxEffluentGeneration` | none | `z.coerce.number().positive("Must be > 0")` | yes |
| 11 | MEE Capacity (KLD) | `meeCapacity` | none | `z.coerce.number().positive("Must be > 0")` | yes |
| 12 | RO Stage I (KLD) | `roStage1` | none | `z.coerce.number().positive("Must be > 0")` | yes |
| 13 | RO Stage II (KLD) | `roStage2` | none | `z.coerce.number().nonnegative()` (0 allowed) | yes |
| 14 | RO Stage III (KLD) | `roStage3` | none | `z.coerce.number().nonnegative()` | yes |
| 15 | RO Stage IV (KLD) | `roStage4` | none | `z.coerce.number().nonnegative()` | yes |

The full `schema` object is `page.tsx:25-46`. Field order in the rendered "Capacities" grid is exactly 9→15 above (ETP, Max Effluent, MEE, RO I–IV) — `page.tsx:238-258`.

### Password — the live 4-item checklist

The password field renders **no `Field` `error` prop** (`page.tsx:202` — `Field label="Login Password"` with no `error`), so the Zod password message never appears as inline red text. The **only** visible password feedback is a live checklist driven by `watch("password")` (`page.tsx:76-82`, rendered `:220-227`):

```ts
const pw = watch("password") ?? "";
const pwChecks = [
  { label: "At least 8 characters",         ok: pw.length >= 8 },
  { label: "Contains a letter",             ok: /[A-Za-z]/.test(pw) },
  { label: "Contains a number",             ok: /[0-9]/.test(pw) },
  { label: "Contains a special character",  ok: /[^A-Za-z0-9]/.test(pw) },
];
```

Each item shows a green `CheckCircle2` (`text-emerald-600`) when satisfied and a grey `Circle` (`text-slate-400`) otherwise. These four checks mirror the four Zod password rules exactly. The show/hide toggle flips `type` between `text`/`password` via `showPw` state and an `Eye`/`EyeOff` button (`page.tsx:205-218`).

### Error states

- Non-password fields render a red `<p className="mt-1 text-xs text-red-500">` under the input when `errors.<key>?.message` is set (`Field`, `page.tsx:285`).
- `handleSubmit` will **not** invoke `onSubmit` while any field is invalid, so a partially-valid form simply does nothing on click except surface the field errors (and, for the password, keep the checklist from going all-green).

---

## Key flows & logic

### `onSubmit` — the full registration pipeline (`page.tsx:84-150`)

Runs only after RHF+Zod validation passes. Step numbers match the inline comments.

```
0. const v = schema.parse(values)   // re-parse → coerces numeric strings to numbers
   setSubmitting(true)

1. SIGN UP (must be authed before touching Firestore — rules require auth to create the doc)
   const acct = await signup({ name: v.ownerName, email: v.email,
                               password: v.password, role: "etp", industryId: null })
   if (!acct.ok) → toast.error(acct.error); setSubmitting(false); return

2. CLEAR STORE to a clean slate (a new operator's world is only its own unit)
   remoteApply.active = true
   try { useDataStore.setState(emptyData()) } finally { remoteApply.active = false }
   // remoteApply guard ⇒ firestoreStorage.setItem is suppressed ⇒ this reset is NOT
   //   persisted, so it can never clobber another tenant's industry document.

3. CREATE the unit locally
   const created = registerIndustry({ name, ownerName, area, address, mobile, email,
       consentNumber, permittedKLD: v.maxEffluentGeneration, etpCapacity: v.etpCapacity,
       roCapacity: v.roStage1, meeCapacity: v.meeCapacity, cetpId: null,
       maxEffluentGeneration, roStage1..4 })

4. PERSIST as an operator-OWNED industry document (stamps ownerUid so rules bind it)
   try { await writeOwnedIndustry(useDataStore.getState(), created.id, acct.user.id) }
   catch { /* best-effort — persistence must not block entering the panel */ }

5. LINK account → industry, then point the sync context at it
   try { await setDoc(doc(db,"users",acct.user.id), { industryId: created.id }, { merge:true }) }
   catch { /* best-effort — session industryId still set optimistically below */ }
   syncContext.uid = acct.user.id
   syncContext.role = "etp"
   syncContext.industryId = created.id
   syncContext.ready = true          // in-session submissions now persist immediately

6. ENTER the panel
   toast.success("ETP unit registered", { description: `${created.name} is now pending verification.` })
   login("etp", created.id)          // optimistic auth-store set for instant UI

7. HARD redirect (full page nav) after 600 ms
   setTimeout(() => { window.location.href = "/dashboard" }, 600)
```

### What each step actually does

- **`signup(...)` (`lib/store/accounts.ts:52-76`)** — trims + lowercases the email, re-checks name/email/`password.length >= 6`, calls `createUserWithEmailAndPassword(auth, email, password)`, then `setDoc(users/{uid}, {name,email,role,industryId:null})`. Returns `{ ok:true, user:{ id:uid, ... } }` or `{ ok:false, error }` with a friendly message from `messageForCode` (`accounts.ts:36-49`). **Side effect:** Firebase auto-signs-in the new user, so `StoreHydrator`'s `onAuthStateChanged` fires asynchronously with this uid — at that instant the profile still has `industryId: null`, so the hydrator hits its "authenticated but not bound to an industry" branch and applies `emptyData()` (`store-hydrator.tsx:119-122`). This in-flight listener is exactly the race the manual `syncContext` override + hard reload are designed to beat.

- **`registerIndustry(input)` (`lib/store/data.ts:378-431`)** — derives the next id from the **highest existing `IND-###`** number in the store (`data.ts:381-385`); since step 2 just emptied the store, that reduction over `[]` yields `0`, so the new id is **`IND-001`**. Builds the `Industry` (`data.ts:387-413`) with `status:"pending"`, `complianceScore: 75`, `cetpId:null` ⇒ `isIndividualETP:true`, `contactPerson: ownerName`, `registeredAt: today (YYYY-MM-DD)`, and the field mapping: `permittedKLD ← maxEffluentGeneration`, `roCapacity ← roStage1`, plus the explicit `maxEffluentGeneration`/`roStage1..4`/`etpCapacity`/`meeCapacity`. Also prepends a `ComplianceRecord` (score 75, flat 6-month trend, `submissionRate:0`) (`data.ts:414-429`). Returns the `Industry`.

- **`writeOwnedIndustry(data, industryId, ownerUid)` (`firestore-storage.ts:214-217`)** — shards the current store, pulls the `created.id` slice, and calls `writeSlice(id, slice, ownerUid)`. Because `ownerUid` is passed, the write is **forced** (bypasses the JSON dedup cache, `firestore-storage.ts:171`) and the payload includes `ownerUid` alongside `{ json, industryId, updatedAt }`, merged into `industries/{id}` (`firestore-storage.ts:175-178`). This `ownerUid` stamp is what `firestore.rules` binds the tenant to.

- **`login("etp", created.id)` (`lib/store/auth.ts:37`)** — an optimistic local set of `{role:"etp", industryId, isAuthed:true, authReady:true}`, purely for instant UI; the durable session comes from the auth listener after reload.

- **Hard redirect (`window.location.href`, not `router.push`)** — forces a full reload so `StoreHydrator` re-runs `onAuthStateChanged` cleanly against the now-linked `users/{uid}` profile (`industryId` set), taking the `else if (industryId)` branch → `loadOneIndustry` + `subscribeOne` (`store-hydrator.tsx:111-118`). The 600 ms delay lets the success toast show and gives the in-flight writes a moment.

---

## Units & formatting (KLD vs m³)

- **All capacities on this form are KLD** — the intro line ("All capacities are recorded in KLD", `page.tsx:170`) and the section header "Treatment Capacities (KLD)" (`page.tsx:235`), and every capacity label carries "(KLD)". These raw numbers are stored directly on the `Industry` (`etpCapacity`, `meeCapacity`, `roStage1..4`, `maxEffluentGeneration`, `permittedKLD`) with **no conversion**.
- The `displayUnit()` "KL → m³" remap (`lib/utils.ts:17`) is a concern of the **water-balance volume** displays elsewhere in the app (dashboard, ETP entry), **not** of this registration form. Nothing on `/register` renders `m³`.

---

## Edge cases & gotchas

- **Every fresh registration derives the same id `IND-001`.** Step 2 empties the store *before* `registerIndustry` derives the next id, so the "highest existing `IND-###`" protection (`data.ts:381-385`) operates over an empty array and always yields `IND-001` (then `IND-002…` only within one session). Two operators self-registering independently both target `industries/IND-001`. Uniqueness / ownership isolation therefore rests entirely on the server side — the `ownerUid` stamp plus `firestore.rules` (the actual boundary) — not on client id derivation.
- **Password has no inline error.** The Zod password message is never rendered (the `Field` gets no `error` prop, `page.tsx:202`). If a user's password fails Zod, the *only* signal is the checklist not turning fully green + `handleSubmit` silently refusing to run `onSubmit`. There is no red "At least 8 characters" text like the other fields have.
- **Two different password minimums.** Zod requires **≥ 8 chars + letter + number + special** (`page.tsx:33-38`); `signup` only re-checks **≥ 6** (`accounts.ts:56`) and Firebase's own `auth/weak-password` maps to "at least 6 characters" (`accounts.ts:42-43`). Zod is stricter and is reached first, so in practice the 8-char rule governs — the 6-char check is a redundant backstop.
- **`capFirst` is Company-Name-only.** Owner Name and Area use bare `alphaOnly` (`page.tsx:185,188`), so their first letters are **not** auto-capitalized; only Company Name is (`page.tsx:182`).
- **`alphaOnly` blocks common real-world characters.** Letters + space only — so names with `&`, `/`, `-`, digits or `.` (e.g. "M/s ABC-123", "R & D Unit") cannot be typed into Company/Owner/Area, and Zod would reject them too.
- **Email stored two ways.** The `Industry.email` keeps the **raw typed** value (`registerIndustry` uses `v.email`, `page.tsx:107`), while the auth account + `users/{uid}` profile store the **trimmed + lowercased** email (`accounts.ts:53`). Minor divergence to be aware of when matching records.
- **Steps 4 & 5 are best-effort (swallowed).** Both `writeOwnedIndustry` and the `users/{uid}` link `setDoc` are wrapped in `try {} catch {}` (`page.tsx:126-138`). If they fail, the account still exists and the user still enters the panel (optimistic `login` + `syncContext`), but the durable industry document and/or the profile link may be missing — a subsequent fresh session (which relies on `users/{uid}.industryId`) could then load an empty dataset.
- **No duplicate / consent-number uniqueness check.** Nothing validates that the consent number, company name, or mobile is unique; any value passing the format checks is accepted.
- **Empty numeric fields coerce to 0.** `z.coerce.number()` turns `""` into `0` (via `Number("")`), so a blank required-positive capacity fails `.positive()` ("Must be > 0") rather than a "required" message; blank `roStage2..4` coerce to `0` and pass `.nonnegative()`.
- **Not auth-guarded.** An already-signed-in user (of either role) can open `/register` and register another unit; there is no redirect-away for authed visitors.

---

## Related files

| File | Role in this page |
|---|---|
| `app/register/page.tsx` | The page itself — form, Zod schema, input filters, password checklist, `onSubmit` pipeline. |
| `lib/store/accounts.ts` | `useAccountsStore.signup` — Firebase Auth user creation + `users/{uid}` profile write. |
| `lib/store/data.ts` | `useDataStore.registerIndustry` — builds the `Industry` + `ComplianceRecord`, derives the `IND-###` id. |
| `lib/data/firestore-storage.ts` | `writeOwnedIndustry` / `writeSlice` (ownerUid stamp), `remoteApply`, `emptyData`, `syncContext`, and the `firestoreStorage` persist adapter. |
| `lib/store/auth.ts` | `useAuthStore.login` — optimistic session set consumed after redirect. |
| `components/shared/store-hydrator.tsx` | `onAuthStateChanged` listener that (post hard-reload) loads + live-syncs the newly-linked single industry (`loadOneIndustry`/`subscribeOne`). |
| `lib/firebase.ts` | Exports `auth`, `db` used for the direct `setDoc(users/{uid})` link. |
| `lib/types.ts` | `Industry` interface (`:38-65`) — the shape `registerIndustry` populates. |
| `app/login/page.tsx` | Links into `/register` (`:110`, `:158`); the "Back to login" target. |
| `firestore.rules` | The real per-tenant security boundary that binds each `industries/{id}` doc to its `ownerUid`. |
| `lib/utils.ts` | `displayUnit()` (`:17`) — the KL→m³ remap that does **not** apply to this KLD form. |
