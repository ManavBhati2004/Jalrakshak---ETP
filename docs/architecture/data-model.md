# Data Model — Types, Seed & Constants

> RSPCB JalRakshak — ETP. The canonical domain vocabulary of the app: every
> TypeScript type, the deterministic mock-data generator that produces the demo
> dataset, and the shared constants (alert metadata, compliance thresholds,
> meter points, roles). This is the "shape" layer that everything else — the
> Zustand store, the per-tenant Firestore sharding, the dashboards, the CSV
> exports — is written against.

---

## Overview

**What it is.** Three files define the entire data vocabulary of JalRakshak:

| File | Responsibility |
|------|----------------|
| `lib/types.ts` | Every domain **type/interface** — the compile-time contract. |
| `lib/constants.ts` | Static **reference tables** — roles, nav, meter points, alert metadata, compliance thresholds, colors. |
| `lib/data/seed.ts` | The **deterministic generator** that fabricates the demo dataset (readings, approvals, alerts, compliance, ETP entries) from a seed list of industries. |
| `data/industries.json` | The **seed industries** — 2 individual-ETP units, the only real "source rows"; everything else is derived from them. |

**Why it exists this way.** The app is client-only (Next.js 16 App Router, no
custom server). It must (1) render identical markup on the server and the client
so React hydration does not mismatch, and (2) bootstrap a believable demo
dataset into Firestore on the first regulator sign-in against an empty project.
Both requirements are met by a **pure, seedable PRNG** (`mulberry32` keyed by
`hashStr(id)`): the same industry id always produces the same readings, on the
server and in the browser, on every run. There is no `Math.random()` and no
`new Date()` in the seed path — the "today" anchor is a frozen literal
(`DEMO_TODAY = "2026-06-20"`).

The types are deliberately **flat and denormalized** (each reading/approval/alert
carries `industryId` + `industryName` + `cetpId`). This is what lets the Zustand
store keep six global arrays while `firestore-storage.ts` shards them per tenant
without any join logic.

---

## Files

### `lib/types.ts`
Pure type declarations, zero runtime code. Exported to the whole codebase as the
domain contract. Grouped into: identity (`RoleId`, `CetpId`), the 3D/flow scene
(`FlowNode*`, `NodeStatus`), the core records (`Industry`, `EtpEntry`,
`FlowMeterReading`), the governance chain (`Approval*`, `ApprovalStage`),
observability (`Alert*`), reporting (`ComplianceRecord`, `TrendPoint`), and
energy (`EnergyLine`, `EnergyData`, `CetpTrends`).

### `lib/constants.ts`
Runtime constant tables plus two pure helpers (`canAccessPath`,
`complianceStatus`). Imports its types from `./types`. This is where
severity → color, alert-type → label/icon, and score → status mappings live, so
the seed and the UI agree on the same metadata.

### `lib/data/seed.ts`
The generator. Imports `industries.json` (typed as `Industry[]`), the two
constants it needs (`complianceStatus`, `ALERT_META`), and every type it emits.
Exports the `industries` array, the `DEMO_TODAY` anchor, and seven `build*`
functions. Consumed by the store's initial-state builder
(`lib/store/data.ts:91-102`) and re-exported through `buildSeedState()`
(`lib/store/data.ts:106-108`) for Firestore bootstrap.

### `data/industries.json`
Two objects, both **individual ETP** units in the Balotra/Pali/Jodhpur belt.
These are the only hand-authored rows; the generator fans them out into hundreds
of derived records. See [Seed industries](#the-two-seed-industries).

---

## How it works

### The generation pipeline

```
data/industries.json  (2 units, hand-authored)
        │
        ▼
lib/data/seed.ts
  industries = industriesRaw as Industry[]           (seed.ts:17)
  DEMO_TODAY = "2026-06-20"                           (seed.ts:19)
        │
        │  each entity is seeded by mulberry32(hashStr(id [+ suffix]))
        │  → server & client produce byte-identical data
        ▼
  buildReadings()            per industry × up to 2 days × 2 shifts
  buildEtpEntries()          per individual-ETP unit × 3 days
  buildApprovals(readings)   from non-approved (+25% of approved) readings
  buildEtpApprovals(entries) from non-approved ETP entries
  buildAlerts(readings)      status/anomaly-driven, capped & sorted → 26
  buildCompliance()          one record per industry (+ synthetic 6-mo trend)
        │
        ▼
lib/store/data.ts  seed() (91-102)  →  StoreData { six flat arrays }
        │
        ├── used directly as the store's initial in-memory state (data.ts:125)
        │
        └── buildSeedState() (106-108)  ─► StoreHydrator bootstraps the
              per-industry Firestore docs on first regulator sign-in
                        │
                        ▼
              lib/data/firestore-storage.ts
                shards StoreData → industries/{industryId}   (one doc per tenant)
                merges the docs the caller may read → StoreData
```

The store keeps its **flat global shape** (six arrays). `firestore-storage.ts`
is the only place that knows about sharding: it splits `StoreData` into an
`IndustrySlice` per industry on write and re-merges the readable slices on load
(`firestore-storage.ts:22-57`). None of the seed types change shape when
persisted — the whole slice is serialized as a `json` string alongside the
`industryId` / `ownerUid` fields the Firestore rules scope on.

### Determinism in detail

- **`mulberry32(seed)`** (`seed.ts:22-30`) — a 32-bit PRNG returning a closure;
  every call advances internal state and returns a float in `[0, 1)`.
- **`hashStr(s)`** (`seed.ts:32-39`) — FNV-1a hash (`offset 2166136261`,
  `prime 16777619`) turning an id into a 32-bit seed. Suffixes namespace the
  streams so the same industry gets *independent* sequences per concern:
  `hashStr(ind.id)` for readings, `hashStr(ind.id + "etp")` for ETP entries,
  `hashStr(ind.id + "comp")` for compliance, `hashStr(r.id)` per approval,
  `hashStr("preview")` for the home-page trend.
- **`dayISO(offsetDays, time)`** (`seed.ts:41-47`) — builds an ISO timestamp
  `offsetDays` **before** `DEMO_TODAY`, in **UTC**. `.slice(0, 10)` yields the
  `YYYY-MM-DD` date string stored on records. Because the anchor is a literal,
  "today" never moves.

### buildReadings — the anomaly engine

Per industry (`seed.ts:58-124`): meter points are `ETP_METER_POINTS` for
individual ETPs else `CETP_METER_POINTS`; day count is **0 if non-reporting, 1
if suspended, else 2** (`seed.ts:69`). A running meter `base` accumulates so
`currentReading > previousReading` and `difference` is realistic. Injected
anomalies drive the alert engine downstream:

| Condition | Effect |
|-----------|--------|
| `rnd() < 0.05` (non-energy) | `zero` — no meter movement (`difference = 0`) |
| `rnd() < 0.08` | `spike` — flow doubled |
| `rnd() < 0.18` | `late` — off-window `readingTime` + `isLate: true` |
| `rnd() > 0.12` | `hasPhoto: true` (≈12% missing) |
| `d === 1 && slot === "20:00"` | forced `pending` (the freshest reading) |
| else `rnd() < 0.08` / `< 0.14` | `rejected` / `pending` |

Energy Meter rows use `unit: "kWh"` and are exempt from zero/anomaly alerting.

### Governance & observability

- **`timeline(...)`** (`seed.ts:129-143`) — builds the 3-step `ApprovalStep[]`
  (Submitted → Under Verification → Approved/Rejected), toggling `done` / `at` /
  `by` from the stage.
- **`buildApprovals`** (`seed.ts:145-184`) — emits an `Approval` for every
  non-approved reading, plus ~25% of approved ones. `alerts[]` are derived
  inline (`late-submission`, `zero-reading`, `missing-photo`). Ids `A-0001…`.
- **`buildEtpApprovals`** (`seed.ts:303-328`) — one `submitted` approval per
  non-approved ETP entry, `meterPoint: "ETP Water Balance"`, `cetpId: null`. Ids
  start at `A-5001` (counter `n = 5000`, unpadded) to **avoid colliding** with
  `buildApprovals`.
- **`buildAlerts`** (`seed.ts:189-235`) — a local `add()` closure stamps each
  alert with `ALERT_META[type].severity` and `.label`. It walks industries for
  `non-reporting` / `rejected-entry` (suspended), then every reading for
  `zero-reading` / `capacity-exceeded` (`diff > permittedKLD`) / `high-flow`
  (`diff > permittedKLD * 0.85`) / `late-submission` / `missing-photo` /
  `rejected-entry`. Finally **sorted by severity and truncated to 26**
  (`seed.ts:233-234`).
- **`buildCompliance`** (`seed.ts:240-260`) — one record per industry; `status`
  via `complianceStatus(score)`, a synthetic 6-month `trend` whose **last point
  is pinned to the real `complianceScore`** (`seed.ts:248`).

### ETP water balance

`buildEtpEntries` (`seed.ts:265-301`) runs only for `isIndividualETP` units, 3
days each, deriving a physically-plausible cascade
(`fresh → etpInlet → etpOutlet → etpReuse / roInlet → roPermeate / roReject →
sludgeToTSDF`). The freshest day (`d === 1`) is `pending`, older days
`approved`. The load-bearing invariant is computed at `seed.ts:293`:

```ts
totalWaterIntake: fresh + etpReuse + roPermeate
```

which matches the type's documented formula (`types.ts:95`).

---

## Reference

### Identity & role types (`lib/types.ts`)

| Type | Line | Definition |
|------|------|------------|
| `RoleId` | 5 | `"monitoring-admin" \| "etp"` |
| `Role` | 7-15 | `{ id: RoleId; name; description; scope; icon; accent; permissions: string[] }` |
| `CetpId` | 17 | `"balotra" \| "jasol" \| "bithuja"` |
| `NodeStatus` | 19 | `"normal" \| "warning" \| "critical"` |
| `FlowNodeType` | 20 | `"raw" \| "treatment" \| "recovery" \| "energy"` |
| `FlowNode` | 22-30 | `{ id; label; short; type: FlowNodeType; value; unit; status: NodeStatus }` |

### `Industry` (`lib/types.ts:38-65`)

The tenant root record. Fields marked **PII** are the cross-tenant leak that
motivated the per-tenant Firestore sharding.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | e.g. `"IND-019"` — the shard key (`industries/{id}`). |
| `name` | `string` | Display name. |
| `ownerName` | `string` | **PII** — proprietor. |
| `area` | `string` | Locality. |
| `address?` | `string` | **PII**, optional — added later; **absent** from both seed units. |
| `contactPerson` | `string` | **PII**; reused as `operatorName` in readings. |
| `mobile` | `string` | **PII**. |
| `email` | `string` | **PII**. |
| `consentNumber` | `string` | **PII** — RPCB consent id. |
| `permittedKLD` | `number` | Permitted daily discharge — the anomaly/threshold basis. |
| `status` | `IndustryStatus` | `"active" \| "pending" \| "suspended" \| "non-reporting"` (32-36). |
| `cetpId` | `CetpId \| null` | `null` ⇒ individual ETP. |
| `isIndividualETP` | `boolean` | Gates ETP-entry generation & meter-point set. |
| `complianceScore` | `number` | Drives compliance record + trend. |
| `etpCapacity` / `roCapacity` / `meeCapacity` | `number` | Plant capacities (KLD). |
| `maxEffluentGeneration?` | `number` | Individual-ETP only. |
| `roStage1?`…`roStage4?` | `number` | Individual-ETP RO stage capacities (KLD). |
| `lastReadingAt` | `string \| null` | ISO timestamp. |
| `alertsCount` | `number` | Surfaced into `ComplianceRecord.alertCount`. |
| `registeredAt` | `string` | Date string. |

### `EtpEntry` (`lib/types.ts:81-99`)

Daily water-balance for one individual-ETP unit. **All volumes are stored in
`"KL"`** (`unit` is the literal `"KL"`) but rendered as **m³** via `displayUnit()`
in `lib/utils.ts`.

`id, industryId, industryName, date, freshWaterConsumption, etpInlet, etpOutlet,
etpReuse, roInlet, roReject, roPermeate, sludgeToTSDF, totalWaterIntake, unit:"KL",
status: ReadingStatus, submittedAt`.

Invariant (`types.ts:95`, produced at `seed.ts:293`):
`totalWaterIntake = freshWaterConsumption + etpReuse + roPermeate`.

### `FlowMeterReading` (`lib/types.ts:103-123`)

`id, industryId, industryName, cetpId, date, readingTime, shift: ReadingShift,
isLate, meterPoint: MeterPoint, previousReading, currentReading, difference, unit,
hasPhoto, operatorName, inspectorName, remarks, status: ReadingStatus, submittedAt`.

Supporting: `MeterPoint` (67-77, **10** values), `ReadingStatus` (79,
`"pending" \| "approved" \| "rejected"`), `ReadingShift` (101,
`"morning" \| "evening"`).

### Approval chain (`lib/types.ts:125-156`)

| Type | Line | Definition |
|------|------|------------|
| `ApprovalStage` | 125-129 | `"submitted" \| "verification" \| "approved" \| "rejected"` |
| `ApprovalStep` | 131-137 | `{ stage: ApprovalStage; label; at: string\|null; by: string\|null; done: boolean }` |
| `Approval` | 139-156 | `{ id, readingId, industryId, industryName, cetpId, meterPoint, difference, unit, hasPhoto, remarks, stage, submittedAt, reviewedAt, reviewer, alerts: AlertType[], timeline: ApprovalStep[] }` |

### Alerts (`lib/types.ts:158-184`)

`AlertType` (158-167) — **exactly 9 values**:
`late-submission`, `zero-reading`, `high-flow`, `capacity-exceeded`,
`non-reporting`, `reading-mismatch`, `repeated-reading`, `missing-photo`,
`rejected-entry`.

`AlertSeverity` (169): `"low" \| "medium" \| "high" \| "critical"`.
`AlertStatus` (170): `"active" \| "acknowledged" \| "resolved"`.

`Alert` (172-184):
`{ id, type: AlertType, severity: AlertSeverity, industryId: string\|null,
industryName: string\|null, cetpId: CetpId\|null, title, message, createdAt,
status: AlertStatus, relatedReadingId: string\|null }`.

### Compliance & trends (`lib/types.ts:186-203`)

- `ComplianceStatus` (186): `"compliant" \| "warning" \| "non-compliant"`.
- `TrendPoint` (188-192): `{ label: string; value?: number; [key: string]: string | number | undefined }` — the **index signature** lets a point carry arbitrary series keys (used by `buildPreviewTrends`, which adds `wastewater`/`compliance`/`flow` instead of `value`).
- `ComplianceRecord` (194-203): `{ industryId, industryName, cetpId, score, status: ComplianceStatus, submissionRate, alertCount, trend: TrendPoint[] }`.

### Energy types (`lib/types.ts:205-227`)

| Type | Line | Definition |
|------|------|------------|
| `EnergyLine` | 205-214 | `{ id, name, voltage, consumptionKWh, demandKVA, powerFactor, cetpId: CetpId\|string, status: NodeStatus }` |
| `EnergyData` | 216-220 | `{ lines: EnergyLine[]; dailyTrend: TrendPoint[]; consumptionByStage: TrendPoint[] }` |
| `CetpTrends` | 222-227 | `{ cetpId: CetpId; wastewater: TrendPoint[]; compliance: TrendPoint[]; flow: TrendPoint[] }` |

> Note: energy and `CetpTrends` types are declared but **not populated by the
> seed** — no `build*` function emits them, and both seed units are individual
> ETPs (`cetpId: null`), so the CETP-oriented types are effectively vestigial in
> the current dataset.

---

### Seed exports & functions (`lib/data/seed.ts`)

| Export | Line | Returns / role |
|--------|------|----------------|
| `industries` | 17 | `industriesRaw as Industry[]` — the 2 seed units. |
| `DEMO_TODAY` | 19 | `"2026-06-20"` — frozen "today" anchor. |
| `buildReadings()` | 58-124 | `FlowMeterReading[]` — per industry × ≤2 days × 2 shifts. |
| `buildApprovals(readings)` | 145-184 | `Approval[]` — from non-approved (+~25% approved) readings; ids `A-0001…`. |
| `buildAlerts(readings)` | 189-235 | `Alert[]` — status/anomaly driven; sorted by severity, **capped at 26**. |
| `buildCompliance()` | 240-260 | `ComplianceRecord[]` — one per industry, trend last point pinned to score. |
| `buildEtpEntries()` | 265-301 | `EtpEntry[]` — individual-ETP units × 3 days. |
| `buildEtpApprovals(entries)` | 303-328 | `Approval[]` — `submitted`, `meterPoint:"ETP Water Balance"`, ids `A-5001…`. |
| `buildPreviewTrends()` | 331-339 | 12 weekly `{label, wastewater, compliance, flow}` points for the home page. |

Internal (not exported): `mulberry32` (22), `hashStr` (32), `dayISO` (41),
`timeline` (129), and the constants `MONTHS` (49), `WEEKS` (50),
`CETP_METER_POINTS` (52, 6 points), `ETP_METER_POINTS` (53, 4 points).

### The two seed industries (`data/industries.json`)

| Field | IND-019 | IND-020 |
|-------|---------|---------|
| `name` | Pali Road Processors | Jodhpur Textile Park Unit-12 |
| `ownerName` | Subhash Chandra Verma | Anil Kumar Tater |
| `area` | Industrial Outskirts, Pali Road | Standalone ETP Zone, Jodhpur Road |
| `consentNumber` | RPCB/CTO/2021/03012 | RPCB/CTO/2020/02455 |
| `permittedKLD` | 300 | 250 |
| `status` | active | active |
| `cetpId` | `null` | `null` |
| `isIndividualETP` | `true` | `true` |
| `complianceScore` | 80 | 84 |
| `etpCapacity` / `roCapacity` / `meeCapacity` | 340 / 220 / 70 | 290 / 190 / 60 |
| `maxEffluentGeneration` | 300 | 250 |
| `roStage1…4` | 220 / 150 / 95 / 55 | 190 / 130 / 80 / 45 |
| `alertsCount` | 1 | 0 |
| `registeredAt` | 2021-04-09 | 2020-06-15 |

Both are `active` individual ETPs → both get ETP entries; **neither is
non-reporting or suspended**, so `buildReadings` produces the full 2 days for
each, and **neither carries the optional `address` field**.

---

### Constants (`lib/constants.ts`)

| Constant | Line | Value / role |
|----------|------|--------------|
| `APP_NAME` | 3 | `"RSPCB JalRakshak"` |
| `APP_TAGLINE` | 4-5 | RSPCB – Balotra initiative line. |
| `ROLES` | 8-27 | Two `Role` objects (see below). |
| `ADMIN_ROLE` | 29 | `"monitoring-admin"`. |
| `DASHBOARD_NAV` | 44-52 | Nav items with per-role visibility. |
| `ADMIN_ONLY_PATHS` | 54-61 | 6 admin routes (incl. `/dashboard/reports`). |
| `ETP_ONLY_PATHS` | 62 | `["/dashboard/etp-entry"]`. |
| `canAccessPath(role, path)` | 65-72 | Segment-aware gate (`/dashboard/etp` must **not** swallow `/dashboard/etp-entry`). |
| `METER_POINTS` | 75-85 | **9** CETP meter points (excludes `"ETP Water Balance"`). |
| `READING_TIMES` | 87-90 | `08:00` morning / `20:00` evening. |
| `ALERT_META` | 93-106 | Per-`AlertType` `{label, icon, severity, color}`. |
| `SEVERITY_COLOR` | 108-113 | `low #94a3b8 · medium #fbbf24 · high #fb923c · critical #ef4444`. |
| `COMPLIANCE` | 116-119 | `{ compliant: 85, warning: 70 }`. |
| `complianceStatus(score)` | 121-125 | `≥85 compliant · ≥70 warning · else non-compliant`. |
| `STATUS_COLOR` | 127-131 | `compliant #10b981 · warning #f59e0b · non-compliant #ef4444`. |
| `HERO_STATS` | 134-139 | Landing counters (`2` ETP Units, `7-stage`, `250+`, `24×7`). |

**`ROLES` (constants.ts:8-27)**

| id | name | scope | accent | permissions |
|----|------|-------|--------|-------------|
| `monitoring-admin` | Monitoring Body | Super Admin · Sees Everything | `#6366f1` | `["*"]` |
| `etp` | ETP | Individual ETP · Water Balance | `#0d9488` | `["submit","view-own","register"]` |

**`ALERT_META` (constants.ts:93-106)** — the single source of truth for
alert severity, mirrored by `buildAlerts`:

| type | label | severity | color |
|------|-------|----------|-------|
| `late-submission` | Late Submission | medium | `#f59e0b` |
| `zero-reading` | Zero Reading | high | `#f87171` |
| `high-flow` | High Flow | high | `#fb923c` |
| `capacity-exceeded` | Capacity Exceeded | **critical** | `#ef4444` |
| `non-reporting` | Non Reporting | high | `#f87171` |
| `reading-mismatch` | Reading Mismatch | medium | `#fbbf24` |
| `repeated-reading` | Repeated Reading | medium | `#fbbf24` |
| `missing-photo` | Missing Photo | **low** | `#94a3b8` |
| `rejected-entry` | Rejected Entry | high | `#f87171` |

---

## Gotchas & invariants

1. **`DEMO_TODAY` is frozen at `"2026-06-20"` (seed.ts:19).** All seed dates are
   computed relative to it in **UTC**, and the reports layer hard-codes a
   matching `TODAY` literal. Nothing tracks the real clock; "advancing the day"
   requires editing the literal(s).

2. **`totalWaterIntake = freshWaterConsumption + etpReuse + roPermeate`**
   (types.ts:95, seed.ts:293). Any code writing `EtpEntry`s must preserve this;
   dashboards read it directly.

3. **Volumes are stored `"KL"`, displayed m³.** `EtpEntry.unit` is the literal
   `"KL"`; UI renders via `displayUnit()` (`lib/utils.ts`). Capacities
   (`permittedKLD`, `etpCapacity`, …) are KLD.

4. **`MeterPoint` type has 10 values; `METER_POINTS` constant has 9.** The
   missing one is `"ETP Water Balance"` (types.ts:77) — it is a *synthetic*
   meter point used only by `buildEtpApprovals` (seed.ts:315), never a real flow
   meter, so it is correctly excluded from the operator-facing `METER_POINTS`
   list (constants.ts:75-85).

5. **Approval id namespaces must not collide.** `buildApprovals` emits
   `A-0001…` (4-digit padded); `buildEtpApprovals` emits `A-5001…` (unpadded,
   counter seeded to `5000`). Keep them disjoint if you change either.

6. **Alerts are capped at 26 and severity-sorted** (seed.ts:233-234). Adding
   alert sources does not grow the list past 26; low-severity items drop off
   first.

7. **`non-reporting` alerts have only one source: the seed** (seed.ts:210-212).
   `buildReadings` produces **0** readings for a `non-reporting` industry
   (seed.ts:69), so no reading-derived path can ever regenerate that alert type.

8. **The comment "three" in constants.ts:7 is stale** — `ROLES` contains **two**
   roles. The "(demo, no real auth)" note is also historical: auth is now live
   Firebase email/password; the array is just the role catalog.

9. **CETP types are declared but unseeded.** Both seed units are individual ETPs
   with `cetpId: null`, so `CetpId`, `CETP_METER_POINTS`, `EnergyLine`,
   `CetpTrends`, etc. are present in the type system but produce no data in the
   current dataset.

10. **Determinism is load-bearing for SSR + Firestore bootstrap.** Every random
    draw flows from `mulberry32(hashStr(id [+ suffix]))`. Introducing
    `Math.random()` or `new Date()` into the seed path would break React
    hydration and make the bootstrapped tenant docs non-reproducible.

---

## Related files

- `lib/store/data.ts` — `seed()` (91-102) assembles the six-array `StoreData`; `buildSeedState()` (106-108) exposes it for Firestore bootstrap; the store's live actions (`submitReading`, `submitEtpEntry`, `registerIndustry`, `decideApproval`, …) mutate these same types.
- `lib/data/firestore-storage.ts` — shards `StoreData` into `industries/{industryId}` docs (`IndustrySlice`) on write and merges readable slices on load; the per-tenant boundary.
- `components/shared/store-hydrator.tsx` — role-scoped hydration; bootstraps the seed into an empty project on first regulator sign-in.
- `lib/utils.ts` — `displayUnit()` (KL → m³ display), formatting helpers.
- `lib/data/etp-flow.ts` — builds the `FlowNode[]` 3D scene from an `Industry`.
- `firestore.rules` — server-side isolation keyed on `industryId` / `ownerUid`.
- `CLAUDE.md` — full architecture overview.
