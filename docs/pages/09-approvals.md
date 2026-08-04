# `/dashboard/approvals` — Approval Workflow

> Route: `/dashboard/approvals` · File: `app/dashboard/approvals/page.tsx` · Roles: **monitoring-admin only** (RSPCB "Monitoring Body") · Rendered by: `ApprovalsPage` (default export), wrapped in `DashboardShell` via `app/dashboard/layout.tsx`.

---

## Purpose

The Approvals page is the RSPCB regulator's **verification queue**. Every submission that enters the system — a CETP flow-meter reading (`submitReading`) or an individual-ETP daily water-balance entry (`submitEtpEntry`) — creates a matching `Approval` record at stage `"submitted"`. This page lets the Monitoring Body triage those records and **Approve** or **Reject** each one before it becomes part of the compliance record.

Each card surfaces the evidence the reviewer needs to decide: the submitting unit, meter point, submission timestamp, whether a **photo** was attached, the **difference/volume** (rendered in display units), any **auto-raised alert chips** captured at submission time, operator **remarks**, and a **progress timeline**. The decision (`decideApproval`) propagates the chosen status back onto the underlying reading/entry and, on rejection, raises a fresh `rejected-entry` alert to the Monitoring Body.

The page header states the intent directly (`page.tsx:58-62`):

- eyebrow `"Governance"`, title `"Approval Workflow"`
- description: *"Verify submitted readings against photos, differences and auto-raised alerts before they enter the compliance record."*

---

## Access & gating

This is an **admin-only** route. Gating is enforced in two layers, both keyed off `canAccessPath` (`lib/constants.ts:65-72`):

1. **Navigation visibility** — the sidebar item is declared with `roles: ADMIN` (`lib/constants.ts:49`), where `ADMIN = ["monitoring-admin"]` (`lib/constants.ts:41`). ETP operators never see the "Approvals" link (group `"Governance"`).

2. **Route redirect** — `DashboardShell` runs an effect on every navigation (`components/dashboard/dashboard-shell.tsx:21-31`):
   ```ts
   if (!authReady) return;
   if (!role) { router.replace("/login"); return; }
   if (!canAccessPath(role, pathname)) router.replace("/dashboard");
   ```
   `/dashboard/approvals` is in `ADMIN_ONLY_PATHS` (`lib/constants.ts:54-61`). `canAccessPath` returns `!inAdmin` for the `etp` role, so an ETP operator who deep-links here is bounced to `/dashboard`. A monitoring-admin passes (`inEtp` is false). The match is segment-aware (`pathname === p || pathname.startsWith(p + "/")`), so `/dashboard/approvals` is covered exactly.

Until Firebase reports the initial auth state (`authReady`) the shell renders a loading splash instead of the page (`dashboard-shell.tsx:33-43`), so the page body never renders for an unauthenticated or role-less user.

> **Note:** This is a client-side gate only. The real security boundary for the persisted data is `firestore.rules` (per-tenant isolation); the redirect is UX, not enforcement. Because monitoring-admin is the "sees everything" role, its store contains all tenants' approvals (hydrated by `components/shared/store-hydrator.tsx`).

---

## Data — store reads & writes

All reads are Zustand selector subscriptions:

| Binding | Source | File:line |
|---|---|---|
| `approvals` | `useDataStore((s) => s.approvals)` | `page.tsx:25` |
| `decide` | `useDataStore((s) => s.decideApproval)` | `page.tsx:26` |
| `role` | `useAuthStore((s) => s.role)` | `page.tsx:27` |

Derived / local state:

- **`reviewer`** — `(ROLES.find((r) => r.id === role)?.name) ?? "Inspector"` (`page.tsx:28`). For `monitoring-admin` this resolves to **`"Monitoring Body"`** (`lib/constants.ts:13`); `"Inspector"` is only a fallback if `role` were null (which the gate prevents). This string is stamped onto the approval as `reviewer` and shown in the toast.
- **`tab`** — `useState<...>("queue")` (`page.tsx:29`); one of `queue | approved | rejected | all`.
- **`filtered`** — memoized on `[approvals, tab]` (`page.tsx:31-37`).
- **`counts`** — memoized on `[approvals]` (`page.tsx:39-46`).

**The only write** on this page is `decideApproval(id, decision, reviewer)` (defined in `lib/store/data.ts:321-376`), invoked by the `handle` callback. Its effects are detailed in [Key flows & logic](#key-flows--logic). The mutation flows through the Zustand `persist` middleware backed by `firestoreStorage` (`lib/store/data.ts:440-449`), which shards the write per tenant.

---

## Layout & sections

The page is a vertical stack (`space-y-6`). In render order:

### 1. Page header (`page.tsx:58-62`)
`PageHeader` with the governance eyebrow, title, and description above.

### 2. Tab bar (`page.tsx:64-82`)
A wrap-friendly row of four pill buttons from the `TABS` constant (`page.tsx:17-22`):

| Tab key | Label | Filter predicate | Count badge |
|---|---|---|---|
| `queue` | Queue | `stage === "submitted" \|\| stage === "verification"` | `counts.queue` |
| `approved` | Approved | `stage === "approved"` | `counts.approved` |
| `rejected` | Rejected | `stage === "rejected"` | `counts.rejected` |
| `all` | All | *(no filter)* | *(no badge)* |

- The active tab gets `bg-primary/15 text-primary ring-1 ring-primary/30`; inactive tabs are muted with a hover background (`page.tsx:69-72`).
- Each tab except `all` renders a bold count pill (`page.tsx:75-79`). The count shown is picked by `t.key` (`queue → counts.queue`, `approved → counts.approved`, else `counts.rejected`).

### 3. Cards grid (`page.tsx:84-161`)
A responsive grid, `grid gap-4 xl:grid-cols-2` (one column on small screens, two from the `xl` breakpoint), wrapped in `<AnimatePresence mode="popLayout">` so cards animate in/out and re-flow when a decision moves a card between tabs.

For each approval `a` in `filtered`, a `motion.div` card (`layout`, keyed on `a.id`, `initial → animate → exit`) contains, top to bottom:

**a. Header row (`page.tsx:98-106`)**
- `a.industryName` (bold, truncated).
- Sub-line: `` `${a.meterPoint} · ${formatDate(a.submittedAt, true)}` `` — meter point plus date+time.
- `<StatusBadge status={a.stage} />` on the right. Tone mapping (`components/shared/status-badge.tsx:14-37`): `submitted → info (blue)`, `verification → info (blue)`, `approved → success (green)`, `rejected → danger (red)`. The badge capitalizes and replaces hyphens with spaces.

**b. Photo tile + Difference (`page.tsx:108-120`)**
- **Photo tile:** if `a.hasPhoto` → `ImageIcon` + "Photo" in muted styling; else `ImageOff` + "No photo" on an **amber dashed** tile (`border-dashed border-amber-500/40 ...`) to flag the gap.
- **Difference panel:** label "Difference" over `` `${formatNumber(a.difference)} ${displayUnit(a.unit)}` `` in a large mono figure. For an ETP water-balance approval, `difference` is the day's **Total Water Intake** and `unit` is `"KL"`, so it displays as **m³** (see [Units & formatting](#units--formatting)).

**c. Alert chips (`page.tsx:122-132`)**
Rendered only when `a.alerts.length > 0`. Each `AlertType` in `a.alerts` becomes a colored chip driven by `ALERT_META[t]` (`lib/constants.ts:93-106`): background `${color}1a` (~10% alpha), text/icon in `color`, a lucide icon via `<Icon name={ALERT_META[t].icon} />`, and the human `label`. These are the alerts **frozen at submission time** on the approval snapshot — not the live `alerts` array.

**d. Remarks (`page.tsx:134`)**
Rendered only when `a.remarks` is truthy, as a quoted muted block. Flow readings carry the operator's free-text remark; ETP-entry approvals always carry the fixed string `"Daily ETP water-balance entry."` (`lib/store/data.ts:268`).

**e. Timeline (`page.tsx:137-139`)**
`<ApprovalTimeline steps={a.timeline} />` inside a top-bordered section — see [ApprovalTimeline](#approvaltimeline-component).

**f. Actions / decision footer (`page.tsx:142-156`)**
- If **not decided** (`decided = stage === "approved" || stage === "rejected"` is false, i.e. still in queue): two buttons —
  - **Approve** — emerald filled, `Check` icon → `handle(a.id, a.industryName, "approved")`.
  - **Reject** — red outline, `X` icon → `handle(a.id, a.industryName, "rejected")`.
- If **already decided**: a muted line — `` `${stage === "approved" ? "Approved" : "Rejected"} by <reviewer> · ${formatDate(a.reviewedAt, true)}` ``. The action buttons are gone, so a decided card **cannot be re-decided from the UI**.

### 4. Empty state (`page.tsx:163-168`)
When `filtered.length === 0`, a dashed-border panel with a `Camera` icon and *"Nothing here — the queue is clear."* replaces the grid content.

---

## Forms & validation

**This page has no form.** It is a read-and-decide surface. The only user inputs are (a) the four tab buttons and (b) the per-card Approve/Reject buttons. There are no text fields, no Zod schema, and no client-side validation on this route — validation lived upstream at submission time (`etp-entry` / reading forms). Each decision is a single click with **no confirmation dialog and no undo**.

---

## Key flows & logic

### Filtering & sorting (`page.tsx:31-37`)
```ts
const sorted = [...approvals].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
if (tab === "queue") return sorted.filter(a => a.stage === "submitted" || a.stage === "verification");
if (tab === "approved") return sorted.filter(a => a.stage === "approved");
if (tab === "rejected") return sorted.filter(a => a.stage === "rejected");
return sorted; // "all"
```
Approvals are sorted **newest-first** by `submittedAt` using `localeCompare` on the ISO string (ISO timestamps from `nowISO()` are lexicographically ordered, so this is a valid chronological sort). The tab then narrows by `stage`.

### Counts (`page.tsx:39-46`)
Computed from the full `approvals` array (not `filtered`), so badges are stable regardless of the active tab:
- `queue` = count of `submitted`/`verification`
- `approved` = count of `approved`
- `rejected` = count of `rejected`

These mirror `selectMetrics` (`lib/store/data.ts:473-481`), where `pendingApprovals` uses the same `submitted || verification` predicate — so the dashboard's "pending approvals" tile agrees with this page's Queue badge.

### The `handle` decision pipeline (`page.tsx:48-54`)
```ts
const handle = (id, name, decision) => {
  decide(id, decision, reviewer);
  toast[decision === "approved" ? "success" : "error"](
    decision === "approved" ? "Reading approved" : "Reading rejected",
    { description: `${name} · by ${reviewer}` },
  );
};
```
1. Calls `decide(id, decision, reviewer)` → mutates the store.
2. Fires a Sonner toast — green `success` for approve, red `error` for reject — with the unit name and reviewer in the description.

Because the store update re-runs `filtered`/`counts`, the decided card animates out of the **Queue** tab (its stage is no longer submitted/verification) and appears under **Approved**/**Rejected**/**All**, all handled by `AnimatePresence`.

### `decideApproval` — the store action (`lib/store/data.ts:321-376`)

Signature: `decideApproval(id, decision: "approved" | "rejected", reviewer)`.

```ts
const reviewedAt = nowISO();
set((s) => {
  const approval = s.approvals.find((a) => a.id === id);
  const stage: ApprovalStage = decision;
  const extraAlerts = decision === "rejected" && approval ? [ /* rejected-entry alert */ ] : [];
  return {
    approvals:  s.approvals.map(...),   // update the matched approval
    readings:   s.readings.map(...),    // propagate status to the reading
    etpEntries: s.etpEntries.map(...),  // propagate status to the ETP entry
    alerts:     [...extraAlerts, ...s.alerts],
  };
});
```

It writes **four** slices in one atomic `set`:

1. **`approvals`** (`data.ts:346-366`) — the approval whose `id` matches gets `stage`, `reviewedAt`, `reviewer`, and a **rebuilt 3-step `timeline`**: step 0 (`submitted`) forced `done: true`; a `verification` step now `done: true` stamped with `reviewedAt`/`reviewer`; and a final step whose `stage`/`label` is `"approved"/"Approved"` or `"rejected"/"Rejected"`, also `done: true`. All other approvals pass through unchanged.

2. **`readings`** (`data.ts:367-369`) — any reading with `r.id === approval.readingId` gets `status: decision`. For a flow-meter approval, `readingId` is the `R-…` id, so the reading's `ReadingStatus` flips to `approved`/`rejected`.

3. **`etpEntries`** (`data.ts:370-372`) — any entry with `e.id === approval.readingId` gets `status: decision`. For an ETP water-balance approval, `readingId` is the `E-…` id, so the entry flips. Because `readingId` targets one namespace, exactly one of steps 2/3 matches and the other map is a no-op.

4. **`alerts`** (`data.ts:373`) — `extraAlerts` are prepended. On **rejection only**, a new `rejected-entry` alert is built (`data.ts:326-343`): severity from `ALERT_META["rejected-entry"]` (**high**, `lib/constants.ts:105`), scoped to the approval's `industryId`/`industryName`/`cetpId`, message *"Reading at `<meterPoint>` for `<industry>` was rejected by `<reviewer>`."*, `status: "active"`, `relatedReadingId: approval.readingId`. **Approval raises no alert.**

### ApprovalTimeline component

`components/dashboard/approval-timeline.tsx` renders the horizontal stepper from `Approval.timeline` (`ApprovalStep[]`).

- **Icons by stage** (`timeline.tsx:7`): `submitted → Send`, `verification → Search`, `approved → Check`, `rejected → X` (fallback `Check`).
- **Per-step color** (`timeline.tsx:16`): `rejected → #f87171` (red); else `done → #22d3ee` (cyan); else `#475569` (slate/incomplete).
- A **done** step gets a tinted fill (`${color}1f`), a colored ring, and a glow `boxShadow`; the label turns `--foreground` (vs `--muted-foreground` when not done) (`timeline.tsx:20-28`).
- **Connectors** between nodes (`timeline.tsx:30-32`) are cyan `#22d3ee` when **the next step is `done`**, otherwise the neutral `--border`.

At submission the timeline is `[Submitted(done), Under Verification(pending), Approved(pending)]` (`data.ts:195-199`). After `decideApproval` all three steps are `done`, with the third relabeled to the decision.

---

## Units & formatting

- **Difference / volume** is `formatNumber(a.difference)` + `displayUnit(a.unit)`. `formatNumber` uses the `en-IN` locale (`lib/utils.ts:8-10`); `displayUnit` maps stored **`"KL"` → displayed `"m³"`** and passes anything else through unchanged (`lib/utils.ts:17`). So ETP water-balance approvals (`unit: "KL"`) show **m³**; an `Energy Meter` reading would show its own unit (e.g. `kWh`) verbatim.
- This is a display transform only — the stored value/unit are untouched; `difference`/`totalWaterIntake` remain in KL in the store.
- **No KLD here.** Capacities (rendered as `KLD` elsewhere via `formatKLD`) are not shown on this page; the only quantity is the per-submission difference/intake in m³.
- **Dates** use `formatDate(iso, true)` → `en-IN` `dd Mon yyyy, hh:mm` (`lib/utils.ts:23-33`); a null date renders `"—"`.

---

## Edge cases & gotchas

1. **`"verification"` stage is effectively dead as an approval *stage*.** New approvals are created at `"submitted"` and go straight to `approved`/`rejected`; nothing sets an approval's `stage` to `"verification"`. `verification` only ever appears as a completed **timeline step** after a decision. The Queue filter and `selectMetrics` still include it defensively (`page.tsx:33`, `data.ts:476`), but in practice no live approval sits at that stage.

2. **One `Approval` fronts either a reading or an ETP entry.** `decideApproval` blindly maps both `readings` and `etpEntries` by `approval.readingId`; the id namespaces (`R-…` vs `E-…`) ensure only the correct slice flips. If a future id scheme collided across namespaces, both could flip.

3. **Rejection alert vs. `industry.alertsCount` drift.** Submission paths increment `industry.alertsCount` (`data.ts:207`, `data.ts:286`), but `decideApproval`'s rejection alert is prepended to `alerts` **without** bumping the owning industry's `alertsCount`. So the per-industry counter can under-count relative to the live `alerts` array.

4. **Approval is non-destructive to prior alerts.** Approving does not resolve or acknowledge alerts raised at submission (e.g. a `missing-photo` or `capacity-exceeded` alert stays `active`). Alert lifecycle is handled separately on `/dashboard/alerts` via `acknowledgeAlert`/`resolveAlert`.

5. **Timeline connector color on rejection.** The connector into the final node keys on `steps[i+1].done`, not on whether it's a rejection (`timeline.tsx:31`). After a rejection the third step is `done: true`, so the line into it renders **cyan**, while only the node icon turns **red**. Cosmetic, but the connector doesn't "go red" on reject.

6. **Chips are a submission-time snapshot.** `a.alerts` (an `AlertType[]` stored on the approval) reflects what fired when the record was created; it does not update if the corresponding live alerts are later acknowledged/resolved.

7. **No confirmation / no undo.** A single click on Approve or Reject is committed immediately (store write + toast). Once decided, the buttons are replaced by the "decided by" line, so there is no in-UI path to reverse a decision.

8. **Difference can be negative.** For flow readings `difference = currentReading − previousReading` and is not clamped, so a meter rollback/entry error can render a negative m³ value. ETP-entry approvals use `totalWaterIntake` (a sum of non-negative inputs), so they are ≥ 0.

9. **Reviewer identity is role-derived, not user-derived.** The reviewer string comes from `ROLES.find(...).name` (`"Monitoring Body"`), not the signed-in user's display name — every admin's decisions are attributed identically.

10. **Cross-tenant scope.** Because this route is admin-only and the admin store is hydrated with all tenants' data, the queue spans every unit. An ETP operator has no equivalent screen (their submissions appear here from the regulator's side).

---

## Related files

| File | Role in this page |
|---|---|
| `app/dashboard/approvals/page.tsx` | The page component (`ApprovalsPage`). |
| `lib/store/data.ts` | `decideApproval` (writes), plus `submitReading`/`submitEtpEntry` that create the approvals, and `selectMetrics`. |
| `components/dashboard/approval-timeline.tsx` | Horizontal stepper for `Approval.timeline`. |
| `components/shared/status-badge.tsx` | Stage badge tone mapping. |
| `components/dashboard/page-header.tsx` | The eyebrow/title/description header. |
| `components/shared/icon.tsx` | Renders lucide icons by name for alert chips. |
| `lib/constants.ts` | `ROLES`, `ADMIN`/`ADMIN_ONLY_PATHS`, `canAccessPath`, `DASHBOARD_NAV`, `ALERT_META`. |
| `lib/utils.ts` | `formatNumber`, `formatDate`, `displayUnit`, `cn`. |
| `lib/types.ts` | `Approval`, `ApprovalStep`, `ApprovalStage`, `AlertType`, `ReadingStatus`. |
| `components/dashboard/dashboard-shell.tsx` | Client-side route gate (`canAccessPath` redirect) + auth-ready splash. |
| `app/dashboard/layout.tsx` | Wraps the page in `DashboardShell` (`theme-dash`). |
| `lib/store/auth.ts` | `role`/`authReady` used for gating and reviewer derivation. |
| `lib/data/firestore-storage.ts` | Per-tenant shard-on-write persistence backing the store mutation. |
| `components/shared/store-hydrator.tsx` | Role-scoped hydration that loads the admin's full approvals set. |
