# JalRakshak ETP — Documentation

Detailed, per-page and per-system documentation for the **RSPCB JalRakshak — ETP** platform. Start with the repo-root [`CLAUDE.md`](../CLAUDE.md) for the high-level architecture and conventions; use the docs below for depth on a specific page or system.

All docs reflect the **current per-tenant Firestore architecture** (one `industries/{id}` document per unit, `users/{uid}` profiles, two roles: `monitoring-admin` and `etp`) and cite real `file:line` references.

## 📄 Pages (one per route)

| Route | Doc | What it covers |
|---|---|---|
| `/` | [pages/01-landing](pages/01-landing.md) | Public scroll landing: pinned 320vh hero, lazy 3D `RiverScene` + static fallback, `ScrollOverlay`, home sections |
| `/login` | [pages/02-login](pages/02-login.md) | Sign-in-only screen; show/hide password; demo accounts; `authenticate()` → dashboard |
| `/register` | [pages/03-register](pages/03-register.md) | Public self-registration: fields incl Address, input filters, password checklist, the full onSubmit pipeline |
| `/dashboard` | [pages/04-dashboard-overview](pages/04-dashboard-overview.md) | Role split — `AdminOverview` vs `EtpOverview` (incl the date-keyed today-vs-yesterday intake card) |
| `/dashboard/etp-entry` | [pages/05-etp-entry](pages/05-etp-entry.md) | ETP daily water-balance form: total-intake auto-calc, ETP-inlet≤capacity block, "every field < Fresh Water" rule, `submitEtpEntry` |
| `/dashboard/etp` | [pages/06-etp-units](pages/06-etp-units.md) | Admin master/detail of ETP units: capacities (KLD), latest balance (m³), pipeline, history, CSV |
| `/dashboard/industries` | [pages/07-industries](pages/07-industries.md) | Admin registry table + status chips + detail dialog + Register Member CTA |
| `/dashboard/industries/register` | [pages/08-industries-register](pages/08-industries-register.md) | Admin lean onboarding form (contrast with public `/register`) |
| `/dashboard/approvals` | [pages/09-approvals](pages/09-approvals.md) | Approve/reject workflow, tabs, `ApprovalTimeline`, `decideApproval` |
| `/dashboard/alerts` | [pages/10-alerts](pages/10-alerts.md) | Alert Center: severity tiles, Ack/Resolve, the 9 alert types |
| `/dashboard/compliance` | [pages/11-compliance](pages/11-compliance.md) | Compliance scorecards + thresholds (≥85 / 70–84 / <70) |
| `/dashboard/reports` | [pages/12-reports](pages/12-reports.md) | CSV export hub; `toCSV` formula-injection hardening |
| `/dashboard/settings` | [pages/13-settings](pages/13-settings.md) | Session/role, preferences, reset demo data (`resetData`) |

## 🏗 Architecture (systems)

| Doc | What it covers |
|---|---|
| [architecture/data-layer](architecture/data-layer.md) | The Zustand stores, every data-store action, and the per-tenant `firestore-storage` shard/merge/live-sync bridge + `StoreHydrator` role-scoped load (with data-flow diagram) |
| [architecture/security-and-roles](architecture/security-and-roles.md) | The two roles, the full `firestore.rules` read/write matrix (the real boundary), and the cosmetic client-side gating |
| [architecture/data-model](architecture/data-model.md) | Every domain type, the deterministic seed generator, and key constants (`ALERT_META`, `COMPLIANCE`, `ROLES`, …) |
| [architecture/3d-landing-scene](architecture/3d-landing-scene.md) | The scroll "clean the river" WebGL diorama: `TransitionRef`, camera, factory/pipeline/trees, water GLSL, Turbopack/fallback constraints |

## 🔧 Reference

| Doc | What it covers |
|---|---|
| [components](components.md) | File-by-file catalog of every React component (purpose + exports/props), grouped by directory, with dead-code flags |
| [deployment](deployment.md) | Build/run, Firebase project + rules deploy + MCP, the two Git remotes and two auto-deploying Vercel projects, no-env-vars |

---

_Conventions used throughout: treatment **capacities render in `KLD`**; water-balance **volumes are stored `"KL"` and displayed as `m³`** (`displayUnit`). Total Water Intake = `freshWaterConsumption + etpReuse + roPermeate`._
