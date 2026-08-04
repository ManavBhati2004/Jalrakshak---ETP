# `/login` — Sign in

> Route: `/login` · File: `app/login/page.tsx` · Roles: **public / unauthenticated** (anyone; both `monitoring-admin` and `etp` sign in here) · Rendered by: `LoginPage` (default export, `app/login/page.tsx:19`)

---

## Purpose

The single credential-entry screen for the app. It authenticates an existing user against **Firebase Authentication** (email/password), reads that user's app profile from Firestore (`users/{uid}`), and routes them into `/dashboard`. It is **sign-in only** — the actual account-creation form lives at `/register`; this page only links there.

The page is a `"use client"` component (`app/login/page.tsx:1`) and is the destination the dashboard gate redirects to whenever a visitor is unauthenticated (`components/dashboard/dashboard-shell.tsx:24`).

Two hard-coded **demo accounts** are printed on-screen so a reviewer can log in immediately:

| Role label | Email | Password |
| --- | --- | --- |
| Monitoring Body (`monitoring-admin`) | `admin@rspcb.in` | `rspcb123` |
| ETP Unit (`etp`) | `etp@demo.in` | `demo123` |

(`app/login/page.tsx:147-155`)

---

## Access & gating (auth / redirects)

`/login` is **not** a dashboard route, so it is **not** wrapped by `DashboardShell` and `canAccessPath` does **not** apply to it. It is publicly reachable and renders regardless of auth state.

- **No self-redirect for already-authenticated users.** `LoginPage` has no `useEffect`/session check — an already-signed-in user who navigates back to `/login` still sees the form. (Contrast with the dashboard, which *does* gate.)
- **How the role gate consumes what this page produces:** after a successful sign-in this page calls `go()`, which sets an optimistic session (`useAuthStore.login`) and `router.push("/dashboard")`. The dashboard's shell then enforces access:

  ```tsx
  // components/dashboard/dashboard-shell.tsx:21-31
  useEffect(() => {
    if (!authReady) return;
    if (!role) { router.replace("/login"); return; }   // unauthenticated → back here
    if (!canAccessPath(role, pathname)) router.replace("/dashboard");
  }, [authReady, role, router, pathname]);
  ```

  So the login page's job ends at "put a valid `role` + `industryId` into `useAuthStore`"; `canAccessPath` (`lib/constants.ts:65-72`) later decides which dashboard sub-routes that role may open (admins are blocked from `ETP_ONLY_PATHS`, operators from `ADMIN_ONLY_PATHS`).

- **Authoritative session restore happens elsewhere.** `StoreHydrator` subscribes to `onAuthStateChanged` (`components/shared/store-hydrator.tsx:60`) and, on any Firebase auth change, re-reads `users/{uid}` and calls `useAuthStore.setSession(...)` with the real `role`/`industryId` (`store-hydrator.tsx:79-86`). The login page's `login()` call is only an **optimistic** bridge so the dashboard renders without a flash of the loading state; the hydrator's `setSession` is the source of truth and also kicks off the per-tenant data load.

---

## Data — store reads & writes

The page touches two Zustand stores. It does **not** read/write the six data arrays in `useDataStore` (that's the hydrator's job).

### `useAuthStore` (`lib/store/auth.ts`)

| Selector / action | Where | Purpose |
| --- | --- | --- |
| `login` | `page.tsx:21` (`useAuthStore((s) => s.login)`) | Optimistic session set: `login(role, industryId)` → `set({ role, industryId, isAuthed: true, authReady: true })` (`auth.ts:37`). |

The page does **not** read `uid`, `isAuthed`, `authReady`, `setSession`, or `logout`.

### `useAccountsStore` (`lib/store/accounts.ts`)

| Selector / action | Where | Purpose |
| --- | --- | --- |
| `authenticate` | `page.tsx:22` (`useAccountsStore((s) => s.authenticate)`) | `authenticate(email, password) => Promise<Account \| null>` — signs in via Firebase Auth, loads the Firestore profile, returns an `Account` or `null` on any failure (`accounts.ts:77-93`). |

`authenticate` itself performs the only "reads": `signInWithEmailAndPassword(auth, e, password)` (`accounts.ts:80`) and `getDoc(doc(db, "users", cred.user.uid))` (`accounts.ts:81`). It performs **no writes**.

### Local component state (`useState`)

| State | Init | Line | Role |
| --- | --- | --- | --- |
| `email` | `""` | `page.tsx:24` | Email input value |
| `password` | `""` | `page.tsx:25` | Password input value |
| `error` | `""` | `page.tsx:26` | Inline error text |
| `entering` | `false` | `page.tsx:27` | Disables the button + shows "Entering…" during sign-in and the 500 ms redirect delay |
| `showPw` | `false` | `page.tsx:28` | Toggles password visibility |

---

## Layout & sections

Root is a two-column CSS grid that becomes single-column below `lg`: `grid min-h-screen lg:grid-cols-[0.95fr_1.05fr]` (`page.tsx:49`).

### 1. Brand panel (left, `lg`-only) — `page.tsx:51-84`
Hidden on mobile (`hidden … lg:flex`). Indigo→violet→blue gradient with a grid overlay (`bg-grid-cyan`) and a blurred radial glow. Contains, top-to-bottom:
- `JalRakshakLogo` in light tone, size 40 (`page.tsx:58`).
- Heading **"Water Monitoring / Command Center"** and a sub-line about the Balotra textile cluster (`page.tsx:61-69`).
- Three highlight rows from the `HIGHLIGHTS` array (`page.tsx:13-17`): "Live flow & energy monitoring" (Activity), "Automated compliance & alerts" (ShieldCheck), "ZLD water-recovery oversight" (Droplets) (`page.tsx:70-79`).
- Footer: `© {current year} RSPCB · Balotra — Demonstration prototype` (`page.tsx:81-83`).

### 2. Auth panel (right / full-width on mobile) — `page.tsx:87-163`
White→indigo→violet vertical gradient. Contains:

- **Top bar** (`page.tsx:88-99`): a ghost **"Home"** button linking to `/` with a back-arrow (`page.tsx:89-94`), and a pill badge **"Secure demo login"** with a lock icon (`page.tsx:95-98`).
- **Mobile logo** (`page.tsx:102-104`): `JalRakshakLogo` size 36, shown only below `lg` (`lg:hidden`) since the brand panel is hidden there.
- **Segmented tabs** (`page.tsx:107-115`): a pill group with **"Sign in"** rendered as an active (indigo) non-interactive `<span>` and **"Register Unit"** as a `<Link href="/register">`. There is no in-page tab switching — "Register Unit" is a full navigation.
- **Heading block** (`page.tsx:117-118`): "Welcome back" + "Sign in to your RSPCB or textile-unit account."
- **Credentials** (`page.tsx:121-133`): Email and Password fields (see Forms below), each wrapped by the local `LField` label helper (`page.tsx:171-181`).
- **Error banner** (`page.tsx:135`): red pill, rendered only when `error` is non-empty.
- **Sign In button** (`page.tsx:137-145`): full-width gradient button; label toggles "Sign In" (+ arrow) ↔ "Entering…" and is disabled while `entering`.
- **Demo accounts card** (`page.tsx:147-155`): the two credential rows tabulated above.
- **Register footer link** (`page.tsx:156-161`): "New here? **Register a unit**" → `/register`.

---

## Forms & validation

> There is **no `<form>` element and no `onSubmit`** on this page. The inputs are plain controlled `<input>`s, and sign-in fires from the button's `onClick={signIn}` (`page.tsx:138`). There is also **no Zod schema** and **no `required` attribute** — client-side validation is effectively absent; all rejection is delegated to Firebase.

### Fields

| Field | Element | Type | Binding | Attrs | Line |
| --- | --- | --- | --- | --- | --- |
| Email | `<input>` | `email` | `value={email}` / `onChange → setEmail` | `placeholder="you@unit.in"`, `autoComplete="email"` | `page.tsx:122-124` |
| Password | `<input>` | `showPw ? "text" : "password"` | `value={password}` / `onChange → setPassword` | `placeholder="••••••••"`, `autoComplete="current-password"`, extra `pr-10` for the toggle | `page.tsx:125-132` |

Shared input styling is the `inputCls` constant (`page.tsx:168-169`): `h-11 w-full rounded-xl border … focus:border-indigo-400`.

### Show/hide password
Inside the password field a `<button type="button" tabIndex={-1}>` toggles `showPw` with `setShowPw((s) => !s)` (`page.tsx:128`). It swaps the `EyeOff`/`Eye` icon and sets `aria-label` to "Hide password" / "Show password" accordingly (`page.tsx:128-129`). `type="button"` + `tabIndex={-1}` keeps it out of the tab order and prevents any accidental submit.

### Validation / error states
- The only client "validation" is Firebase's own. The page shows exactly one error string: **"Invalid email or password."** whenever `authenticate` returns `null` (`page.tsx:41-43`).
- `authenticate` swallows *every* failure into `null` via a bare `catch {}` (`accounts.ts:90-92`) — wrong password, unknown user, malformed email, and **network errors** all collapse to the same message. (The richer `messageForCode` map in `accounts.ts:36-49` is used by `signup`, **not** by `authenticate`.)
- Submitting empty fields is not blocked in the UI; it calls Firebase and returns the same generic error.

---

## Key flows & logic

### `signIn()` — the submit pipeline (`page.tsx:36-46`)

```tsx
const signIn = async () => {
  setError("");                                  // 1. clear any prior error
  setEntering(true);                             // 2. lock button → "Entering…"
  const user = await authenticate(email, password);  // 3. Firebase Auth + profile
  if (!user) {                                   // 4a. failure path
    setError("Invalid email or password.");
    setEntering(false);
    return;
  }
  go(user.role, user.industryId);                // 4b. success → route
};
```

### `authenticate()` — what step 3 does (`accounts.ts:77-93`)
1. Normalize email: `email.trim().toLowerCase()` (`accounts.ts:78`).
2. `signInWithEmailAndPassword(auth, e, password)` (`accounts.ts:80`) — throws on bad credentials → caught → `null`.
3. `getDoc(doc(db, "users", cred.user.uid))` to fetch the profile (`accounts.ts:81`).
4. Build and return an `Account` (`accounts.ts:83-89`) with **fallbacks** if the profile doc is missing/partial:
   - `name` → profile name, else `cred.user.email`, else the typed email.
   - `role` → profile role, else **`"etp"`** (least-privileged default).
   - `industryId` → profile value, else `null`.

### `go()` — the routing bridge (`page.tsx:30-34`)

```tsx
const go = (role: RoleId, industryId: string | null) => {
  setEntering(true);
  login(role, industryId);                       // optimistic session in useAuthStore
  setTimeout(() => router.push("/dashboard"), 500);  // ~500 ms, then navigate
};
```
- `login(role, industryId)` sets `{ role, industryId, isAuthed: true, authReady: true }` (`auth.ts:37`) so the dashboard shell renders immediately instead of flashing its loading screen.
- The **500 ms `setTimeout`** is a deliberate transition delay while the button reads "Entering…". `entering` is **not** reset on the success path — the component unmounts on navigation, so the button stays disabled through the hand-off.
- Navigation uses `router.push` (not `replace`), so `/login` remains in history and the browser Back button returns here.

### End-to-end
```
type creds → click "Sign In"
        └─ signIn()  → authenticate()  → Firebase Auth + users/{uid}
                          ├─ null → show "Invalid email or password." (re-enable button)
                          └─ Account → go(role, industryId)
                                          ├─ useAuthStore.login(role, industryId)   (optimistic)
                                          └─ setTimeout 500ms → router.push("/dashboard")
                                                                     │
   (in parallel) Firebase onAuthStateChanged fires in StoreHydrator ─┘
        → re-reads users/{uid}, setSession(authoritative), loads per-tenant slice
```

---

## Edge cases & gotchas

- **No Enter-to-submit.** Because there is no `<form>` wrapper, pressing Enter in the email/password inputs does nothing — the user must click the **Sign In** button (`page.tsx:137-138`).
- **All auth failures look identical.** Network outages, unknown users, and wrong passwords all render "Invalid email or password." because `authenticate` catches everything into `null` (`accounts.ts:90-92`). No spinner-independent network message is surfaced here.
- **Optimistic vs authoritative role.** `go()`/`login()` trusts the `role` returned by `authenticate`, which itself falls back to `"etp"` when the profile doc is missing (`accounts.ts:87`). The authoritative correction comes from `StoreHydrator`'s `onAuthStateChanged` → `setSession` (`store-hydrator.tsx:79-86`); if the profile truly has no `industryId`, an `etp` user lands authenticated-but-unbound and the hydrator loads `emptyData()` (`store-hydrator.tsx:119-122`).
- **Already-authenticated users are not bounced.** Revisiting `/login` while logged in still shows the form (no guard effect on this page); signing in again just re-runs the flow.
- **`entering` never resets on success.** Intentional — relies on unmount during `router.push`. If navigation were somehow cancelled, the button would remain stuck on "Entering…".
- **Demo credentials are displayed in plaintext** on the page (`page.tsx:147-155`) — appropriate for the demonstration prototype, not for production.
- **Email is normalized, password is not.** `authenticate` lowercases/trims the email (`accounts.ts:78`) but passes the password verbatim, so leading/trailing spaces in a password are significant.

---

## Related files

| File | Why it matters |
| --- | --- |
| `app/login/page.tsx` | This page. |
| `lib/store/accounts.ts` | `useAccountsStore.authenticate` (Firebase sign-in + `users/{uid}` profile fetch); also `signup` used by `/register`. |
| `lib/store/auth.ts` | `useAuthStore` — `login` (optimistic, `:37`), `setSession` (authoritative, `:33-36`), `logout`, plus `isAdmin`/`isEtp` helpers (`:52-53`). |
| `components/shared/store-hydrator.tsx` | `onAuthStateChanged` restores the real session and loads the role-scoped per-tenant dataset. |
| `components/dashboard/dashboard-shell.tsx` | The gate that redirects unauthenticated visitors back to `/login` and enforces `canAccessPath`. |
| `lib/constants.ts` | `canAccessPath` (`:65-72`), `ADMIN_ONLY_PATHS`, `ETP_ONLY_PATHS` — the per-role route matrix. |
| `lib/types.ts` | `RoleId = "monitoring-admin" \| "etp"` (`:5`). |
| `app/register/page.tsx` | The "Register Unit" / "Register a unit" destination linked from this page. |
| `components/shared/logo.tsx` | `JalRakshakLogo` used in both panels. |
| `lib/firebase.ts` | Exposes `auth` and `db` consumed by `authenticate`. |
