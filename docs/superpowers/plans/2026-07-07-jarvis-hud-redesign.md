# JARVIS HUD Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the entire Nexus Remote frontend into a JARVIS-style holographic HUD (cyan + gold on near-black, Orbitron/Share Tech Mono typography, bracketed panels, event-based motion) with zero behavior change.

**Architecture:** One source of truth: `hud.*` color tokens and `font-display`/`font-data` families in `tailwind.config.js`, a `@layer components` HUD utility layer in `index.css` (panel brackets, glow, lines, all keyframes, global reduced-motion rule), and a single shared `components/hud/HudPanel.tsx` frame component. Every screen is then restyled file-by-file using only that vocabulary.

**Tech Stack:** React 19, Tailwind CSS 3, Vitest, `@fontsource/orbitron`, `@fontsource/share-tech-mono`.

## Global Constraints

- **Zero behavior change.** No user-visible string, placeholder, ARIA role, link target, prop, handler, or interaction flow changes. Only `className` values, wrapper elements that don't affect semantics, CSS, and the two config files change.
- **The 49 existing frontend tests must pass unmodified** (`npx vitest run`). They query by placeholder/role/text only (zero `.toHaveClass` usages) — if a test fails, the change broke behavior, not "just style". Backend untouched entirely.
- **No raw hex in components.** All color via `hud.*` Tailwind tokens or existing Tailwind palette names. Exception: `index.css` and `tailwind.config.js` define the hex values.
- **Gold (`hud.gold`, `#f59e0b`) is critical-only:** SYSTEM_POWER actions, Edit/armed mode, warnings, the executing badge. Red stays the destructive/error color. Never use gold decoratively.
- **Motion:** event-based only, `transform`/`opacity` only. Exactly two state-driven loops allowed: connected-status breathing ring, VoiceButton listening pulse. Global reduced-motion kill switch (defined once in Task 2).
- **Fonts self-hosted** via `@fontsource/*` npm packages — no CDN.
- After every task: `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean, then commit. All commands run from the repo root (`C:\Users\efeca\OneDrive\Masaüstü\nexus_remoter`).

## Shared restyle vocabulary (used by Tasks 3–9)

Old idiom → new idiom. Apply these consistently; anything not covered stays as-is.

| Old pattern (varies slightly per file) | New pattern |
|---|---|
| `bg-slate-900/60 border border-white/5 rounded-[2.5rem]` (and `rounded-[2rem]`/`rounded-3xl` card variants) | `<HudPanel>` component (or `hud-panel` class where a component swap is awkward) |
| `bg-slate-950/80 border border-white/5 rounded-2xl` (inputs) | `bg-hud-bg/80 border border-hud-dim rounded-sm font-data focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20` |
| `bg-slate-800 rounded-full` (icon chip buttons) | `hud-chip` class |
| `text-cyan-400` accents | `text-hud-cyan` |
| Cyan→indigo gradients (`from-cyan-500 to-indigo-500`) | `from-hud-cyan to-hud-gold` on primary CTAs; plain `bg-hud-cyan` elsewhere |
| `orange-500`/`orange-400` (edit mode) | `hud-gold` equivalents (deliberate hue migration per spec) |
| Headings/labels `font-black italic tracking-tighter` | `font-display font-bold uppercase tracking-[0.2em]` (drop italic) |
| Numeric/data text `font-mono` | `font-data` |
| Decorative blur blobs (`blur-[100px]` divs) | Remove; ConnectScreen gets the arc-reactor rings instead (Task 4) |

---

### Task 1: Fix Tailwind content globs (pre-existing prod CSS bug)

**Files:**
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces: Tailwind scanning of `components/**` and `hooks/**`, required by every later task.

- [ ] **Step 1: Prove the bug (RED)**

Run: `npm run build` then in Git Bash: `grep -c "rounded-\[2.5rem\]" dist/assets/*.css`
Expected: `0` — the class used by `components/ConnectScreen.tsx` is missing from the production bundle.

- [ ] **Step 2: Fix the globs**

Replace the `content` array in `tailwind.config.js`:

```js
content: [
  "./index.html",
  "./*.{js,ts,jsx,tsx}",
  "./components/**/*.{js,ts,jsx,tsx}",
  "./hooks/**/*.{js,ts,jsx,tsx}",
  "./services/**/*.{js,ts,jsx,tsx}",
],
```

- [ ] **Step 3: Verify (GREEN)**

Run: `npm run build` then `grep -c "rounded-\[2.5rem\]" dist/assets/*.css`
Expected: `1` or more. Also run `npx vitest run` → 49 passed.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.js
git commit -m "fix: scan components/ and hooks/ in Tailwind content globs

Classes used only inside components/ (e.g. ConnectScreen's rounded-[2.5rem])
were silently purged from the production CSS bundle because the content
array never listed those directories."
```

---

### Task 2: HUD foundation — tokens, fonts, CSS layer, HudPanel

**Files:**
- Modify: `tailwind.config.js`, `index.css`, `index.tsx`, `package.json`/`package-lock.json`
- Create: `components/hud/HudPanel.tsx`

**Interfaces:**
- Produces (used verbatim by Tasks 3–9):
  - Tailwind tokens: `hud-bg` `#020810`, `hud-panel` `#04121f`, `hud-cyan` `#22d3ee`, `hud-cyanBright` `#67e8f9`, `hud-gold` `#f59e0b`, `hud-dim` `#164e63`; families `font-display` (Orbitron), `font-data` (Share Tech Mono).
  - CSS classes: `hud-panel`, `hud-panel-gold`, `hud-chip`, `hud-glow`, `hud-glow-box`, `hud-line`, `animate-hud-boot`, `animate-hud-tick`, `animate-hud-breathe`, `animate-voice-bar-1..4`.
  - Component: `HudPanel` — `({ accent?: 'cyan' | 'gold' } & React.HTMLAttributes<HTMLDivElement>)`, default export from `components/hud/HudPanel.tsx`; renders a `div` with `hud-panel` (+ `hud-panel-gold` when `accent="gold"`), merging `className` and spreading the rest.

- [ ] **Step 1: Install fonts**

Run: `npm install @fontsource/orbitron @fontsource/share-tech-mono`

- [ ] **Step 2: Extend the Tailwind theme**

In `tailwind.config.js`, replace `theme: { extend: {} }` with:

```js
theme: {
  extend: {
    colors: {
      hud: {
        bg: "#020810",
        panel: "#04121f",
        cyan: "#22d3ee",
        cyanBright: "#67e8f9",
        gold: "#f59e0b",
        dim: "#164e63",
      },
    },
    fontFamily: {
      display: ['Orbitron', 'sans-serif'],
      data: ['"Share Tech Mono"', 'monospace'],
    },
  },
},
```

- [ ] **Step 3: Import fonts in `index.tsx`**

Add at the top of `index.tsx`, before the `./index.css` import:

```ts
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/share-tech-mono/400.css';
```

- [ ] **Step 4: Rewrite `index.css`**

Replace the whole file with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: #020810;
  color: #f8fafc;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  min-height: 100vh;
}

#root {
  min-height: 100vh;
}

@layer components {
  /* Bracketed HUD frame. Diagonal corner brackets (top-left + bottom-right). */
  .hud-panel {
    position: relative;
    background-color: rgb(4 18 31 / 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgb(34 211 238 / 0.25);
    border-radius: 2px;
  }
  .hud-panel::before,
  .hud-panel::after {
    content: '';
    position: absolute;
    width: 14px;
    height: 14px;
    pointer-events: none;
  }
  .hud-panel::before {
    top: -1px;
    left: -1px;
    border-top: 2px solid rgb(34 211 238 / 0.9);
    border-left: 2px solid rgb(34 211 238 / 0.9);
  }
  .hud-panel::after {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid rgb(34 211 238 / 0.9);
    border-right: 2px solid rgb(34 211 238 / 0.9);
  }
  .hud-panel-gold {
    border-color: rgb(245 158 11 / 0.35);
  }
  .hud-panel-gold::before {
    border-top-color: rgb(245 158 11 / 0.9);
    border-left-color: rgb(245 158 11 / 0.9);
  }
  .hud-panel-gold::after {
    border-bottom-color: rgb(245 158 11 / 0.9);
    border-right-color: rgb(245 158 11 / 0.9);
  }

  /* Small squared icon-button chip (replaces bg-slate-800 rounded-full). */
  .hud-chip {
    background-color: rgb(4 18 31 / 0.9);
    border: 1px solid rgb(34 211 238 / 0.25);
    border-radius: 2px;
    transition: border-color 150ms, color 150ms, box-shadow 150ms;
  }
  .hud-chip:hover {
    border-color: rgb(34 211 238 / 0.6);
    box-shadow: 0 0 10px rgb(34 211 238 / 0.15);
  }

  .hud-glow {
    text-shadow: 0 0 8px rgb(34 211 238 / 0.6);
  }
  .hud-glow-box {
    box-shadow: 0 0 12px rgb(34 211 238 / 0.35);
  }

  /* 1px divider with faded ends. */
  .hud-line {
    height: 1px;
    background: linear-gradient(to right, transparent, rgb(34 211 238 / 0.4), transparent);
  }

  .animate-hud-boot {
    animation: hud-boot 0.6s ease-out both;
  }
  .animate-hud-tick {
    animation: hud-tick 0.5s ease-out;
  }
  .animate-hud-breathe {
    animation: hud-breathe 2s ease-in-out infinite;
  }

  .animate-voice-bar-1 { animation: voiceBounce1 0.6s ease-in-out infinite; }
  .animate-voice-bar-2 { animation: voiceBounce2 0.75s ease-in-out infinite; }
  .animate-voice-bar-3 { animation: voiceBounce3 0.5s ease-in-out infinite; }
  .animate-voice-bar-4 { animation: voiceBounce4 0.85s ease-in-out infinite; }
}

@keyframes hud-boot {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes hud-tick {
  0% { color: #67e8f9; text-shadow: 0 0 10px rgb(103 232 249 / 0.9); }
  100% { color: inherit; text-shadow: none; }
}
@keyframes hud-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes voiceBounce1 {
  0%, 100% { transform: scaleY(0.4); }
  50% { transform: scaleY(1.2); }
}
@keyframes voiceBounce2 {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1.6); }
}
@keyframes voiceBounce3 {
  0%, 100% { transform: scaleY(0.6); }
  50% { transform: scaleY(1.1); }
}
@keyframes voiceBounce4 {
  0%, 100% { transform: scaleY(0.4); }
  50% { transform: scaleY(1.4); }
}

/* Single global reduced-motion kill switch (per spec §2). */
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Create `components/hud/HudPanel.tsx`**

```tsx
import React from 'react';

interface HudPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: 'cyan' | 'gold';
}

export default function HudPanel({ accent = 'cyan', className = '', children, ...rest }: HudPanelProps) {
  return (
    <div
      className={`hud-panel ${accent === 'gold' ? 'hud-panel-gold' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run` → 49 passed. `npx tsc --noEmit` → clean. `npm run build` → succeeds; `grep -c "hud-panel" dist/assets/*.css` → 1+ (proves the layer survives the build; `@layer components` classes are emitted when referenced — `HudPanel.tsx` references them, and Task 1's glob fix makes that visible to Tailwind).

- [ ] **Step 7: Commit**

```bash
git add tailwind.config.js index.css index.tsx components/hud/HudPanel.tsx package.json package-lock.json
git commit -m "feat: add HUD foundation (tokens, fonts, CSS layer, HudPanel)"
```

---

### Task 3: Header + stats bar

**Files:**
- Modify: `components/Header.tsx`

**Interfaces:**
- Consumes: `HudPanel` is NOT needed here (header is a bar, not a card); uses `hud-chip`, `hud-glow`, `animate-hud-breathe`, `animate-hud-tick`, `font-display`, `font-data`, `hud.*` tokens from Task 2.

- [ ] **Step 1: Restyle the header bar**

In `components/Header.tsx` apply exactly:

1. `<header>` class: `p-5 flex justify-between items-center bg-hud-panel/60 sticky top-0 z-40 backdrop-blur-xl border-b border-hud-cyan/20`.
2. Status dot (the `w-3 h-3 rounded-full ...` div) becomes an arc-reactor ring:
   - connected: `w-3 h-3 rounded-full border-2 border-hud-cyan bg-hud-cyan/20 hud-glow-box animate-hud-breathe`
   - disconnected: `w-3 h-3 rounded-full border-2 border-red-500 bg-red-500/20 animate-pulse` (unchanged semantics)
3. `<h1>` class: `text-xl font-display font-bold tracking-[0.25em] text-slate-100 hud-glow` (text stays exactly `NEXUS`).
4. IP `<span>` class: `text-[10px] font-data text-hud-cyan/60 uppercase tracking-widest`.
5. Settings and Scheduler buttons: replace `p-2 bg-slate-800 rounded-full ...` with `p-2 hud-chip text-hud-cyan/70 hover:text-hud-cyan` (keep `title` attributes and inner icons untouched).
6. DÜZENLE button: active state `bg-hud-gold text-slate-950 shadow-lg shadow-hud-gold/30`, inactive `hud-chip text-slate-400 hover:text-white`; add `font-display` to its base classes; keep `px-5 py-2 text-[10px]` sizing and both label strings.
7. Stats bar chips: each `bg-slate-900/50 px-4 py-2 rounded-xl border border-white/5 ...` div becomes `hud-panel px-4 py-2 flex items-center gap-2 shrink-0`; value `<span>`s become `text-xs font-bold font-data` and get `key={systemStats.cpu}` / `key={systemStats.ram}` respectively plus `animate-hud-tick` so the number flashes on change (battery chip: no key needed). Icon colors: CPU icon `text-hud-cyan`, RAM icon `text-hud-cyanBright`, battery stays `text-green-400`.

- [ ] **Step 2: Verify**

Run: `npx vitest run` → 49 passed. `npx tsc --noEmit` → clean. Visual: `npm run dev`, check header in connected and disconnected states.

- [ ] **Step 3: Commit**

```bash
git add components/Header.tsx
git commit -m "feat: restyle Header and stats bar in HUD language"
```

---

### Task 4: ConnectScreen

**Files:**
- Modify: `components/ConnectScreen.tsx`

**Interfaces:**
- Consumes: `HudPanel` from Task 2; `hud.*` tokens; `font-display`/`font-data`.

- [ ] **Step 1: Restyle**

1. Root div background: `min-h-screen bg-hud-bg flex flex-col items-center justify-center p-6 text-slate-100 font-sans relative overflow-hidden`.
2. Delete both decorative blur-blob divs. In their place, one static arc-reactor backdrop div (before the `w-full max-w-sm ...` container):

```tsx
<div
  aria-hidden="true"
  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[28rem] h-[28rem] rounded-full pointer-events-none opacity-40"
  style={{
    background:
      'radial-gradient(circle, transparent 54%, rgb(34 211 238 / 0.25) 55%, transparent 57%), ' +
      'radial-gradient(circle, transparent 40%, rgb(34 211 238 / 0.18) 41%, transparent 43%), ' +
      'radial-gradient(circle, transparent 25%, rgb(34 211 238 / 0.12) 26%, transparent 28%), ' +
      'radial-gradient(circle, rgb(34 211 238 / 0.10) 0%, transparent 18%)',
  }}
/>
```

(Static inline `style` with the ring gradients is the one sanctioned exception to the raw-hex rule — an arbitrary-value Tailwind class of this length is unreadable. `rgb(34 211 238 …)` is `hud.cyan`.)

3. Logo box (`bg-gradient-to-tr from-cyan-500 to-indigo-500 ... animate-pulse`): becomes `w-16 h-16 hud-panel flex items-center justify-center` with the `Shield` icon class changed to `text-hud-cyan hud-glow` — remove the `animate-pulse` (no decorative loops).
4. `NEXUS REMOTE` h1: `text-3xl font-display font-bold tracking-[0.2em] text-slate-100 hud-glow` (drop italic + gradient text).
5. Form card div (`bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-[2.5rem] p-6 ...`): replace the `div` with `<HudPanel className="p-6 shadow-2xl space-y-6">` (import `HudPanel from './hud/HudPanel'`).
6. Both inputs: swap `bg-slate-950/80 border border-white/5 rounded-2xl` for `bg-hud-bg/80 border border-hud-dim rounded-sm`; IP input font stays `font-mono` → change to `font-data`; PIN input `font-mono ... text-cyan-400` → `font-data ... text-hud-cyan`; focus classes → `focus:border-hud-cyan/60 focus:ring-1 focus:ring-hud-cyan/20`.
7. Trust link: `text-cyan-400/80 hover:text-cyan-300` → `text-hud-cyan/80 hover:text-hud-cyanBright` (text and href logic untouched).
8. Submit button: `bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold py-4 rounded-sm flex items-center justify-center gap-2 shadow-lg shadow-hud-cyan/15 active:scale-[0.98] disabled:opacity-50 transition-all text-sm uppercase tracking-[0.15em] hover:brightness-110`.
9. Labels (`PC IP ADRESİ`, `GÜVENLİK PIN KODU`): add `font-display`, color `text-hud-cyan/50`.

**Hard constraint reminder:** placeholders (`Örn: 192.168.68.57`, `0000`), all Turkish strings, the trust-link text/target and validation logic must remain byte-identical — 8 tests in `ConnectScreen.test.tsx` cover them.

- [ ] **Step 2: Verify**

Run: `npx vitest run components/ConnectScreen.test.tsx` → 8 passed, then full `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean. Visual check via `npm run dev`.

- [ ] **Step 3: Commit**

```bash
git add components/ConnectScreen.tsx
git commit -m "feat: restyle ConnectScreen as HUD panel with arc-reactor backdrop"
```

---

### Task 5: ButtonGrid

**Files:**
- Modify: `components/ButtonGrid.tsx`

**Interfaces:**
- Consumes: `hud.*` tokens, `hud-panel` classes. `ControlButton` has `steps: AutomationStep[]`; `AutomationStep.type` includes `'SYSTEM_POWER'` (from `types.ts`).

- [ ] **Step 1: Restyle tiles**

1. Add a helper above the component:

```tsx
const hasPowerAction = (btn: ControlButton) =>
  btn.steps.some(step => step.type === 'SYSTEM_POWER');
```

(`ActionType` is already imported into scope via `../types` — extend the import to `import { ControlButton, AutomationStep } from '../types';` only if needed; comparing against the string literal `'SYSTEM_POWER'` is fine since `ActionType.SYSTEM_POWER === 'SYSTEM_POWER'`.)

2. Tile button class: keep `btn.color` (user-chosen tile color is data, not theme) but replace the frame: `relative aspect-square rounded-sm flex flex-col items-center justify-center gap-3 shadow-xl active:scale-[0.97] transition-all group overflow-hidden border` + conditional: power tiles get `border-hud-gold/60 shadow-hud-gold/10`, others `border-hud-cyan/30`.
3. Icon container: `p-4 bg-black/30 rounded-sm group-hover:scale-110 transition-transform` and add `hud-glow-box` on power tiles only.
4. Label span: `font-display font-bold text-[10px] uppercase tracking-[0.15em] opacity-90`.
5. Edit-mode badge: `bg-orange-500` → `bg-hud-gold` (keep the rest, including `animate-pulse` — it signals armed state, allowed as state-driven).
6. "Ekle" button: `rounded-[2rem] border-2 border-dashed border-slate-700/60` → `rounded-sm border-2 border-dashed border-hud-gold/40 text-hud-gold/60 hover:border-hud-gold hover:text-hud-gold` (edit mode is gold/armed), keep sizing/behavior.

- [ ] **Step 2: Verify**

Run: `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean. Visual: tiles with and without SYSTEM_POWER steps, edit mode on/off.

- [ ] **Step 3: Commit**

```bash
git add components/ButtonGrid.tsx
git commit -m "feat: restyle ButtonGrid as HUD tiles with gold power accents"
```

---

### Task 6: MediaControls + VoiceButton

**Files:**
- Modify: `components/MediaControls.tsx`, `components/VoiceButton.tsx`

**Interfaces:**
- Consumes: `hud-panel`/`hud-chip` classes, `animate-voice-bar-1..4` (already defined in `index.css` by Task 2), `hud.*` tokens.

- [ ] **Step 1: VoiceButton — remove the inline `<style>` block**

Delete the entire `<style dangerouslySetInnerHTML={...} />` element (the keyframes and `.animate-voice-bar-*` classes now live in `index.css` from Task 2, byte-identical). The fragment wrapper `<>...</>` can stay or collapse to the bare button.

- [ ] **Step 2: VoiceButton — recolor to HUD**

State classes on the `<button>`:
- recording: unchanged (red = destructive/live-recording is correct).
- processing: `bg-hud-cyan text-slate-950 shadow-[0_0_15px_rgb(34_211_238_/_0.5)] animate-pulse`.
- idle: `bg-hud-panel border border-hud-gold/60 text-hud-gold shadow-[0_0_10px_rgb(245_158_11_/_0.25)] hover:brightness-125` (gold-cored idle per spec), and change the shape from `rounded-full` to `rounded-sm` in the shared base classes.
The recording ping/pulse rings stay red and keep `animate-ping`/`animate-pulse` (permitted listening loop).

- [ ] **Step 3: MediaControls**

Read the file first. Apply the shared vocabulary table:
- The outer card (`bg-slate-900/60 ... rounded-[2rem]` around line 100) → `<HudPanel className="...">` keeping its padding/layout classes (import `HudPanel from './hud/HudPanel'`).
- All media-key buttons (`bg-slate-800 rounded-full`-style) → `hud-chip` + `text-hud-cyan/80 hover:text-hud-cyan`, `rounded-sm`.
- The volume slider (`<input type="range">`): track/thumb restyle to a thin cyan line with glowing thumb via Tailwind arbitrary variants on the element's className:
  `appearance-none w-full h-[3px] rounded-full bg-hud-dim [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-hud-cyan [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgb(34_211_238_/_0.8)] [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-hud-cyan`
  (replacing whatever slider classes exist; keep `min`/`max`/`value`/handlers untouched).
- Any volume percentage text → `font-data`.

- [ ] **Step 4: Verify**

Run: `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean. Visual: volume slider drag, media keys, voice button in all three states (idle/recording/processing).

- [ ] **Step 5: Commit**

```bash
git add components/MediaControls.tsx components/VoiceButton.tsx
git commit -m "feat: restyle MediaControls and VoiceButton, move voice keyframes to index.css"
```

---

### Task 7: App.tsx — nav dock, tabs, executing badge, boot transition

**Files:**
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `HudPanel`, `hud-chip`, `animate-hud-boot`, `hud.*` tokens, `font-display`/`font-data`.
- Produces: nothing consumed later.

- [ ] **Step 1: App background**

Find the root wrapper div (top of the returned JSX) and change `bg-slate-950` (or equivalent) to `bg-hud-bg`.

- [ ] **Step 2: Boot transition**

Add near the other `useState` calls:

```tsx
const [bootKey, setBootKey] = useState(0);
const prevStatus = useRef(connection.connectionStatus);
useEffect(() => {
  if (prevStatus.current !== 'connected' && connection.connectionStatus === 'connected') {
    setBootKey(k => k + 1);
  }
  prevStatus.current = connection.connectionStatus;
}, [connection.connectionStatus]);
```

(`useRef`/`useEffect` are already imported in App.tsx; extend the import if not.) Then put `key={bootKey}` and `className="animate-hud-boot"` on the wrapper `div` that contains the tab content area (the element that switches between remote/AI/scheduler tab content — NOT on `<header>`), so panels replay the 600ms fade-up once per new connection. `bootKey === 0` on first mount also plays it once — acceptable.

- [ ] **Step 3: Bottom nav dock (lines ~516-561)**

- Nav inner container: `bg-slate-900/80 backdrop-blur-2xl border border-white/5 rounded-3xl` → `hud-panel` (keep `p-2 flex justify-around items-center pointer-events-auto w-full max-w-md`, drop the custom shadow).
- Each tab button: active state `text-cyan-400 bg-cyan-500/10` → `text-hud-cyan bg-hud-cyan/10 hud-glow`; inactive unchanged. Tab label spans get `font-display` added; `rounded-2xl` → `rounded-sm`.
- The edit-tab active tint `text-orange-400 bg-orange-400/10` (line ~390 area) → `text-hud-gold bg-hud-gold/10`.

- [ ] **Step 4: Executing badge (lines ~590-594)**

`bg-cyan-500 text-slate-950 px-4 py-2.5 rounded-full ... animate-pulse` → `hud-panel hud-panel-gold text-hud-gold px-4 py-2.5 flex items-center gap-2 animate-pulse`; the inner spinner icon `text-slate-950` → `text-hud-gold`; the label span adds `font-data` (replacing `font-black`), keeps size/tracking and the `İŞLENİYOR:` text.

- [ ] **Step 5: AI tab + Scheduler tab inline panels (lines ~406-493)**

- AI tab card `bg-slate-900/60 border border-white/5 rounded-3xl` → `<HudPanel className="...">` keeping padding/layout (import `HudPanel from './components/hud/HudPanel'`).
- Icon containers `bg-cyan-500/10` → `bg-hud-cyan/10`, `bg-indigo-500/10` → `bg-hud-cyan/10`; any `text-cyan-400` → `text-hud-cyan`; headings in these tabs get `font-display`.
- Any other `rounded-3xl`/`rounded-2xl` card-like divs inside these two tab sections follow the shared vocabulary table.

- [ ] **Step 6: Verify**

Run: `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean. Visual: tab switching, boot animation on fresh connect (pair → watch panels fade up once), executing badge during a command.

- [ ] **Step 7: Commit**

```bash
git add App.tsx
git commit -m "feat: restyle App shell (nav dock, tabs, executing badge) and add boot transition"
```

---

### Task 8: Modals — EditModal, SchedulerModal, CommandPreviewModal

**Files:**
- Modify: `components/EditModal.tsx`, `components/SchedulerModal.tsx`, `components/CommandPreviewModal.tsx`

**Interfaces:**
- Consumes: `HudPanel`, `hud.*` tokens, `font-display`/`font-data`.

- [ ] **Step 1: SchedulerModal (fully specified — smallest)**

- Modal card `bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl border border-white/10` → `<HudPanel className="w-full max-w-sm p-8 shadow-2xl">`.
- `BOSS MODE` h2: add `font-display`, drop `italic`; `Clock` icon `text-cyan-400` → `text-hud-cyan`.
- Subtitle: `text-slate-500` stays, add `font-display tracking-[0.2em]`.
- Textarea container `bg-cyan-500/10 border border-cyan-500/20 rounded-2xl` → `bg-hud-cyan/5 border border-hud-cyan/20 rounded-sm`.
- Action buttons: primary → `bg-gradient-to-r from-hud-cyan to-hud-gold text-slate-950 font-display font-bold rounded-sm` (keep paddings/handlers); cancel/secondary → `hud-chip`.

- [ ] **Step 2: EditModal and CommandPreviewModal (vocabulary-driven)**

Read each file, then apply the shared vocabulary table throughout:
- Outer modal card (`bg-slate-900/90 ... rounded-[2.5rem]` in CommandPreviewModal ~line 89; equivalent in EditModal) → `<HudPanel className="...">` preserving layout classes.
- Headings → `font-display font-bold uppercase tracking-[0.15em]`, drop `italic`.
- Inputs/textareas → the input recipe from the vocabulary table.
- Primary action buttons → cyan→gold gradient recipe; destructive buttons stay red; secondary → `hud-chip`.
- CommandPreviewModal's auto-execution countdown number → `font-data text-hud-gold` (spec: countdown renders in data-font gold). Its SYSTEM_POWER-related warning accents (if orange/amber already) → `hud-gold` tokens.
- Step-list rows / chips inside CommandPreviewModal → `border-hud-dim` borders, `text-hud-cyan` icons.

- [ ] **Step 3: Verify**

Run: `npx vitest run` → 49 passed, `npx tsc --noEmit` → clean. Visual: open every modal (edit a button, scheduler, voice command preview with countdown).

- [ ] **Step 4: Commit**

```bash
git add components/EditModal.tsx components/SchedulerModal.tsx components/CommandPreviewModal.tsx
git commit -m "feat: restyle Edit, Scheduler and CommandPreview modals as HUD panels"
```

---

### Task 9: SettingsPage + ToastContainer + final verification

**Files:**
- Modify: `components/SettingsPage.tsx`, `components/ToastContainer.tsx`

**Interfaces:**
- Consumes: `HudPanel`, `hud.*` tokens, `font-display`/`font-data`.

- [ ] **Step 1: ToastContainer (fully specified)**

Replace `TOAST_STYLES` with:

```tsx
const TOAST_STYLES: Record<Toast['type'], { bg: string; border: string; icon: React.ReactNode }> = {
  success: {
    bg: 'bg-emerald-600/90',
    border: 'border-emerald-400/40',
    icon: <CheckCircle size={18} />
  },
  error: {
    bg: 'bg-red-600/90',
    border: 'border-red-400/40',
    icon: <AlertCircle size={18} />
  },
  warning: {
    bg: 'bg-hud-gold/90',
    border: 'border-hud-gold/40',
    icon: <AlertTriangle size={18} />
  },
  info: {
    bg: 'bg-hud-panel/95',
    border: 'border-hud-cyan/40',
    icon: <Info size={18} />
  }
};
```

Toast row div: `rounded-2xl` → `rounded-sm`; add `hud-panel` styling is NOT used here (toasts carry their own type colors); instead add corner-bracket feel via `border` (already present) — keep it slim: `p-4` → `p-3.5`. Message span adds `font-data` (replacing `font-bold` is NOT allowed — keep `font-bold`, just add `font-data`). Everything else (icons, close button, animation) unchanged.

- [ ] **Step 2: SettingsPage (vocabulary-driven — the big one)**

Read the file fully first (~428 lines, multiple section cards). Apply:
- Every section card (`bg-slate-900/60 ... rounded-*` pattern) → `<HudPanel className="...">` preserving padding/layout (import `HudPanel from './hud/HudPanel'`).
- Section headings → `font-display font-bold uppercase tracking-[0.15em]`.
- Custom toggle switches: off-state track `bg-hud-dim`, on-state track `bg-hud-cyan` with thumb `shadow-[0_0_8px_rgb(34_211_238_/_0.8)]` (find the toggle's track/thumb divs and swap their color classes; keep the translate/transition mechanics).
- Sliders: same `[&::-webkit-slider-thumb]:...` recipe as Task 6 Step 3.
- Danger zone: keep ALL red classes exactly as-is (red = destructive, per spec) — only swap card frames to `<HudPanel accent="cyan">` and typography to `font-display` headings.
- Version-info footer text → `font-data`.
- Any `text-cyan-400`/`bg-cyan-500/10` accents → `hud` token equivalents per the vocabulary table.

- [ ] **Step 3: Full verification sweep**

- `npx vitest run` → 49 passed.
- `npx tsc --noEmit` → clean.
- `npm run build` → succeeds. Record the CSS+JS bundle size delta vs. the pre-redesign build in the commit body (fonts should add roughly 50-100KB of woff2 assets).
- `grep -rn "orange-" components/ App.tsx` → 0 hits (gold migration complete).
- `grep -rn "dangerouslySetInnerHTML" components/` → 0 hits.
- Manual pass with `npm run dev` through the spec §5 checklist: every screen and modal, connected + disconnected states, edit mode, an error toast, reduced-motion emulation (DevTools → Rendering → prefers-reduced-motion) showing no animation.

- [ ] **Step 4: Commit**

```bash
git add components/SettingsPage.tsx components/ToastContainer.tsx
git commit -m "feat: restyle SettingsPage and ToastContainer, complete HUD redesign"
```

---

## Plan Self-Review Notes

- **Spec coverage:** §0 globs → Task 1. §1 tokens/fonts/primitives → Task 2. §2 motion (boot/tick/breathe/reduced-motion/voice keyframe migration) → Tasks 2, 3, 6, 7. §3 screens: Header→3, ConnectScreen→4, ButtonGrid (incl. orange→gold)→5, MediaControls+VoiceButton→6, App inline panels+nav+badge→7, modals→8, SettingsPage+Toasts→9. §4 constraints reproduced in Global Constraints. §5 verification → per-task verify steps + Task 9 sweep.
- **No placeholders:** foundation tasks carry complete code; restyle tasks carry either exact class strings (Header, ConnectScreen, ButtonGrid, VoiceButton, SchedulerModal, ToastContainer — files read during planning) or the shared vocabulary table plus named element-level requirements (MediaControls, EditModal, CommandPreviewModal, SettingsPage, App.tsx — implementer reads the file first; the table defines the exact target classes).
- **Type consistency:** `HudPanel` props (`accent?: 'cyan' | 'gold'`) match all usages; CSS class names in Tasks 3-9 all exist in Task 2's `index.css`; token names (`hud-bg`, `hud-panel`, `hud-cyan`, `hud-cyanBright`, `hud-gold`, `hud-dim`) match the Tailwind config exactly.
