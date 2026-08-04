# `/` — Landing (Public Scroll Experience)

> Route: `/` · File: `app/page.tsx` · Roles: **Public / unauthenticated** (no gate) · Rendered by: `LandingExperience` (`components/landing/landing-experience.tsx`)

---

## Purpose

The marketing / entry page for RSPCB JalRakshak. It has two macro-parts:

1. **A pinned, 320vh cinematic scroll hero** that "cleans a polluted river" as you scroll. The visual is a lazy‑loaded Three.js/R3F scene (`RiverScene`) with a pure‑CSS/SVG static fallback for devices without WebGL or with reduced‑motion preference. A `ScrollOverlay` layers the headline, a treatment‑pipeline progress indicator, and **Enter / Skip** affordances on top.
2. **Below‑the‑fold home content** (`HomeContent`): a sticky site header, a hero band with animated stat counters, an auto‑advancing about slideshow, a contact card, and a footer — all funneling the visitor to `/login`.

`app/page.tsx` is a one‑liner that delegates everything to the client component:

```tsx
// app/page.tsx
export default function LandingPage() {
  return <LandingExperience />;
}
```

---

## Access & gating

This route is **fully public**. There is **no auth check, no redirect, and no role gate** here:

- It is **not** a `/dashboard/*` route, so the dashboard access machinery does **not** apply — `canAccessPath` and `dashboard-shell` never run for `/`.
- It does **not** read `useAuthStore` and does **not** redirect an already‑authenticated user away. A signed‑in `monitoring-admin` or `etp` operator who hits `/` still sees the marketing page; they only enter the app by following a CTA to `/login`.
- Gating happens **downstream**: every primary CTA links to `/login`, and role scoping (monitoring‑admin sees all units; etp sees only its own) is enforced after authentication, not here.

`LandingExperience` is a `"use client"` component (`components/landing/landing-experience.tsx:1`); `RiverScene` is additionally loaded with `ssr: false` so the WebGL scene never renders on the server (`landing-experience.tsx:11-14`).

---

## Data — store reads & writes

**None.** The landing page touches neither `useDataStore` nor `useAuthStore`, and performs no Firestore reads or writes. There are no store selectors or actions on this page — it is static/presentational.

All "state" on the page is **local React state or capability probes**, not app data:

| Source | Where | What it drives |
| --- | --- | --- |
| `usePrefersReducedMotion()` | `landing-experience.tsx:20` | disables the 3D scene when the OS requests reduced motion |
| `useWebGLSupported()` | `landing-experience.tsx:21` | disables the 3D scene when WebGL is unavailable |
| `useScroll` / `useTransform` / `useMotionValueEvent` (Framer Motion) | `landing-experience.tsx:24-29` | scroll‑progress → the shared `transition` value + overlay animations |
| `useScrolled(40)` | `site-header.tsx:20` | compact/blurred header styling after 40px of scroll |
| `useState` (`open`) | `site-header.tsx:21` | mobile menu open/closed |
| `useState` (`idx`, `paused`) | `about-slideshow.tsx:46-47` | slideshow index + hover‑pause |

The capability hooks live in `lib/hooks/use-capabilities.ts`.

---

## Layout & sections

Top‑level structure (`landing-experience.tsx:33-48`):

```tsx
<div className="overflow-x-clip">
  <section ref={sceneRef} className="relative h-[320vh]">      {/* scroll runway */}
    <div className="sticky top-0 h-screen w-full overflow-hidden">  {/* pinned viewport */}
      <div className="absolute inset-0">
        {use3D ? <RiverScene transition={transition} /> : <StaticHeroBackground clean />}
      </div>
      <ScrollOverlay progress={t} onEnter={goHome} onSkip={goHome} />
    </div>
  </section>

  <div ref={homeRef} className="relative z-30 bg-background">
    <HomeContent />
  </div>
</div>
```

### A. The pinned scroll hero (`section`, `h-[320vh]`)

- The outer `<section ref={sceneRef}>` is **320vh tall** — that height is the *scroll runway*. Its child is `sticky top-0 h-screen`, so a single 100vh viewport **pins** while ~220vh of page scroll elapses.
- Inside the pinned viewport sit two stacked layers:
  - **Background layer** (`absolute inset-0`) — either the 3D `RiverScene` or the CSS `StaticHeroBackground` (see *Key flows* for the WebGL/reduced‑motion decision).
  - **`ScrollOverlay`** (`z-20`) — all the on‑screen chrome (headline, pipeline, buttons).

#### `ScrollOverlay` (`components/landing/scroll-overlay.tsx`), top → bottom:

1. **Legibility scrims** (`scroll-overlay.tsx:35-36`) — a heavy top gradient (`from-black/55`, top 62%) behind the headline and a lighter bottom gradient (`from-black/45`, bottom 32%).
2. **Top bar** (`scroll-overlay.tsx:39-47`) — `JalRakshakLogo tone="light"` on the left; a **"Skip intro →"** pill button on the right (`onClick={onSkip}`). Fades out at the very end via `topBarOpacity` (`[0.92, 1] → [1, 0]`).
3. **Headline block** (`h-[280px] max-w-3xl`, `scroll-overlay.tsx:50-90`) — two cross‑fading variants occupying the same space:
   - **Polluted** (`scroll-overlay.tsx:53-62`): rose badge `⚠ Rajasthan State Pollution Control Board`, then h1 **"Untreated Textile Wastewater / Harms Our Rivers"** (last words in `text-rose-300`). Fades out over `[0, 0.32]`.
   - **Clean** (`scroll-overlay.tsx:65-88`): emerald badge `✦ Smart Monitoring · JalRakshak`, h1 **"Clean Water, Restored."** (`Restored.` uses `.text-gradient-cyan`), a subcopy line, and the **Enter** button. Fades in over `[0.45, 0.8]`.
   - **Enter button** (`scroll-overlay.tsx:77-87`): white pill, `Droplets` + **"Enter Monitoring System"** + `ArrowRight`. `onClick={onEnter}`. Its opacity ramps `[0.78, 0.97] → [0, 1]` and it only becomes clickable past 80% scroll (`enterPointer = v > 0.8 ? "auto" : "none"`).
4. **Spacer** (`flex-1`) pushes the pipeline to the bottom.
5. **Treatment‑pipeline progress** (`scroll-overlay.tsx:95-125`) — five nodes from `STEPS = ["Flow Meter", "ETP", "RO", "MEE", "Treated"]` (`scroll-overlay.tsx:10`). Each node lights cyan when `p > i * 0.18`; connector segments fill when `p > (i + 0.5) * 0.18`. Below the nodes, a full‑width gradient bar whose width tracks `barWidth` (`[0, 1] → ["0%", "100%"]`).
6. **Scroll hint** (`scroll-overlay.tsx:127-130`) — "Scroll to clean the river" + a bouncing `ArrowDown`, fading out early over `[0, 0.12]`.

> The 3D scene internals (camera rig, water shader, factory/pipeline/fish, the `TransitionRef` contract) are **out of scope here** — see the sibling doc **[`docs/architecture/3d-landing-scene.md`](../architecture/3d-landing-scene.md)**. This page only documents how the landing route *drives* that scene via the shared `transition` ref.

#### `StaticHeroBackground` (`components/landing/static-hero-background.tsx`) — the fallback

A dependency‑free CSS/SVG diorama with a single `clean` boolean prop (default `false`):

- **Base gradient**: olive/dark (polluted) vs blue (`clean`), with a 1s `transition-colors`.
- **Sun/haze blob**: opacity `0.9` when clean vs `0.25` when polluted.
- **Two layered SVG wave paths**, recolored teal (clean) vs dark‑green (polluted).

It is used in **two** places with different props (see *Edge cases*): as the non‑3D path (`clean` → blue) and as the dynamic‑import loading placeholder (`clean=false` → polluted).

### B. Below‑the‑fold: `HomeContent` (`components/landing/home/home-content.tsx`)

Rendered inside `relative z-30 bg-background` so it slides up *over* the pinned hero. Order (`home-content.tsx:12-16`): `SiteHeader → HeroSection → AboutSlideshow → ContactSection → SiteFooter`.

#### 1. `SiteHeader` (`components/landing/site-header.tsx`)
- `sticky top-0 z-40`; styling switches to a denser, blurred, shadowed bar once `useScrolled(40)` is true (`site-header.tsx:24-31`).
- `JalRakshakLogo tone="auto"`.
- **Desktop nav** (`lg:flex`) from `LINKS` (`site-header.tsx:11-17`): Overview `#overview`, ETP Units `#etp`, Platform `#platform`, About `#about`, Contact `#contact`.
- **"Enter Platform"** primary button → `Link href="/login"` (`site-header.tsx:48-53`), hidden below `sm`.
- **Mobile**: hamburger toggles `open`; the dropdown panel repeats `LINKS` plus a full‑width **Enter Platform → /login** button (`site-header.tsx:64-80`).

#### 2. `HeroSection` (`components/landing/home/hero-section.tsx`) — `id="overview"`
- `min-h-[86vh]`, decorative gradient + blurred teal/cyan blobs (`hero-section.tsx:17-20`).
- Framer‑Motion fade‑up wrapper.
- Badge **"An Initiative by RSPCB · Balotra"**; h1 **"RSPCB JalRakshak"** ("JalRakshak" in `.text-gradient-brand`); subcopy.
- Two CTAs (`hero-section.tsx:42-55`): **"Enter Command Center"** → `/login`; **"Explore the Platform"** → `#etp` anchor.
- **Stat counters** grid from `HERO_STATS` (`lib/constants.ts:134-139`), rendered via `AnimatedCounter … startOnView={false}` so they count up immediately on mount:

  | value | suffix | label |
  | --- | --- | --- |
  | 2 | — | ETP Units Monitored |
  | 7 | `-stage` | Treatment Pipeline |
  | 250 | `+` | Daily Readings |
  | 24 | `×7` | Live Monitoring |

#### 3. `AboutSlideshow` (`components/landing/home/about-slideshow.tsx`) — `id="about"`
- Section heading via `SectionReveal` (scroll‑reveal): eyebrow "About RSPCB JalRakshak" + "Mandated to protect water. Built for transparency."
- A 4‑slide carousel (`SLIDES`, `about-slideshow.tsx:10-43`) — each slide has a remote Unsplash image, a Lucide icon, an eyebrow, a title, body copy, and an accent color:
  1. `Leaf` — Environmental Protection — "Protecting Rajasthan's Rivers"
  2. `Droplets` — Water Conservation — "Every Drop Recovered"
  3. `ShieldCheck` — Responsible Compliance — "A Greener Tomorrow"
  4. `Cpu` — Digital Transformation — "Live Digital Oversight"
- **Autoplay** every `5200ms`, paused on hover (`about-slideshow.tsx:51-55`, `79-80`); **Ken Burns** zoom on each image; prev/next arrows (`go(±1)` wraps modulo); dot indicators.

#### 4. `ContactSection` (`components/landing/home/contact-section.tsx`) — `id="contact"`
- A teal→cyan→blue gradient card. Left column: heading, demo disclaimer, and **"Launch the demo"** → `/login`.
- Right column: four **illustrative** contact tiles from `CONTACTS` (`contact-section.tsx:8-13`) — Demo Email, Demo Helpline, Demo Office, "24 × 7 Live" Monitoring. All explicitly demo/illustrative.

#### 5. `SiteFooter` (`components/landing/site-footer.tsx`)
- Logo + one‑line mission statement.
- Three link columns (`COLUMNS`, `site-footer.tsx:4-32`): **Platform**, **Monitoring**, **Governance** — nearly every link points to `/login` (a couple are `#` anchors).
- Bottom bar: `© {new Date().getFullYear()} … Balotra. Demonstration prototype.` and an amber **"Demo only — mock data, no real submissions."** badge.

---

## Forms & validation

**None.** The landing page contains no forms, inputs, or Zod schemas. Its only interactive controls are navigation buttons/links and the slideshow/menu toggles. Data capture (login, ETP daily entry, etc.) lives on other routes reached via the `/login` CTAs.

---

## Key flows & logic

### Flow 1 — Choosing 3D vs static background

```tsx
// landing-experience.tsx:20-22
const reduced = usePrefersReducedMotion();   // (prefers-reduced-motion: reduce)
const webgl   = useWebGLSupported();          // null → true/false after probing a canvas
const use3D   = webgl !== false && !reduced;
```

- `useWebGLSupported` returns `null` on first render, then `true`/`false` after it tries `getContext("webgl2") || getContext("webgl")` (`use-capabilities.ts:17-29`). Because the check is `webgl !== false`, the **initial** render optimistically attempts 3D (unless reduced motion is already known).
- `RiverScene` is a `dynamic()` import with `ssr: false` and `loading: () => <StaticHeroBackground />` (**polluted**, no `clean`) — so while the WebGL chunk downloads, the polluted static diorama is shown; it is then replaced by the live scene (`landing-experience.tsx:11-14`).
- When `use3D` is **false** (no WebGL, or reduced motion), the page renders `<StaticHeroBackground clean />` (**clean/blue**) directly and never loads the Three.js bundle.

### Flow 2 — Scroll → transition value → scene + overlay

```tsx
// landing-experience.tsx:24-29
const { scrollYProgress } = useScroll({ target: sceneRef, offset: ["start start", "end end"] });
const t = useTransform(scrollYProgress, [0, 0.66], [0, 1], { clamp: true });
useMotionValueEvent(t, "change", (v) => {
  transition.current.value = Math.max(0, Math.min(1, v));
});
```

1. `useScroll` maps the 320vh section to `scrollYProgress` 0→1 (`0` when the section top meets the viewport top; `1` when its bottom meets the viewport bottom).
2. `t` **remaps and clamps** so the whole polluted→clean transformation **completes at 66% of the section**, i.e. while the canvas is still pinned. The remaining ~34% holds the clean scene before `HomeContent` scrolls up.
3. On every change, `t` is written into `transition.current.value` — the shared `TransitionRef` (`{ value: number }`, `components/three/types.ts`) that the 3D scene reads inside `useFrame`.
4. The **same** `t` MotionValue is passed to `ScrollOverlay` as `progress`, so overlay animations and the 3D scene stay perfectly in lockstep.

Inside `ScrollOverlay`, `progress` fans out into derived MotionValues plus one discrete state mirror:

| Element | Driver | Range → output |
| --- | --- | --- |
| Polluted headline | `pollutedOpacity` | `[0, 0.32] → [1, 0]` |
| Clean headline | `cleanOpacity` | `[0.45, 0.8] → [0, 1]` |
| Scroll hint | `hintOpacity` | `[0, 0.12] → [1, 0]` |
| Top bar (logo + Skip) | `topBarOpacity` | `[0.92, 1] → [1, 0]` |
| Enter button opacity | `enterOpacity` | `[0.78, 0.97] → [0, 1]` |
| Enter button clickability | `enterPointer` | `v > 0.8 ? "auto" : "none"` |
| Bottom gradient bar | `barWidth` | `[0, 1] → ["0%", "100%"]` |
| Pipeline node `i` active | `p` (state) | `p > i * 0.18` |
| Pipeline connector `i` filled | `p` (state) | `p > (i + 0.5) * 0.18` |

`p` is `progress` rounded to two decimals (`scroll-overlay.tsx:21-22`), used because the pipeline needs discrete on/off thresholds rather than a continuous MotionValue.

Pipeline activation thresholds (with 5 steps): node lights at `p` > **0, 0.18, 0.36, 0.54, 0.72**; connectors fill at `p` > **0.09, 0.27, 0.45, 0.63**.

### Flow 3 — Enter / Skip

```tsx
// landing-experience.tsx:31
const goHome = () => homeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
// …
<ScrollOverlay progress={t} onEnter={goHome} onSkip={goHome} />
```

Both **"Enter Monitoring System"** and **"Skip intro →"** call the *same* `goHome` handler — they **smooth‑scroll to `HomeContent`**, they do **not** navigate to a route. The visitor reaches the app only from a `HomeContent` CTA (`/login`). "Enter" is gated to appear/click past ~80% scroll; "Skip" is available immediately.

### Flow 4 — Below‑the‑fold interactions
- **Header**: `useScrolled(40)` restyles the sticky bar; the mobile hamburger toggles a dropdown; anchor links smooth‑jump within the page.
- **Hero counters**: `AnimatedCounter` with `startOnView={false}` animates from `0` to each `HERO_STATS.value` on mount over `duration=1.6s`, appending `suffix` (`animated-counter.tsx:32-46`).
- **Slideshow**: `setInterval` advances `idx` every 5.2s unless `paused` (hover); arrows/dots override; `AnimatePresence` cross‑fades slides and captions.

---

## Units & formatting

Not applicable in a data sense — the landing page displays **no water‑balance volumes**, so the KLD‑vs‑m³ distinction and `displayUnit()` are not used here. The only numeric formatting is cosmetic: `AnimatedCounter` runs the `HERO_STATS` values through `formatNumber` and appends static suffixes (`-stage`, `+`, `×7`). The label **"7‑stage Treatment Pipeline"** and the overlay pipeline steps (`Flow Meter → ETP → RO → MEE → Treated`) are descriptive copy, not computed metrics.

---

## Edge cases & gotchas

- **No `/register` link exists on this page.** Despite "self‑registration" being a product concept, **every** landing CTA (header, hero, contact, footer, mobile menu) routes to **`/login`** — confirmed across all landing components. Registration is reached from the login page, not from `/`.
- **Dead anchor targets `#etp` and `#platform`.** The header nav ("ETP Units", "Platform"), the hero's "Explore the Platform" button, and several footer links point to `#etp` / `#platform`, but `HomeContent` only renders sections with ids `overview`, `about`, and `contact` — there is **no** `#etp` or `#platform` element in the current render tree, so those clicks scroll nowhere.
- **Two different `StaticHeroBackground` states.** The non‑3D branch passes `clean` (blue), but the `dynamic()` loading placeholder passes no prop (`clean=false`, polluted). So a WebGL device briefly flashes the *polluted* diorama before the live scene mounts, whereas a no‑WebGL device shows the *clean* one — intentional but easy to misread.
- **Optimistic 3D on first paint.** `use3D = webgl !== false && !reduced` is `true` while `webgl` is still `null`, so the Three.js chunk starts downloading before the capability probe resolves. A genuinely unsupported device only falls back after the effect runs.
- **Reduced motion only disables the 3D scene.** `usePrefersReducedMotion` gates `RiverScene`, but the below‑the‑fold Framer‑Motion reveals, the Ken‑Burns slideshow, and the animated counters still animate — they don't consult the reduced‑motion preference.
- **Remote images.** `AboutSlideshow` and the logo use `next/image` with **external Unsplash URLs** (`about-slideshow.tsx:12-40`); these require the host to be allow‑listed in `next.config`'s image `remotePatterns`, or the slides fail to load.
- **Authenticated users are not redirected.** `/` renders for everyone, including signed‑in users — there is no "already logged in → dashboard" bounce here.
- **Enter is scroll‑gated.** Because `enterPointer` is `"none"` until `t > 0.8`, a user who hasn't scrolled ~80% through the hero cannot click "Enter Monitoring System"; only "Skip intro" works early.
- **`overflow-x-clip` wrapper.** The outer wrapper and several sections use `overflow-x-clip` to contain the decorative blur blobs and prevent horizontal scrollbars.

---

## Related files

| File | Role |
| --- | --- |
| `app/page.tsx` | Route entry; renders `<LandingExperience />` |
| `components/landing/landing-experience.tsx` | Orchestrator: pinned 320vh section, scroll math, 3D‑vs‑static decision, Enter/Skip |
| `components/landing/scroll-overlay.tsx` | Overlay chrome: headlines, pipeline progress, Enter/Skip buttons |
| `components/landing/static-hero-background.tsx` | CSS/SVG fallback diorama (`clean` prop) |
| `components/landing/home/home-content.tsx` | Below‑the‑fold composition |
| `components/landing/home/hero-section.tsx` | `#overview` band + `HERO_STATS` counters |
| `components/landing/home/about-slideshow.tsx` | `#about` auto‑advancing carousel |
| `components/landing/home/contact-section.tsx` | `#contact` demo contact card |
| `components/landing/site-header.tsx` | Sticky nav + Enter Platform CTA |
| `components/landing/site-footer.tsx` | Footer link columns + demo disclaimer |
| `components/shared/logo.tsx` | `JalRakshakLogo` (uses `/rspcb-logo.jpeg`) |
| `components/shared/animated-counter.tsx` | Count‑up for hero stats |
| `components/shared/section-reveal.tsx` | Scroll‑reveal wrapper used by home sections |
| `lib/hooks/use-capabilities.ts` | `usePrefersReducedMotion`, `useWebGLSupported`, `useScrolled` |
| `lib/constants.ts` (`HERO_STATS`, L134‑139) | Hero stat data |
| `components/three/river-scene.tsx` + `components/three/types.ts` | Lazy 3D scene + `TransitionRef` contract |
| **`docs/architecture/3d-landing-scene.md`** | **Deep‑dive on the 3D scene** (camera, water, factory, fish) — referenced, not duplicated here |
