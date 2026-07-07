# JARVIS HUD Redesign — Design

## Problem

The Nexus Remote frontend works well but looks like a generic dark mobile
app: slate backgrounds, cyan/indigo gradients, fully rounded cards, Inter
everywhere. The user wants a sci-fi "JARVIS from Iron Man" feel — a
holographic HUD aesthetic — across the whole app, without breaking any
existing functionality or test.

## Scope

In scope (all screens, one consistent HUD language):
- Header + system stats bar
- ConnectScreen
- ButtonGrid (main dashboard)
- MediaControls, VoiceButton
- EditModal, SchedulerModal, CommandPreviewModal
- SettingsPage
- ToastContainer

Out of scope (YAGNI):
- Any behavioral change: no new features, no changed flows, no changed copy.
- Theming/toggle infrastructure for multiple themes — this app has one theme.
- Sound effects, haptics changes, or a JARVIS voice persona.
- Continuous/looping ambient animations (see Motion).

## Approach (decided)

Tailwind theme extension + shared HUD primitives. Rejected alternatives:
per-component freestyle restyling (repeats today's inconsistency problem) and
a full wrapper-component design system (too heavy for a single-theme app).

## Design

### 0. Prerequisite fix: Tailwind content globs

`tailwind.config.js`'s `content` array currently lists only `./index.html`,
root-level files, and `./services/**` — **`./components/**` and `./hooks/**`
are not scanned.** Verified consequence: classes used only inside
`components/` (e.g. `rounded-[2.5rem]`) appear zero times in the production
CSS bundle today — they are silently purged. This is a real pre-existing
bug, and it would also purge every new `hud.*` class this redesign adds.
The first implementation task fixes the globs:

```js
content: [
  "./index.html",
  "./*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}",
  "./hooks/**/*.{js,ts,jsx,tsx}",
  "./services/**/*.{js,ts,jsx,tsx}",
]
```

### 1. Visual language — single source of truth

**Palette** (defined once as Tailwind tokens under `theme.extend.colors.hud`;
no component writes raw hex):

| Token | Value | Use |
|---|---|---|
| `hud.bg` | `#020810` | App background (near-black, blue cast) |
| `hud.panel` | `#04121f` | Panel fill (used at ~70% opacity + blur) |
| `hud.cyan` | `#22d3ee` | Primary hologram color: borders, icons, actives |
| `hud.cyanBright` | `#67e8f9` | Glow cores, emphasized values |
| `hud.gold` | `#f59e0b` | Critical accents ONLY: SYSTEM_POWER actions, warnings, Edit mode |
| `hud.dim` | `#164e63` | Inactive lines, muted borders |

Error red (existing `red-400/500`) stays for errors. Gold is deliberately
scarce — it must read as "critical", so it never decorates neutral UI.

**Typography** (self-hosted via npm `@fontsource/*` packages — no CDN, so
the PWA keeps working offline):
- `@fontsource/orbitron` — display: NEXUS logo, section headings, button
  labels. Always uppercase with wide tracking.
- `@fontsource/share-tech-mono` — data: IP, PIN, CPU/RAM/battery values,
  countdowns, anything numeric.
- Inter (existing) remains for body/paragraph text — readability first.

Tailwind gains `fontFamily.display` (Orbitron) and `fontFamily.data`
(Share Tech Mono); components use `font-display` / `font-data` utilities.

**HUD primitives:**
- `components/hud/HudPanel.tsx` — the one shared frame component: sharp
  corners (2px radius), 1px `hud.cyan/30` border, corner brackets drawn with
  `::before`/`::after` (targeting-box feel), `hud.panel/70` backdrop-blur
  fill. Props: `accent?: 'cyan' | 'gold'` (border/bracket color) and
  standard `className`/`children`. It replaces today's
  `rounded-[2.5rem] bg-slate-900/60 border-white/5` card idiom everywhere.
- `index.css` utility layer (defined once, used by class name):
  - `.hud-glow` — cyan text/box glow (small, subtle)
  - `.hud-line` — 1px horizontal cyan divider with faded ends
  - `.hud-scan` — one-shot scanline sweep (used only by the boot transition)
  - keyframes: `hud-boot` (fade-up + scan, ~600ms), `hud-pulse` (pressed
    glow), `hud-tick` (value-change flash), `hud-breathe` (2s status ring)
  - `prefers-reduced-motion` is handled by ONE global rule (not per-keyframe
    media queries):
    `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`

### 2. Motion — event-based only, CSS-only

- **Boot transition:** when `connectionStatus` becomes `connected`, the main
  dashboard panels play a one-shot ~600ms staggered fade-up with a single
  scanline sweep. Plays once per connection, not on every render.
- **Press feedback:** buttons keep the existing `active:scale-*` and add a
  brief cyan glow pulse.
- **Value ticks:** CPU/RAM numbers flash `hud.cyanBright` briefly when the
  value changes (CSS animation re-triggered via `key={value}`).
- **Status indicator:** the green/red dot becomes a small arc-reactor-style
  ring that "breathes" (2s opacity cycle) when connected, static red when
  disconnected.
- **No decorative looping animation.** Exactly two state-driven loops are
  permitted: the connected-status breathing ring above, and VoiceButton's
  pulse while actively listening. Nothing else loops. All animation uses
  `transform`/`opacity` only (GPU-friendly), and everything is disabled
  under `@media (prefers-reduced-motion: reduce)`.

### 3. Screen-by-screen

- **Header:** NEXUS wordmark in Orbitron with `.hud-glow`; round icon
  buttons become squared HUD chips (small HudPanel-styled buttons); stats
  bar chips become bracketed mini-panels with `font-data` values and
  `hud-tick` on change.
- **ConnectScreen:** the form card becomes a `HudPanel`; behind it a static
  (non-animated) concentric arc-reactor ring pattern built from pure CSS
  radial/conic gradients replaces the current blur blobs; the submit button
  becomes a cyan→gold gradient with Orbitron label. All placeholders, texts,
  the trust link, and validation messages stay byte-identical.
- **ButtonGrid:** cards become bracketed HUD tiles with cyan-glow icons.
  Tiles whose steps include a `SYSTEM_POWER` action get `accent="gold"`.
  Edit mode switches tiles to amber dashed borders (gold = critical/armed).
  Note: the existing `orange-500` edit-mode indicators (Header's DÜZENLE
  button, ButtonGrid's delete/edit chips, App.tsx's edit-tab tint) migrate
  to `hud.gold` — this is a deliberate orange→amber hue change so the app
  has one "armed/critical" color, not two near-misses.
- **MediaControls:** volume slider restyled as a thin cyan track with a
  glowing thumb; media buttons become HUD chips.
- **VoiceButton:** keeps its existing listening pulse but recolored to the
  HUD cyan ring language; idle state is a gold-cored circular HUD button.
  Its current four `voiceBounce1-4` keyframes are injected via a
  `dangerouslySetInnerHTML` `<style>` block — they move into `index.css`'s
  utility layer alongside the new `hud-*` keyframes, and the
  `dangerouslySetInnerHTML` block is deleted (cleanup that also puts the
  keyframes under the global reduced-motion rule).
- **Modals (Edit / Scheduler / CommandPreview):** all switch to HudPanel
  frames with Orbitron headings; CommandPreview's auto-execution countdown
  renders in `font-data` gold.
- **SettingsPage:** the app's largest component (~430 lines, multiple
  independent section cards). Section cards become HudPanels with Orbitron
  headings. Custom toggle switches: dim `hud.dim` track when off, cyan
  track + glowing thumb when on. Sliders: same thin-cyan-track treatment as
  MediaControls. The danger zone (reset/disconnect actions) keeps RED — red
  stays the destructive color; gold means "critical/armed", not
  "destructive". Version-info footer goes `font-data`.
- **App.tsx inline panels:** App.tsx renders panel-like UI directly (AI tab
  card, Scheduler tab icon container, and the fixed "İŞLENİYOR" executing
  badge). These migrate to HudPanel / `hud.*` tokens in place — no
  component extraction (out of scope; restyling only).
- **Bottom nav bar (App.tsx):** the fixed tab bar becomes a bracketed HUD
  dock: `hud.panel` fill, cyan glow on the active tab, `font-display`
  labels. The "İŞLENİYOR" badge becomes a slim gold-bracketed chip with
  `font-data` text (it signals live execution — gold fits).
- **ToastContainer:** toasts become slim bracketed panels — cyan (info),
  green (success, unchanged hue), gold (warning), red (error).

### 4. Binding constraints

- **Zero behavior change.** No user-visible string, placeholder, ARIA role,
  link target, or interaction flow changes. The existing 49 frontend tests
  must pass unmodified — they are the regression net for this redesign.
  (Backend untouched entirely.)
- **Fonts self-hosted** via `@fontsource/orbitron` and
  `@fontsource/share-tech-mono` imported in `index.tsx`/`index.css`; no
  external font CDN (PWA offline + no new origin).
- **No raw hex in components** — all color goes through the `hud.*` Tailwind
  tokens; one-off values are a design smell and a review flag.
- **Performance:** no continuous animations; `transform`/`opacity` only;
  `prefers-reduced-motion` honored globally.
- **Bundle:** the two font packages add ~50-100KB of woff2 total (each font
  loaded in 1-2 weights only, latin subset). Acceptable for a PWA that is
  installed once; no other new runtime dependencies.

### 5. Verification

- `npx vitest run` green (49 tests, unmodified) after every task. Verified
  ahead of time: no test anywhere asserts on CSS class names
  (zero `.toHaveClass` usages), so tests are style-agnostic by construction
  — they query by placeholder text, role, and visible text only.
- `npx tsc --noEmit` clean.
- `npm run build` succeeds; bundle size delta noted in the final report.
- Manual visual pass with `npm run dev` across every screen and modal, in
  both connected and disconnected states, including Edit mode and an error
  toast — this is a visual project; automated tests cannot judge the result.
