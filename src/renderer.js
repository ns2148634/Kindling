import {
  W, TS, H2, OX, OY, q,
  cx, cy, COL,
  LAND_TOP, LAND_HI, LAND_EDGE, LAND_SOIL,
  CITIZEN_SPEED,
} from './constants.js';
import { state } from './state.js';

// ─── Sprite helpers ───────────────────────────────────────────────────────────
function drawPixels(ctx, grid, bx, by, colorMap, glowSet) {
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      const ch = grid[row][col];
      if (ch === '.') continue;
      const color = colorMap[ch];
      if (!color) continue;
      const px = bx + col * q;
      const py = by + row * q;
      if (glowSet && glowSet.has(ch)) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.fillStyle = color;
        ctx.fillRect(px, py, q, q);
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(px, py, q, q);
      }
    }
  }
}

// ─── Sprites ──────────────────────────────────────────────────────────────────
const HOUSE_GRID = [
  "...rrrrr...",
  "..rrrrrrr..",
  ".rrrrrrrrr.",
  "rrrrrrrrrrr",
  ".bbbbbbbbb.",
  ".bbbwwbbbb.",
  ".bbbwwbbbb.",
  ".bbbbbbbbb.",
  ".bbbdddbbb.",
  ".bbbdddbbb.",
];
const HOUSE_COLORS = { r: '#c0392b', b: '#7f6a5a', w: COL.warmth, d: '#4a3828' };
const HOUSE_GLOW = new Set(['w']);

function drawHouse(ctx, c, r) {
  const bx = cx(c) - H2 - 1;
  const by = cy(r) - HOUSE_GRID.length * q + 4;
  drawPixels(ctx, HOUSE_GRID, bx, by, HOUSE_COLORS, HOUSE_GLOW);
}

const TREE_GRID = [
  "...ccc...",
  "..ccccc..",
  ".ccCCCcc.",
  ".ccCCCcc.",
  "ccCCCCCcc",
  "ccCCCCCcc",
  ".ccCCCcc.",
  "..ccccc..",
  "...ttt...",
  "...ttt...",
  "...ttt...",
];
const TREE_COLORS = { c: '#2d6e34', C: '#5ecf6b', t: '#6b4226' };
const TREE_GLOW = new Set(['C']);

function drawTree(ctx, c, r) {
  const bx = cx(c) - TREE_GRID[0].length * q / 2;
  const by = cy(r) - TREE_GRID.length * q + 4;
  drawPixels(ctx, TREE_GRID, bx, by, TREE_COLORS, TREE_GLOW);
}

function drawTower(ctx, c, r, h) {
  const tw = 7 * q;
  const th = h * 4 * q;
  const bx = cx(c) - tw / 2;
  const by = cy(r) + 4 - th;

  // tower body
  ctx.fillStyle = '#3b4670';
  ctx.fillRect(bx, by, tw, th);

  // glowing windows every 4q rows
  ctx.save();
  ctx.shadowColor = COL.focus;
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#8fb0ff';
  for (let wh = th - 3 * q; wh > 0; wh -= 4 * q) {
    ctx.fillRect(bx + 2 * q, by + wh, 3 * q, 2 * q);
  }
  ctx.restore();

  // battlements at top
  ctx.save();
  ctx.shadowColor = COL.focus;
  ctx.shadowBlur = 10;
  ctx.fillStyle = COL.focus;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(bx + (i * 2 + 0.5) * q, by - q, q, 2 * q);
  }
  ctx.restore();
}

const PBODY_GRID = [".kk.", ".kk.", "cccc", "cccc", "cccc"];
const PBODY_GLOW = new Set(['k']);
const LEG_STAND  = ["l..l", "l..l"];
const LEG_WALK   = [".ll.", ".ll."];

function drawCitizen(ctx, cit) {
  const colors = { k: '#ffe0a0', c: cit.pal, l: '#b0b8c8' };
  const bx = cit.x - 2 * q;
  const by = cit.y - (PBODY_GRID.length + 2) * q;
  drawPixels(ctx, PBODY_GRID, bx, by, colors, PBODY_GLOW);
  const legs = cit.frame === 0 ? LEG_STAND : LEG_WALK;
  drawPixels(ctx, legs, bx, by + PBODY_GRID.length * q, colors, null);
  // bob
  const bob = cit.moving ? Math.sin(cit.ft * 0.2) : 0;
  ctx.save();
  ctx.translate(0, bob);
  ctx.restore();
}

// ─── Land tile ────────────────────────────────────────────────────────────────
function isLand(c, r, set) { return set.has(`${c},${r}`); }

function drawLandTile(ctx, c, r, landSet) {
  const x = cx(c) - H2;
  const y = cy(r) - H2;

  // soil side if no tile directly below
  if (!isLand(c, r + 1, landSet)) {
    ctx.fillStyle = LAND_SOIL;
    ctx.fillRect(x, y + TS - 1, TS, 4);
  }

  // top face
  ctx.fillStyle = LAND_TOP;
  ctx.fillRect(x, y, TS, TS);

  // highlight strip
  ctx.fillStyle = LAND_HI;
  ctx.fillRect(x + 1, y + 1, TS - 2, 2);

  // border
  ctx.strokeStyle = LAND_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

// ─── Pulse ────────────────────────────────────────────────────────────────────
function drawPulse(ctx, p, now) {
  const age = now - p.t;
  const dur = 800;
  if (age > dur) return false;
  const progress = age / dur;
  const radius = Math.max(0, progress * 40);
  const alpha = (1 - progress) * 0.7;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return true;
}

// ─── Island glow ─────────────────────────────────────────────────────────────
function drawIslandGlow(ctx) {
  if (state.land.length === 0) return;
  let sx = 0, sy = 0;
  for (const [c,r] of state.land) { sx += cx(c); sy += cy(r); }
  const gx = sx / state.land.length;
  const gy = sy / state.land.length;
  const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 120);
  grad.addColorStop(0, 'rgba(72,180,120,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, W);
}

// ─── Update citizens ──────────────────────────────────────────────────────────
export function updateCitizens() {
  if (state.land.length === 0) return;
  for (const cit of state.citizens) {
    const dx = cit.tx - cit.x;
    const dy = cit.ty - cit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    cit.moving = dist > 1;
    if (cit.moving) {
      cit.x += (dx / dist) * CITIZEN_SPEED;
      cit.y += (dy / dist) * CITIZEN_SPEED;
      cit.ft++;
      if (Math.floor(cit.ft / 8) % 2 === 0) cit.frame = 0; else cit.frame = 1;
    } else {
      cit.frame = 0;
      // pick new random target
      const [c,r] = state.land[Math.floor(Math.random() * state.land.length)];
      cit.tx = cx(c) + (Math.random() - 0.5) * 8;
      cit.ty = cy(r) + 7;
    }
  }
}

// ─── Main draw ────────────────────────────────────────────────────────────────
export function draw(ctx, now) {
  // transparent — background canvas draws stars
  ctx.clearRect(0, 0, W, W);

  // island glow
  drawIslandGlow(ctx);

  // 3. land tiles — sorted by row then col
  const set = new Set(state.land.map(([c,r]) => `${c},${r}`));
  const sorted = [...state.land].sort((a,b) => a[1] - b[1] || a[0] - b[0]);
  for (const [c,r] of sorted) drawLandTile(ctx, c, r, set);

  // 4. static buildings sorted by bottom-y (painter's algorithm)
  const buildings = [];
  for (const [c,r]   of state.houses)  buildings.push({ by: cy(r)+4, draw: () => drawHouse(ctx,c,r) });
  for (const [c,r]   of state.trees)   buildings.push({ by: cy(r)+4, draw: () => drawTree(ctx,c,r) });
  for (const [c,r,h] of state.towers)  buildings.push({ by: cy(r)+4, draw: () => drawTower(ctx,c,r,h) });
  buildings.sort((a,b) => a.by - b.by);
  for (const b of buildings) b.draw();

  // Citizens always on top — no collision, walk through everything
  for (const cit of state.citizens) drawCitizen(ctx, cit);

  // 5. pulses
  state.pulses = state.pulses.filter(p => drawPulse(ctx, p, now));
}
