# 3D Landing Scene — "Clean the River" Diorama

## Overview

The public landing page (`/`) opens on an interactive WebGL diorama: a smoke-belching
textile **mill** on a green river bank, its wastewater running through a labelled
**treatment pipeline** (Flow Meter → ETP → RO → MEE → Treated), and a wide **river** in the
foreground. As the visitor scrolls, the whole scene *transforms*: the sky brightens, the
polluted olive-grey river turns clear cyan, the factory smoke fades, trees grow in, fish
appear, and the pipeline nodes light up in sequence. When the transformation completes, a
"Enter Monitoring System" call-to-action fades in.

The entire animation is driven by **one scalar** — a `0 → 1` "transition" value — that is
mapped from the page's scroll position. That single number is fanned out to every moving
part of the scene (camera, water shader, lighting, colors, particle opacities, growth
factors). This document describes how that driver is built, how it is consumed, and every
sub-scene it animates.

Why it is built this way:
- **One source of truth.** Scroll → a Framer Motion `MotionValue` → a plain mutable ref.
  The 3D scene reads the *ref* every frame (`useFrame`) so scroll does **not** trigger React
  re-renders of the Three.js tree; the DOM overlay reads the `MotionValue` for its own
  animations. The two are decoupled but perfectly synced because they share the same driver.
- **Client-only.** The scene is a `"use client"` island, dynamically imported with
  `ssr: false` (`components/landing/landing-experience.tsx:11-14`) so WebGL never runs on the
  server.
- **Graceful degradation.** No WebGL support or `prefers-reduced-motion: reduce` → the whole
  Canvas is swapped for a cheap CSS/SVG `StaticHeroBackground` (no fallback loop, no
  requestAnimationFrame).

---

## Files

| Path | Role |
| --- | --- |
| `components/landing/landing-experience.tsx` | Scroll orchestrator. Builds the `transition` ref + the Framer `MotionValue`, wires scroll → transition, decides 3D vs. static, lays out the pinned section, mounts `RiverScene` (dynamic) and `ScrollOverlay`. |
| `components/three/types.ts` | Defines `TransitionRef` — the shared `0→1` driver type. |
| `components/three/river-scene.tsx` | The R3F `<Canvas>` + `CameraRig` (responsive FOV, drifting camera). Assembles `WaterPlane` + `SceneEnvironment`. |
| `components/three/water-plane.tsx` | The river mesh + `ShaderMaterial` (feeds `uTime`/`uTransition` uniforms each frame). |
| `components/three/shaders/water.ts` | Raw GLSL: `waterVertexShader` (wave displacement) + `waterFragmentShader` (polluted→clean two-tone + toon crests + stripes + scum). |
| `components/three/scene-environment.tsx` | The diorama: `Atmosphere`, `Sun`, `Land`, `Factory`, `Pipeline`, `Trees`, `Fish`. All read the transition each frame. |
| `components/landing/scroll-overlay.tsx` | The DOM overlay pinned over the Canvas: headlines (polluted↔clean crossfade), 5-step pipeline progress, scrims, CTA. Reads the `MotionValue` directly. |
| `components/landing/static-hero-background.tsx` | Non-WebGL fallback (CSS gradient sky + blurred sun + two SVG wave bands). `clean` prop toggles polluted vs. clean palette. |
| `lib/hooks/use-capabilities.ts` | `usePrefersReducedMotion()` and `useWebGLSupported()` — the two capability gates. |

---

## How it works

### 1. The driver: scroll → `MotionValue` → mutable ref

In `LandingExperience` (`components/landing/landing-experience.tsx`):

```tsx
const transition = useRef({ value: 0 });                          // :17  the shared ref
...
const { scrollYProgress } = useScroll({                           // :24
  target: sceneRef, offset: ["start start", "end end"],
});
// complete the transformation while the canvas is still pinned (~66% of the section)
const t = useTransform(scrollYProgress, [0, 0.66], [0, 1], { clamp: true }); // :26
useMotionValueEvent(t, "change", (v) => {                         // :27-29
  transition.current.value = Math.max(0, Math.min(1, v));
});
```

- `sceneRef` wraps a **`h-[320vh]`** section (`:35`) whose inner div is
  **`sticky top-0 h-screen`** (`:36`) — so the Canvas is *pinned* to the viewport while the
  page scrolls through 3.2 screen-heights.
- `scrollYProgress` runs `0→1` across that section. `useTransform(..., [0, 0.66], [0, 1], {clamp})`
  remaps it so the transition reaches **`1` at 66 % of the section** — the scene is fully
  "cleaned" while still pinned, leaving the last ~third for the CTA to sit and the user to click.
- `useMotionValueEvent` copies each new value into `transition.current.value`. This is the
  bridge from Framer's reactive world into a **plain mutable object** that Three.js can poll
  without React.

`TransitionRef` (`components/three/types.ts:4`):

```ts
export type TransitionRef = MutableRefObject<{ value: number }>;
```

The same `transition` ref is passed to `RiverScene` (3D) while the same `MotionValue` `t` is
passed to `ScrollOverlay` as `progress` (`:40`). Both stay in lock-step.

> Note: the doc-comment in `types.ts:3` says the value is "mutated by GSAP" — that is stale.
> The live driver is **Framer Motion** (`useScroll` + `useTransform` + `useMotionValueEvent`).
> GSAP is a project dependency but is not what drives this ref.

### 2. Fan-out: one ref read by many `useFrame`s

Every animated component receives `transition` and, inside its own `useFrame`, reads
`transition.current.value` (usually into a local `const t`) to interpolate. Because this is a
ref read (not a prop/state), **no component re-renders on scroll** — they just mutate
materials, geometry attributes, and matrices in place.

```
        window scroll
             │  useScroll(sceneRef, ["start start","end end"])
             ▼
      scrollYProgress            (0 → 1 across the 320vh section)
             │  useTransform([0,0.66] → [0,1], clamp:true)
             ▼
      t : MotionValue<number> ─────────────────────────────┐
             │  useMotionValueEvent("change")               │  passed as `progress`
             ▼                                              ▼
   transition.current.value  (plain ref, no re-render)   ScrollOverlay  (React state `p`)
             │  polled every frame via useFrame              │  DOM: opacity crossfades,
             │                                               │  5 step chips, CTA gate
   ┌─────────┼───────────────┬───────────────┬─────────────────────────────┐
   ▼         ▼               ▼               ▼                             ▼
 CameraRig  WaterPlane   Atmosphere/Sun    Factory / Pipeline          Trees / Fish
 (FOV,pos)  (uTransition) (sky,fog,light)  (smoke fade, node light)    (grow / appear)
```

### 3. The Canvas + CameraRig

`RiverScene` (`components/three/river-scene.tsx:35-48`):

```tsx
<Canvas
  shadows
  gl={{ antialias: true, alpha: false, powerPreference: "high-performance", toneMappingExposure: 1.08 }}
  dpr={[1, 1.8]}
  camera={{ position: [0, 5.4, 22], fov: 40, near: 0.1, far: 140 }}
>
  <CameraRig transition={transition} />
  <WaterPlane transition={transition} />
  <SceneEnvironment transition={transition} />
</Canvas>
```

- `shadows` enables the shadow map (used by the directional light + `castShadow`/`receiveShadow`
  meshes).
- `dpr={[1, 1.8]}` caps device-pixel-ratio at 1.8 for perf on retina screens.
- `alpha: false` → opaque canvas (the sky is drawn by `scene.background`, not CSS).
- `toneMappingExposure: 1.08` — a slight lift; R3F defaults to ACES Filmic tone mapping.
- `far: 140` accommodates the distant hills (`z ≈ -32`) and sun (`z = -26`).

`CameraRig` (`:9-33`) is a render-null component that mutates the camera every frame:

| Line | Logic | Purpose |
| --- | --- | --- |
| `:15` | `aspect = width / max(1, height)` | current viewport aspect |
| `:16` | `narrow = aspect < 1.1` | portrait phones / narrow tablets |
| `:20` | `targetFov = narrow ? clamp(44/aspect, 40, 74) : 40` | **widen FOV** on narrow screens so the wide factory→river scene fits without cropping |
| `:21-24` | apply `fov` + `updateProjectionMatrix()` only if it moved > `0.15°` | avoid recomputing the projection matrix every frame |
| `:25` | `wf = narrow ? clamp(1.5/aspect, 1, 1.9) : 1` | extra pull-back factor on narrow screens |
| `:26` | `position.x = sin(time*0.05) * 0.6` | slow lateral drift (parallax life) |
| `:27` | `position.y = (5.4 + sin(time*0.2)*0.05) * (narrow ? 0.82 + 0.18*wf : 1)` | gentle bob, lowered a touch on narrow |
| `:28` | `position.z = lerp(22, 20.5, t) * wf` | subtle push-in as the scene cleans (`t`), scaled out on narrow |
| `:30` | `lookAt(0, 2.4, -2)` | aim above horizon: text top, factory/pipeline mid, river foreground |

So the camera does two things at once: an idle *ambient* drift (driven by `state.clock`), and
a transition-driven *push-in* (driven by `t`). FOV/pull-back are purely responsive.

### 4. The water plane + shaders

`WaterPlane` (`components/three/water-plane.tsx`):

```tsx
const uniforms = useMemo(() => ({ uTime: { value: 0 }, uTransition: { value: 0 } }), []);
useFrame((state) => {
  mat.current.uniforms.uTime.value = state.clock.elapsedTime;      // :22
  mat.current.uniforms.uTransition.value = transition.current.value; // :23
});
...
<mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -2.25, 10]}>      // :27  laid flat, in front
  <planeGeometry args={[150, 110, 100, 64]} />                     // :28  150×110, 100×64 segs
  <shaderMaterial vertexShader={waterVertexShader}
                  fragmentShader={waterFragmentShader} uniforms={uniforms} />
</mesh>
```

The plane is `150 (x) × 110 (z-depth)` and heavily subdivided (`100 × 64` segments = ~6.4k
verts) so the vertex shader has enough resolution to ripple smoothly. It sits at `y = -2.25`
and `z = 10` (toward the camera), rotated flat.

**Vertex shader** (`shaders/water.ts:1-16`) — wave displacement:

```glsl
float w = sin(pos.x * 0.5 + uTime * 1.2) * 0.17
        + sin(pos.y * 0.7 + uTime * 1.7) * 0.11
        + sin((pos.x + pos.y) * 0.3 - uTime * 0.9) * 0.07;
pos.z += w;   // displaced along local Z (== world up, since the plane is rotated flat)
vWave = w;    // crest height handed to the fragment shader
```

Three summed sines at different frequencies/phases/speeds give a non-repeating swell; `vUv`
and `vWave` are passed to the fragment stage.

**Fragment shader** (`shaders/water.ts:18-50`) — polluted → clean coloring, all keyed on
`uTransition`:

| Effect | Code | Behavior |
| --- | --- | --- |
| Two-tone depth gradient | `d = smoothstep(0,1,vUv.y)`; `polluted = mix(pollutedTop, pollutedBot, d)`, `clean = mix(cleanTop, cleanBot, d)` | near→far vertical gradient; polluted = olive/greys `(0.27,0.29,0.18)→(0.13,0.17,0.13)`, clean = cyans `(0.36,0.80,0.93)→(0.09,0.45,0.78)` |
| Pollution crossfade | `col = mix(polluted, clean, uTransition)` | the master polluted→clean blend |
| Toon crest highlight | `band = smoothstep(0.06,0.085,vWave); col += band*0.08` | white-ish cel band on wave crests (uses `vWave`) |
| Flowing stripes | `stripe = smoothstep(0.92,0.99, sin(vUv.x*46 + uTime*1.6)*0.5+0.5); col += stripe*(0.25 + uTransition*0.6)*0.12` | animated caustic stripes, **stronger when clean** |
| Murky scum specks | `scum = step(0.86, fract(sin(dot(floor(vUv*60), vec2(12.9,78.2)))*43758.5))`; `col = mix(col, col*0.7 + vec3(0.12,0.13,0.05), scum*(1-uTransition)*0.5)` | pseudo-random dark specks that **fade out as it cleans** (`1-uTransition`) |

### 5. The diorama (`SceneEnvironment`)

`SceneEnvironment` (`components/three/scene-environment.tsx:544-556`) simply renders the seven
sub-scenes in order, each handed the same `transition`:

```tsx
<Atmosphere/> <Sun/> <Land/> <Factory/> <Pipeline/> <Trees/> <Fish/>
```

Shared layout constants (`:9-13`): `PIPE_Z = -0.5`, `PIPE_Y = 0.4`, `PIPE_X0 = -8.5`,
`PIPE_X1 = 7`, `BANK_Y = -1.55` (the bank/ground plane height — nearly everything is anchored
relative to `BANK_Y`).

The pipeline node table (`NODES`, `:15-21`):

| key | label | x | color |
| --- | --- | --- | --- |
| `FM` | Flow Meter | -6 | `#22d3ee` (cyan) |
| `ETP` | ETP Unit | -3 | `#0ea5e9` (sky) |
| `RO` | RO System | 0 | `#6366f1` (indigo) |
| `MEE` | MEE System | 3 | `#8b5cf6` (violet) |
| `WATER` | Treated Water | 6 | `#10b981` (emerald) |

#### Atmosphere (`:28-84`)
Owns the **sky, fog, and lights**. On mount (`useEffect :45-51`) it sets
`scene.background = pollSky.clone()` and `scene.fog = new THREE.Fog("#9a9678", 34, 80)`; the
cleanup nulls the fog. Each frame (`:53-64`):
- background + fog color lerp `pollSky #9a9678 → cleanSky #bfe6ff` by `t`.
- directional light `intensity` lerps `0.55 → 1.7`; its color lerps `warm #f5e7c8 → bright #ffffff`.
- ambient light `intensity` lerps `0.55 → 0.95`.

Lights (JSX `:66-83`):
- `ambientLight` (base fill).
- `directionalLight` at `[10,16,8]`, `castShadow`, `shadow-mapSize [2048,2048]`,
  `shadow-bias -0.0004`, `shadow-normalBias 0.02`, with an attached
  `orthographicCamera` shadow frustum `args={[-24, 24, 24, -24, 0.5, 70]}` — this is the
  key/sun light and the only shadow caster.
- `hemisphereLight` `intensity 0.45`, sky `#bfe6ff`, ground `#5f6a45` (soft sky/earth bounce).

#### Sun (`:87-109`)
A fake sun at `[15, 10.5, -26]`, two stacked `circleGeometry` billboards:
- a large `r=6` **halo** with `AdditiveBlending`, `depthWrite=false`, `fog=false` — *fakes
  bloom* because post-processing is unavailable under Turbopack (see the inline comment `:98`).
- a `r=3` **core** whose material color lerps `dim #dccfa6 → bright #fff4cf` and whose
  `opacity` ramps `0.5 → 1.0` (`0.5 + t*0.5`) as the scene cleans.

#### Land (`:112-186`)
- A large ground **bank** plane (`180 × 34`) at `y = BANK_Y`, `z = -16`, `receiveShadow`. Its
  color lerps barren `#857b54 → green #4f9a48`.
- Ten **rolling hills** from the `HILLS` table (`:112-126`): squashed spheres
  (`sphereGeometry [r,36,24]`, `scale [1.5, fy, 1]`) placed along the horizon in three depth
  bands (distant/mid/near). Each hill's color lerps a per-hill barren↔green pair computed with
  `setHSL` (barren = desaturated HSL `(0.11, 0.22, light*0.85)`, green = `(hue, 0.42, light)`).
- Five low-poly **rocks** (`dodecahedronGeometry`, `flatShading`) scattered on the near
  shoreline, casting + receiving shadows.

#### Factory (mill parts) (`:188-330`)
A stylized textile mill anchored at `HALL = {x:-11.5, w:7, h:3.4, d:3.4, z:-4}`,
`HALL_T = BANK_Y + 0.5`. Parts:

| Part | Geometry / detail |
| --- | --- |
| Plinth | box `[w+0.6, 0.5, d+0.5]`, grey `#6a6f7a`, casts+receives |
| Main weaving hall | box `[w, h, d]`, off-white `#cdc7ba` |
| Front windows | 2 rows × 5 cols of small boxes, dark glass `#26323f` with `emissive #33506b` |
| Sawtooth "north-light" roof | 5 groups, each a slanted panel (`rot -0.62`) + a cyan glazing strip (`emissive #22d3ee`) — the classic textile-mill roofline |
| Secondary block | box `[2.6, 2.2, 2.8]` |
| Elevated water tank | 4 leg cylinders + tank body cylinder + cone cap, on a group at `[-6.4,0,-5.2]` |
| Silo | tall cylinder + cone cap at `[-9.2,0,-5.6]` |
| Chimneys ×2 | tapered stack `[0.3,0.44,4.3]` + red hazard band `#d1495b` + cap; tops at `chimneyTops` |
| Smoke | 90-point particle system emitted from the two chimney tops |

**Smoke** (`:215-226`): each frame every particle rises (`y += speed*delta*1.1`), wobbles in
x (`+= sin(y+i)*delta*0.16`), and wraps back to `BANK_Y+4.4` above `BANK_Y+13`. Crucially the
`PointsMaterial.opacity = max(0, (1 - t) * 0.42)` — **smoke fades to nothing as the river
cleans**.

#### Pipeline (FM / ETP / RO / MEE / Treated nodes) (`:333-441`)
Draws the treatment train and its animated flow:

- **Horizontal pipe**: box spanning `PIPE_X0..PIPE_X1` at `y=PIPE_Y, z=PIPE_Z`; its material
  `emissiveIntensity` ramps `0 → t*0.22` (glows as it cleans).
- **Factory feed**: a vertical box dropping from the factory into the pipe at `x=PIPE_X0`.
- **Treated outfall**: a sloped box (`rotation [0.34,0,0]`) running from the Treated node down
  into the river at `[6.5,-0.8,2.6]`.
- **5 nodes** (`NODES.map`, `:401-430`): each a plinth + a flat-shaded body box + a small
  cylinder "tank/stack" detail, plus a drei **`<Html>` badge** (`:424-428`) showing `n.key`,
  `center`, `distanceFactor={13}`, `zIndexRange={[8,0]}`, `pointerEvents="none"`.
- **Sequential activation** (`:356-364`): for node `i`,
  `active = clamp01((t - i*0.16) / 0.18)`. The body color lerps `gray #aab2c0 → node color`,
  and `emissiveIntensity = active*0.65`. So the nodes "power on" left→right as `t` grows (FM
  first at `t≈0`, Treated fully lit around `t≈0.82`).
- **Flow particles** (70 pts, `:367-379`): stream left→right along the pipe (`x += speed*delta`,
  wrap `PIPE_X1 → PIPE_X0`); `opacity = 0.25 + t*0.65` and color lerps `gray → colors[0]` as
  it cleans.

#### Trees (`:444-503`)
20 low-poly pines built from **three `InstancedMesh`es** (trunk cylinder + lower cone + upper
cone) sharing per-instance placement `data`. Placement keeps trees off the factory: right bank
`x ∈ [10,18]`, left bank `x ∈ [-20,-16.5]`. Each frame (`:465-486`):
- `grow = smoothstep(t, 0.25, 1)` — trees **grow in** after the transition passes ~0.25.
- per-tree `sway = sin(time*0.9 + phase)*0.04` (a slight z-rotation lean).
- scale = `data.scale * grow` (clamped `≥ 0.0001` to avoid a zero-scale matrix), written into
  each instance matrix (`setMatrixAt`), then `instanceMatrix.needsUpdate = true`.

#### Fish (`:506-542`)
9 orange cone "fish" in one `InstancedMesh`. Each frame (`:521-535`):
- `show = smoothstep(t, 0.55, 1)` — fish only **appear once the water is well past half-clean**.
- swim looping across `x ∈ [-18, 18]` (`((x + time*speed + 18) % 36) - 18`), bob in y, and
  wiggle their tail (`rotation.z = sin(time*4 + phase)*0.2`).
- `scale = max(0.0001, 0.5 * show)` — scale up from ~0 as they appear.

### 6. The DOM overlay (`ScrollOverlay`)

Rendered **over** the Canvas inside the pinned div (`landing-experience.tsx:40`). It receives
the same `MotionValue` as `progress` and reads it two ways:

- **Framer `useTransform`** for pure-DOM opacity/width animations (no React state):
  see the Reference table for the exact keyframes.
- **React state `p`** (`:22-23`) — `useMotionValueEvent` rounds progress to 2 decimals and
  `setP`, used for the discrete **5-step pipeline chips** (`STEPS`, `:10`) where a chip is
  `active = p > i * 0.18` (`:99`) and its connector fills at `p > (i+0.5)*0.18` (`:115`).

The overlay crossfades a **polluted headline** ("Untreated Textile Wastewater Harms Our
Rivers", fades out over `[0, 0.32]`) into a **clean headline** ("Clean Water, Restored.",
fades in over `[0.45, 0.8]`), reveals the **CTA** over `[0.78, 0.97]` (pointer-events gated at
`v > 0.8`), and fades the top bar out over `[0.92, 1]`. Two gradient **scrims** keep text
legible over the busy diorama.

### 7. Capability gating & fallback

```tsx
const reduced = usePrefersReducedMotion();   // matchMedia("(prefers-reduced-motion: reduce)")
const webgl   = useWebGLSupported();          // tries webgl2 || webgl context
const use3D   = webgl !== false && !reduced;  // :22
...
{use3D ? <RiverScene transition={transition} /> : <StaticHeroBackground clean />}  // :38
```

- `useWebGLSupported()` returns `null` until it has probed (SSR/first paint), so `use3D` is
  `true` optimistically (`null !== false`) unless reduced-motion is set — but `RiverScene`
  itself is `ssr:false` + dynamic, so nothing renders until the client anyway.
- **While the dynamic chunk loads**, the `loading` fallback is the *polluted*
  `<StaticHeroBackground />` (no `clean` prop) (`:11-14`).
- **When 3D is disabled** (no WebGL, or reduced motion), the *clean* `<StaticHeroBackground clean />`
  is shown instead — a static CSS-gradient sky, blurred sun, and two SVG wave bands.

---

## Reference

### Types

| Identifier | File:line | Definition |
| --- | --- | --- |
| `TransitionRef` | `components/three/types.ts:4` | `MutableRefObject<{ value: number }>` — shared `0→1` driver |

### `LandingExperience` (state / wiring)

| Symbol | Line | Notes |
| --- | --- | --- |
| `transition` | `:17` | `useRef({ value: 0 })`, passed to `RiverScene` |
| `sceneRef` / `homeRef` | `:18-19` | pinned-section wrapper / home-content anchor |
| `reduced` / `webgl` / `use3D` | `:20-22` | capability gates |
| `scrollYProgress` | `:24` | `useScroll({ target: sceneRef, offset: ["start start","end end"] })` |
| `t` | `:26` | `useTransform(scrollYProgress, [0, 0.66], [0, 1], { clamp: true })` |
| `useMotionValueEvent(t, "change", …)` | `:27-29` | writes clamped `v` into `transition.current.value` |
| `goHome` | `:31` | smooth-scrolls `homeRef` into view (Enter/Skip target) |
| Section | `:35` | `h-[320vh]` |
| Pinned div | `:36` | `sticky top-0 h-screen` |

### `RiverScene` / `CameraRig`

| Symbol | Line | Notes |
| --- | --- | --- |
| `<Canvas>` props | `:37-42` | `shadows`, `gl={antialias, alpha:false, high-performance, toneMappingExposure:1.08}`, `dpr=[1,1.8]`, `camera={pos:[0,5.4,22], fov:40, near:0.1, far:140}` |
| `CameraRig` FOV | `:16-24` | `narrow = aspect<1.1`; `targetFov = narrow ? clamp(44/aspect,40,74) : 40`; applied when `|Δ|>0.15` |
| `CameraRig` position | `:25-30` | `wf` pull-back; `x=sin(time*0.05)*0.6`; `y=(5.4+sin(time*0.2)*0.05)*…`; `z=lerp(22,20.5,t)*wf`; `lookAt(0,2.4,-2)` |

### `WaterPlane`

| Symbol | Line | Notes |
| --- | --- | --- |
| `uniforms` | `:12-18` | `{ uTime:{value:0}, uTransition:{value:0} }` |
| `useFrame` | `:20-24` | `uTime = clock.elapsedTime`; `uTransition = transition.current.value` |
| mesh | `:27-30` | `rotation=[-π/2,0,0]`, `position=[0,-2.25,10]`, `planeGeometry [150,110,100,64]` |

### Shader uniforms / varyings (`shaders/water.ts`)

| Name | Stage | Meaning |
| --- | --- | --- |
| `uTime` | vertex + fragment | animation clock |
| `uTransition` | fragment | `0→1` polluted→clean master mix |
| `vUv` | varying | plane UVs (depth gradient, stripes, scum) |
| `vWave` | varying | per-vertex crest height (toon highlight band) |

Palette constants (fragment): `pollutedTop (0.27,0.29,0.18)`, `pollutedBot (0.13,0.17,0.13)`,
`cleanTop (0.36,0.80,0.93)`, `cleanBot (0.09,0.45,0.78)`.

### `scene-environment.tsx` — constants & sub-scenes

**Constants** (`:9-13`): `PIPE_Z=-0.5`, `PIPE_Y=0.4`, `PIPE_X0=-8.5`, `PIPE_X1=7`,
`BANK_Y=-1.55`. **`HILLS`** table (`:112-126`, 10 entries). **`HALL`** (`:189`),
**`HALL_T = BANK_Y + 0.5`** (`:190`). **`clamp01`** helper (`:23`).

| Component | Line | Particle/instance count | Key transition mapping |
| --- | --- | --- | --- |
| `Atmosphere` | `:28` | — | sky/fog `#9a9678→#bfe6ff`; dir light `0.55→1.7` + `warm→bright`; amb `0.55→0.95` |
| `Sun` | `:87` | 2 billboards | core `dim→bright`; opacity `0.5→1.0`; halo = additive fake-bloom |
| `Land` | `:128` | 1 plane + 10 hills + 5 rocks | ground + each hill lerp barren→green |
| `Factory` | `:192` | 90 smoke pts | smoke opacity `(1-t)*0.42` (fades out) |
| `Pipeline` | `:333` | 5 nodes + 70 flow pts | node `active = clamp01((t - i*0.16)/0.18)`; pipe glow `t*0.22`; flow opacity `0.25+t*0.65` |
| `Trees` | `:444` | 20 (×3 instanced meshes) | `grow = smoothstep(t, 0.25, 1)` |
| `Fish` | `:506` | 9 instanced | `show = smoothstep(t, 0.55, 1)` |

### `ScrollOverlay` — Framer transforms (`scroll-overlay.tsx`)

| Symbol | Line | Mapping |
| --- | --- | --- |
| `STEPS` | `:10` | `["Flow Meter","ETP","RO","MEE","Treated"]` |
| `p` (state) | `:22-23` | `Math.round(v*100)/100` |
| `pollutedOpacity` | `:24` | `[0, 0.32] → [1, 0]` |
| `cleanOpacity` | `:25` | `[0.45, 0.8] → [0, 1]` |
| `hintOpacity` | `:26` | `[0, 0.12] → [1, 0]` |
| `topBarOpacity` | `:27` | `[0.92, 1] → [1, 0]` |
| `enterOpacity` | `:28` | `[0.78, 0.97] → [0, 1]` |
| `enterPointer` | `:29` | `v > 0.8 ? "auto" : "none"` |
| `barWidth` | `:30` | `[0, 1] → ["0%", "100%"]` |
| step `active` | `:99` | `p > i * 0.18` |
| connector fill | `:115` | `p > (i + 0.5) * 0.18 ? "100%" : "0%"` |

### Capability hooks (`lib/hooks/use-capabilities.ts`)

| Hook | Line | Returns |
| --- | --- | --- |
| `usePrefersReducedMotion()` | `:5` | `boolean` — tracks `(prefers-reduced-motion: reduce)` |
| `useWebGLSupported()` | `:17` | `boolean \| null` — `null` until probed, then `webgl2 \|\| webgl` context success |

### `StaticHeroBackground` prop

| Prop | Effect |
| --- | --- |
| `clean` (default `false`) | Swaps the sky gradient, sun opacity (`0.25` vs `0.9`), and SVG wave fills between polluted and clean palettes. Rendered `clean` when 3D is disabled; rendered *not* clean as the dynamic-import loader. |

---

## Gotchas & invariants

- **One driver, two readers, no per-frame React renders.** The 3D tree reads
  `transition.current.value` (a mutable ref) inside `useFrame`; the overlay reads the
  `MotionValue` via `useTransform`/`useMotionValueEvent`. Never wire the transition through
  React state into the Three.js components — that would re-render the whole scene 60×/sec.
- **`types.ts` comment is stale.** It says "mutated by GSAP" (`types.ts:3`); the actual driver
  is **Framer Motion** scroll. GSAP is a dependency but is not used here.
- **The transition completes at 66 % scroll, not 100 %** (`useTransform(..., [0, 0.66], …)`,
  `landing-experience.tsx:26`). The section is `320vh`; the scene is "cleaned" while still
  pinned so the CTA has room to breathe. Changing the section height without re-checking this
  keyframe will desync the "done" moment.
- **Two different node thresholds.** The 3D pipeline lights nodes with step `0.16`
  (`(t - i*0.16)/0.18`, `scene-environment.tsx:359`); the DOM overlay chips use step `0.18`
  (`p > i*0.18`, `scroll-overlay.tsx:99`). They *look* synced but are not identical formulas —
  edit both if you re-tune the cadence.
- **`NODES[].label` is dead data.** The 3D badge renders `n.key` (`scene-environment.tsx:426`),
  so the last node shows **`WATER`** in 3D while the overlay's `STEPS` shows **`Treated`**
  (`scroll-overlay.tsx:10`). The `label` field ("Treated Water", etc.) is never rendered.
- **No post-processing under Turbopack.** Next 16 forces Turbopack for dev *and* build, and
  `--no-turbopack`/`NEXT_DISABLE_TURBOPACK` don't work (`CLAUDE.md:23`). There is **no
  EffectComposer/bloom**. Glow is faked with geometry: the `Sun` halo uses
  `AdditiveBlending` (`scene-environment.tsx:98-101`), and "activation" glow uses material
  `emissive`/`emissiveIntensity`. Do not add `@react-three/postprocessing`.
- **Only one drei component is used: `Html`** (the node labels). Keep the drei surface minimal.
- **Instanced-matrix scale must stay non-zero.** Trees/Fish clamp scale to `≥ 0.0001`
  (`scene-environment.tsx:475, 530`) because a zero-scale matrix is non-invertible and warns.
  When `grow`/`show` are 0 the instances are effectively invisible but still valid.
- **`Atmosphere` mutates global scene state.** It writes `scene.background` and `scene.fog`
  directly and only nulls `fog` on unmount (`:45-51`). It relies on being the single owner of
  sky/fog — don't set those elsewhere.
- **Fallback has no animation loop.** `StaticHeroBackground` is pure CSS/SVG. Reduced-motion
  and no-WebGL users get a still frame — that is intentional; don't reintroduce rAF there.
- **Canvas is `alpha:false`.** The sky comes from `scene.background`, not CSS behind the
  canvas. If you make the canvas transparent, the sky disappears.
- **`far: 140` is load-bearing.** The farthest hills sit near `z ≈ -32` and the sun at
  `z = -26`; shrinking `far` (or the shadow-camera `70` far plane) can clip them.

---

## Related files

- `app/page.tsx` — route entry; renders `<LandingExperience />`.
- `components/landing/home/home-content.tsx` — the marketing content below the pinned scene
  (scroll target of the CTA / "Skip intro").
- `components/shared/logo.tsx` — `JalRakshakLogo` used in the overlay top bar.
- `components/ui/button.tsx` — the CTA button.
- `docs/pages/01-landing.md` — page-level walkthrough of the landing route (this doc is the
  deep-dive on the 3D scene specifically).
- `docs/architecture/data-layer.md`, `docs/architecture/security-and-roles.md` — the
  per-tenant Firestore data layer and role model that the app *behind* this landing page uses
  (unrelated to the scene, which is purely presentational and reads no app data).
- `CLAUDE.md` — architecture overview; see `:23` (Turbopack → no post-processing) and
  `:96-103, :138` (three/ + landing/ file map).
