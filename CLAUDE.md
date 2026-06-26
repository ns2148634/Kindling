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

### State & persistence (IndexedDB `kindling` v2)

Four stores (IDB v2):
- `kingdom`    (keyPath `id='v1'`) — land array, buildings, towers `[c,r,h]`, citizenCount, counts per attribute
- `daily`      (keyPath `date='YYYY-MM-DD'`) — today's 3 cards + completion flags + swapsUsed
- `codex`      (keyPath `id='v1'`) — **故事 store（append-only）**: every completion is one entry `{id, date, cardId, title, action, attribute}`; backward-compat: old entries without `title`/`action` fall back to `text`
- `collection` (keyPath `id='v1'`) — **收藏 store（去重）**: `{cardId, count, firstDate, lastDate, title, attribute, text, rarity}`; one entry per cardId, `count++` on repeat; **無 story 欄**

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
- `#bottom-nav` (`position: fixed; bottom: 0`) — two tabs only: **首頁** / **卡冊**
- `safe-area-inset-top/bottom` applied; `#view-home` has `padding-bottom: calc(56px + env(safe-area-inset-bottom))` to clear the nav
- `#view-codex` scrolls internally (`overflow-y: auto`); home view does not scroll

`verify-layout.mjs` injects a pre-onboarded IDB state before testing so the home view is always visible.

### Daily card system

Cards are drawn deterministically: `seededRNG(hash32(date))` guarantees the same 3 cards all day. The drawn result is cached in IDB on first access. Swap uses seed `date + ':swap:' + swapsUsed` for stable replay.

Direction is stored in `state.direction` (set during onboarding); `cards.js` reads it at draw time.

`todayString()` uses local calendar date (not UTC) so midnight rolls over at the player's device time.

### PWA / offline (M4)

- **`vite-plugin-pwa`** configured in `vite.config.js`:
  - `registerType: 'prompt'` — new SW waits in `waiting`; never auto-reloads mid-session
  - Workbox precaches all hashed build artefacts; `globPatterns` covers JS/CSS/HTML/PNG/SVG
  - Card JSONs (`/cards/*.json`) use **NetworkFirst** (5 s timeout) so re-deployed card pools reach users
  - `devOptions.enabled: true` — SW active in dev mode for testing
- **SW registration** in `src/main.js` via `virtual:pwa-register`:
  - `onNeedRefresh` → shows `#update-banner`; user clicks "更新" → `updateSW(true)` reloads
  - `onOfflineReady` → shows transient toast
- **Icons**: `public/icons/icon-192.png` + `icon-512.png` (generated by `node scripts/gen-icons.mjs` via Playwright canvas)
- **Apple-touch-icon** in `index.html`; manifest link injected by plugin

### Cross-day detection (M4)

Both paths handled in `src/main.js`; neither shows "you missed / streak broken" copy:

| Trigger | Mechanism |
|---|---|
| Cold start | `getTodayDaily()` key = local date; stale key → miss → redraw |
| Open through midnight | `visibilitychange` listener + 60 s `setInterval` → `checkDayChange()` |

### Supabase Auth + Sync (M5)

| File | Role |
|---|---|
| `src/supabase.js` | Supabase client (returns null if env vars absent); `ensureAuth()` — `getSession()` first, falls back to `signInAnonymously()` |
| `src/sync.js` | `syncOnBoot(kingdom, codex)` pull-first logic; `schedulePush()` 3-second debounced upsert; `isFresh()` guard prevents overwriting remote with empty local |
| `supabase/migrations/001_saves.sql` | `saves` table DDL + RLS + trigger |
| `.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — **gitignored, never commit** |
| `.env.example` | Variable names only, safe to commit |

**saves table schema:**
```sql
saves (user_id uuid PK, state jsonb, version bigint, updated_at timestamptz)
```
`saves.state` = `serializeState()` + `{ codex: storyEntries[], collection: collectionEntries[] }`.
`saves.version` = `state.syncVer` (monotonic counter, incremented on every local write).

**Sync flow on boot:** pull remote → if `isFresh(local)` or `remoteVer > localVer` → restore from remote; else if `localVer > remoteVer` → push local. Never let a fresh (empty) device overwrite richer remote data.

**Environment variables:** `VITE_` prefix makes them available to the client bundle. Only `anon` key is used — `service_role` must never appear in client code.

### 信心卡冊（v0.4-1）

**完成流程（onComplete pseudocode）：**
1. **故事 append**：`storyEntries.unshift({id, date, cardId, title, action, attribute})` → 寫 `codex` IDB store
2. **收藏 upsert**：`collectionEntries.find(cardId)` → 已有則 `count++`，無則 push 新條目 → 寫 `collection` IDB store
3. **growElement(attr)** — 王國留痕跡（邏輯完全不變）

**故事 store（`codex` IDB，append-only）：**
```js
{ id, date, cardId, title, action, attribute }
```
- `title` = 稱號（如「我可以」）；舊資料無 `title` 時 fallback 用 `text`，不報錯
- `action` = 挑戰動作（如「對著鏡子說一句「我可以」」）；舊資料 fallback 用 `text`
- 只增不減，同張卡完成N次就有N筆

**收藏 store（`collection` IDB，去重）：**
```js
{ cardId, count, firstDate, lastDate, title, attribute, text, rarity }
```
- 每種卡只一格，`count` 記總完成次數；無 `story` 欄
- 稀有度（`rarity`）**永不綁難度**，目前全部 `'common'`

**卡冊 UI（`#view-codex`）：**
- Sticky header：「已收藏 N 張」（N = 去重後的種類數）
- **收藏分頁**（`#codex-collection`）：兩欄網格，Tier 0 卡面（屬性色框 + 光暈 + 稱號）；點擊翻轉 → 卡背（挑戰動作 + 完成 ×N + 最近日期）
- **紀錄分頁**（`#codex-story`）：時間流清單，每筆 meta 格式「第X天 · YYYY-MM-DD」（第X天從 `state.firstDay` 計算）；不去重
- `switchCodexTab('collection'|'story')` 切換分頁
- 底部導覽標籤：「卡冊」（`#nav-codex` ID 不變）

### Card JSON schema (`public/cards/`)

```json
{ "id": "...", "attribute": "courage|vitality|curiosity|warmth|focus",
  "role": "safe|main|surprise",
  "title": "卡名（稱號）", "text": "挑戰動作",
  "rarity": "common", "tone": "gentle|absurd", "difficulty": 1 }
```
**無 `story` 欄** — 卡片不帶敘事。

Three pools: `safe.json` (5 cards, one per attribute), `main.json` (9 cards, direction-weighted), `surprise.json` (5 absurd cards, swappable once/day).

## Upcoming milestones

- **Phase 2** — 額外挑戰 / 星空 / UGC 安全管線 / 分享連結
