import { CITIZEN_PALS, cx, cy } from './constants.js';

export const state = {
  land:         [[0,0],[1,0],[0,1],[-1,0],[0,-1]],
  houses:       [],
  trees:        [],
  towers:       [],        // [c, r, h]
  citizenCount: 0,
  citizens:     [],        // runtime only — not persisted
  pulses:       [],        // runtime only — not persisted
  counts: { courage: 0, vitality: 0, focus: 0, warmth: 0, curiosity: 0 },
  firstDay:   null,
  lastActive: null,
};

// ── Persistence ───────────────────────────────────────────────────────────────

export function initState(saved) {
  if (!saved) return; // keep defaults
  state.land         = saved.land    ?? state.land;
  state.houses       = saved.houses  ?? [];
  state.trees        = saved.trees   ?? [];
  state.towers       = saved.towers  ?? [];
  state.citizenCount = saved.citizenCount ?? 0;
  state.counts       = { ...state.counts, ...(saved.counts ?? {}) };
  state.firstDay     = saved.firstDay  ?? null;
  state.lastActive   = saved.lastActive ?? null;
  // Rebuild runtime citizens from saved count
  state.citizens = [];
  rebuildCitizens();
}

export function rebuildCitizens() {
  const landArr = state.land;
  if (landArr.length === 0) return;
  const needed = state.citizenCount - state.citizens.length;
  for (let i = 0; i < needed; i++) {
    const [c,  r ] = landArr[Math.floor(Math.random() * landArr.length)];
    const [tc, tr] = landArr[Math.floor(Math.random() * landArr.length)];
    const pal = CITIZEN_PALS[Math.floor(Math.random() * CITIZEN_PALS.length)];
    state.citizens.push({
      x:  cx(c)  + (Math.random()-0.5)*8,
      y:  cy(r)  + 7,
      tx: cx(tc) + (Math.random()-0.5)*8,
      ty: cy(tr) + 7,
      pal, frame: 0, ft: 0,
    });
  }
}

export function serializeState() {
  return {
    id: 'v1',
    version: 1,
    direction: 'courage',
    counts:       { ...state.counts },
    land:         state.land.map(t => [...t]),
    houses:       state.houses.map(t => [...t]),
    trees:        state.trees.map(t => [...t]),
    towers:       state.towers.map(t => [...t]),
    citizenCount: state.citizenCount,
    firstDay:     state.firstDay,
    lastActive:   state.lastActive,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function landSet() {
  return new Set(state.land.map(([c,r]) => `${c},${r}`));
}

function occupiedSet() {
  const s = new Set();
  state.houses.forEach(([c,r]) => s.add(`${c},${r}`));
  state.towers.forEach(([c,r]) => s.add(`${c},${r}`));
  state.trees.forEach(([c,r])  => s.add(`${c},${r}`));
  return s;
}

function rnd(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── growElement ───────────────────────────────────────────────────────────────
// Returns { x, y } on success or { blocked: reason } when land is insufficient.
// Increments state.counts[attr] only on success.

export function growElement(attr) {
  const landArr = state.land;
  if (landArr.length === 0) return { blocked: 'no-land' };

  const set = landSet();
  const occ = occupiedSet();

  if (attr === 'courage') {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    const candidates = [];
    for (const [c,r] of landArr) {
      for (const [dc,dr] of dirs) {
        const nc = c+dc, nr = r+dr;
        if (Math.abs(nc) <= 6 && nr >= -4 && nr <= 4 && !set.has(`${nc},${nr}`)) {
          candidates.push([nc,nr]);
        }
      }
    }
    if (candidates.length === 0) return { blocked: 'land-full' };
    const [nc,nr] = rnd(candidates);
    state.land.push([nc,nr]);
    state.counts.courage++;
    return { x: cx(nc), y: cy(nr) };
  }

  if (attr === 'warmth') {
    const free = landArr.filter(([c,r]) => !occ.has(`${c},${r}`));
    if (free.length === 0) return { blocked: 'need-land' };
    const [c,r] = rnd(free);
    state.houses.push([c,r]);
    state.counts.warmth++;
    return { x: cx(c), y: cy(r) };
  }

  if (attr === 'curiosity') {
    const free = landArr.filter(([c,r]) => !occ.has(`${c},${r}`));
    if (free.length === 0) return { blocked: 'need-land' };
    const [c,r] = rnd(free);
    state.trees.push([c,r]);
    state.counts.curiosity++;
    return { x: cx(c), y: cy(r) };
  }

  if (attr === 'focus') {
    const existing = state.towers.filter(t => t[2] < 6);
    if (existing.length > 0 && Math.random() < 0.5) {
      const t = rnd(existing);
      t[2]++;
      state.counts.focus++;
      return { x: cx(t[0]), y: cy(t[1]) };
    }
    const free = landArr.filter(([c,r]) => !occ.has(`${c},${r}`));
    if (free.length === 0) {
      if (existing.length > 0) {
        const t = rnd(existing);
        t[2]++;
        state.counts.focus++;
        return { x: cx(t[0]), y: cy(t[1]) };
      }
      return { blocked: 'need-land' };
    }
    const [c,r] = rnd(free);
    state.towers.push([c,r,1]);
    state.counts.focus++;
    return { x: cx(c), y: cy(r) };
  }

  if (attr === 'vitality') {
    if (state.citizenCount >= landArr.length) return { blocked: 'citizens-full' };
    const free = landArr.filter(([c,r]) => !occ.has(`${c},${r}`));
    if (free.length === 0) return { blocked: 'need-land' };
    const [c,r] = rnd(free);
    const pal = CITIZEN_PALS[Math.floor(Math.random() * CITIZEN_PALS.length)];
    const x = cx(c) + (Math.random()-0.5)*8;
    const y = cy(r) + 7;
    const tgt = rnd(landArr);
    state.citizens.push({
      x, y,
      tx: cx(tgt[0]) + (Math.random()-0.5)*8,
      ty: cy(tgt[1]) + 7,
      pal, frame: 0, ft: 0,
    });
    state.citizenCount++;
    state.counts.vitality++;
    return { x, y };
  }

  return { blocked: 'unknown' };
}
