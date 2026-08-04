# Deployment & Ops

How JalRakshak ETP is built, configured, secured, and shipped. This is a **client-only** app — there is no server to deploy; "deploy" means (1) shipping the static/SSR Next.js build to Vercel and (2) deploying the Firestore security rules to Firebase.

## Overview

```
 git push  ──▶  GitHub (2 remotes)  ──▶  Vercel (2 projects, auto-deploy)  ──▶  users
                                                                              │
 firebase deploy --only firestore:rules  ──▶  Firebase project jalrakshak-etp ◀┘ (Auth + Firestore)
```
The browser talks **directly** to Firebase Auth + Firestore using the public web config baked into `lib/firebase.ts`. Access is gated entirely by `firestore.rules` (see [security-and-roles](architecture/security-and-roles.md)). **No environment variables are required** on Vercel.

## Files

| File | Role |
|---|---|
| `package.json` | scripts (`dev`/`build`/`start`/`lint`) + deps; pnpm; name `jalrakshak-etp` |
| `next.config.ts` | Next.js config (minimal) |
| `lib/firebase.ts` | Firebase client init; reads `NEXT_PUBLIC_FIREBASE_*` with the real **public config hardcoded as fallback** → deploys need no env vars |
| `firebase.json` | Firebase CLI config — only a `firestore` block (rules + indexes); no hosting/functions/storage |
| `.firebaserc` | default project alias → `jalrakshak-etp` |
| `firestore.rules` | the per-tenant security rules (the real boundary) |
| `firestore.indexes.json` | composite indexes — **empty** (queries are single-doc gets / whole-collection reads) |
| `.mcp.json` | Firebase MCP server config for Claude Code |

## Commands

```bash
pnpm install
pnpm dev      # next dev (Turbopack) → http://localhost:3000
pnpm build    # next build (Turbopack) — production build
pnpm start    # serve the production build
pnpm lint     # eslint
```
- Package manager: **pnpm** on **Windows**.
- **Turbopack** is the builder for both dev and build in Next 16.2.9. `--no-turbopack` / `NEXT_DISABLE_TURBOPACK` do **not** work here. Consequence: **no post-processing** (bloom/EffectComposer) in the 3D scene (see [3d-landing-scene](architecture/3d-landing-scene.md)).
- **`next build` runs ESLint** — unused imports/vars **fail the build**. Clean them up when removing usages.

## Firebase

- **Project:** `jalrakshak-etp` (project number `32456689114`), region **asia-south1** (Mumbai), **Spark/free** plan (billing off).
- **Owner:** the **`inceptionretreats@gmail.com`** Google account (not the "manav" account). Console: `https://console.firebase.google.com/project/jalrakshak-etp`.
- **Web app** appId: `1:32456689114:web:aba58d6d56dd40c5ec6ce3`. The web API key is committed as a fallback in `lib/firebase.ts` — this is **safe by design** (Firebase web keys are public; `firestore.rules` is the gate).
- **Collections:** `users/{uid}` (profiles) and `industries/{industryId}` (per-tenant data shards). The old `state/app` single doc is orphaned/superseded.

### Deploy the security rules
Rules are the only thing that must be deployed to Firebase (the app itself lives on Vercel):
```bash
firebase deploy --only firestore:rules
```
…or via the **Firebase MCP** tools in Claude Code (`firebase_deploy` / validate), then verify live with the MCP read tools (`firestore_get_document`, `auth_get_users`).

### First-run bootstrap
On a fresh/empty project the **first `monitoring-admin` sign-in seeds** the `industries/*` docs from the bundled seed (`data/industries.json` → `buildSeedState()`). **The admin must sign in before operators**, otherwise operators bound to a seed unit see empty data.

## Git remotes (push to BOTH)

Two GitHub repositories track the same `main`:

| Remote | GitHub |
|---|---|
| `origin` | `github.com/ManavBhati2004/Jalrakshak---ETP` |
| `inception` | `github.com/inceptionretreats-stack/Jalrakshak---ETP--RSPCB` |

```bash
git push origin main && git push inception main
```
- **Harmless recurring warning:** `error: update_ref failed for ref 'refs/remotes/<remote>/main'` — the push still succeeds; resync the local ref with `git update-ref refs/remotes/<remote>/main $(git rev-parse HEAD)`.
- Commit messages end with the `Co-Authored-By: Claude …` trailer. The current workflow commits directly to `main` (only commit/push when asked).

## Vercel (two projects, both auto-deploy)

Both Vercel projects are **Git-connected**, so a push to `main` auto-deploys:

| Project | Account | URL |
|---|---|---|
| manav | `manavbhati44204-2918` | `https://jalrakshak-etp.vercel.app` |
| inception | `inceptionretreats-7739s-projects` | `https://jalrakshak-etp-psi.vercel.app` |

- Project name must be `jalrakshak-etp` (Vercel rejects the repo's auto-name with `---`).
- No env vars needed (public config fallback in `lib/firebase.ts`).
- Legacy manual CLI redeploy (only if a Git hook ever misfires): `npx vercel --prod --yes --scope <scope> --token <TOKEN>` (revoke the token after).

## Firebase MCP (Claude Code, Windows)

`.mcp.json` wires the Firebase MCP server. On **Windows** it must be invoked through `cmd`, not bare `npx`:
```json
{ "mcpServers": { "firebase": { "command": "cmd", "args": ["/c","firebase","mcp","--only","firestore,auth,storage"] } } }
```
(Bare `npx` fails with `MCP error -32000: Connection closed`. Requires global `firebase-tools` installed and `firebase login` as the `inceptionretreats@gmail.com` account.)

## Gotchas & invariants
- **Docs/rules split:** app code → Vercel (git push); Firestore rules → Firebase (`firebase deploy --only firestore:rules`). Editing `firestore.rules` and only pushing to git does **not** change the live security rules.
- **No env vars** anywhere — the public Firebase config is the fallback in `lib/firebase.ts`.
- **Turbopack** constraints (above). Build fails on unused vars.
- **Two remotes / two Vercel projects** — always push both to keep the sites in sync.
- **Demo credentials are published** on `/login` and in the README (intentional).

## Related
- [security-and-roles](architecture/security-and-roles.md) — what the deployed rules enforce.
- [data-layer](architecture/data-layer.md) — how the client reads/writes Firestore.
- Repo `CLAUDE.md` — the high-level project guide.
