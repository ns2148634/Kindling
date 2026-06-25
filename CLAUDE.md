# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start Vite dev server at localhost:5173
npm run build     # Production build → dist/
npm run preview   # Preview production build

# Playwright layout / feature verification (requires dev server running)
node verify-layout.mjs
node verify-m2.mjs
```

Push to GitHub (token already stored in remote URL):
```bash
git add <files> && git commit -m "..." && git push origin main
```

## Architecture

**Vite + vanilla ES modules, no framework.** Entry point is `index.html` → `src/main.js`.

### Module responsibilities

| File | Role |
|------|------|
| `src/constants.js` | Canvas geometry (`W=400`, `TS=18`, `OX=200`, `OY=212`, `q=2`), colour palette `COL`, coordinate helpers `cx(c)` / `cy(r)` |
| `src/state.js` | Mutable game state object, `growElement(attr)`, `initState(saved)`, `serializeState()` |
| `src/renderer.js` | Canvas 2D draw loop — pixel-art sprites via `drawPixels()`, painter's-algorithm sort for buildings, citizens drawn last (always on top) |
| `src/idb.js` | Thin IndexedDB wrapper: `idb.get(store, key)` / `idb.put(store, value)` |
| `src/cards.js` | Seeded RNG (FNV-1a + xorshift32), daily card draw/cache, `swapSurprise()` |
| `src/main.js` | Boot, rAF loop, card/codex UI, full-screen bg-canvas stars |

### Canvas layering

Two canvases stack via CSS:

1. `#bg-canvas` — `position:fixed; z-index:-1` — full-screen twinkling stars, redrawn every frame by `drawBg(now)` in `main.js`
2. `#kingdom` — transparent background, renders only island elements (land tiles → buildings sorted by y → citizens on top)

Logical canvas size is always 400×400 px; CSS display size is set by a `ResizeObserver` to `min(wrap-width, wrap-height)` so it stays square on any screen.

### State & persistence (IndexedDB `kindling` v1)

Three stores:
- `kingdom` (keyPath `id='v1'`) — land array, buildings, towers `[c,r,h]`, citizenCount, counts per attribute
- `daily` (keyPath `date='YYYY-MM-DD'`) — today's 3 cards + completion flags + swapsUsed
- `codex` (keyPath `id='v1'`) — flat array of completed-card entries `{date, attribute, text}`

`citizens` and `pulses` are **runtime-only** — never persisted, rebuilt from `citizenCount` on load.

### Growth rules (`growElement(attr)`)

Returns `{ x, y }` on success or `{ blocked: reason }` on failure. `state.counts[attr]++` only increments on success.

- **courage** → expands `state.land` to an adjacent free tile (bounded by `LAND_C_MAX=6`, `LAND_R_MIN/MAX=±4`)
- **warmth** → places a house on a free (unoccupied) land tile
- **curiosity** → places a tree on a free land tile
- **focus** → places a tower, or raises an existing one up to `TOWER_MAX_H=6`
- **vitality** → adds a citizen, capped at `state.land.length`

`occupiedSet()` includes houses + towers + trees — all three mark a tile as taken.

### Layout (index.html — all CSS inline in `<style>`)

One-screen layout (`100dvh`, no scroll) on `#view-home`:
- `#kingdom-section` (`flex: 1`) — canvas fills the upper half; `ResizeObserver` keeps `#kingdom` square (`min(wrap-w, wrap-h)`)
- `#cards-section` (`flex-shrink: 0`) — three compact cards stacked vertically below the canvas
- `#bottom-nav` (`position: fixed; bottom: 0`) — two tabs only: **首頁** / **圖鑑**
- `safe-area-inset-top/bottom` applied; `#view-home` has `padding-bottom: calc(56px + env(safe-area-inset-bottom))` to clear the nav
- `#view-codex` scrolls internally (`overflow-y: auto`); home view does not scroll

`verify-layout.mjs` injects a pre-onboarded IDB state before testing so the home view is always visible.

### Daily card system

Cards are drawn deterministically: `seededRNG(hash32(date))` guarantees the same 3 cards all day. The drawn result is cached in IDB on first access. Swap uses seed `date + ':swap:' + swapsUsed` for stable replay.

Direction is stored in `state.direction` (set during onboarding); `cards.js` reads it at draw time.

### Card JSON schema (`public/cards/`)

```json
{ "id": "...", "attribute": "courage|vitality|curiosity|warmth|focus",
  "role": "safe|main|surprise", "text": "...", "tone": "...", "difficulty": 1 }
```

Three pools: `safe.json` (5 cards, one per attribute), `main.json` (9 cards, direction-weighted), `surprise.json` (5 absurd cards, swappable once/day).

## Upcoming milestones

- **M3** — Onboarding flow, replace `DIRECTION` constant with user-chosen direction
- **M4** — PWA shell, offline support, static card cache
- **M5** — Supabase Auth + schema + RLS + local-first sync
