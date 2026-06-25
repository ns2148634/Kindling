import { state, initState, serializeState } from './state.js';
import { growElement } from './state.js';
import { draw, updateCitizens } from './renderer.js';
import { COL, cx, cy } from './constants.js';
import { idb } from './idb.js';
import { getTodayDaily, swapSurprise as doSwap, loadPools, todayString } from './cards.js';
import { registerSW } from 'virtual:pwa-register';
import { syncOnBoot, schedulePush } from './sync.js';

const canvas     = document.getElementById('kingdom');
const ctx        = canvas.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');

// Keep kingdom canvas square — min(wrap-width, wrap-height)
new ResizeObserver(([{ contentRect: r }]) => {
  const s = Math.floor(Math.min(r.width, r.height));
  canvas.style.width  = s + 'px';
  canvas.style.height = s + 'px';
}).observe(canvasWrap);

// ── Full-screen starry background ─────────────────────────────────────────────
const bgCanvas = document.getElementById('bg-canvas');
const bgCtx    = bgCanvas.getContext('2d');
let bgStars    = [];

function setupBg() {
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
  bgStars = Array.from({ length: 180 }, () => ({
    x:     Math.random() * window.innerWidth,
    y:     Math.random() * window.innerHeight,
    r:     Math.random() * 1.4 + 0.3,
    phase: Math.random() * Math.PI * 2,
    speed: Math.random() * 0.8 + 0.4,
  }));
}

function drawBg(now) {
  bgCtx.fillStyle = '#070a14';
  bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
  for (const s of bgStars) {
    const alpha = 0.5 + 0.5 * Math.sin(now * 0.001 * s.speed + s.phase);
    bgCtx.globalAlpha = alpha * 0.9;
    bgCtx.fillStyle = '#cdd9ff';
    bgCtx.beginPath();
    bgCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    bgCtx.fill();
  }
  bgCtx.globalAlpha = 1;
}

setupBg();
window.addEventListener('resize', setupBg);

// ── Constants ─────────────────────────────────────────────────────────────────

const ATTR_NAMES = { courage:'勇氣', vitality:'活力', focus:'專注', warmth:'溫暖', curiosity:'好奇' };
const ROLE_NAMES = { safe:'安全', main:'主線', surprise:'驚喜' };
const BLOCKED_MSG = {
  'land-full':    '土地已到邊界——先換個方向',
  'need-land':    '沒有空格——先用勇氣卡加土地',
  'citizens-full':'居民已滿——先擴張土地',
  'no-land':      '王國還沒有土地',
};

const DIRECTIONS = [
  { id: 'vitality',  label: '動起來',     color: COL.vitality  },
  { id: 'focus',     label: '讀點書',     color: COL.focus     },
  { id: 'courage',   label: '勇敢一點',   color: COL.courage   },
  { id: 'warmth',    label: '對人好一點', color: COL.warmth    },
  { id: 'curiosity', label: '多看看世界', color: COL.curiosity },
];

let daily         = null;
let codexEntries  = [];
let _savedCodex   = null;
let _savedKingdom = null;

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  requestAnimationFrame(loop); // Stars start immediately

  const [savedKingdom, savedCodex] = await Promise.all([
    idb.get('kingdom', 'v1'),
    idb.get('codex',   'v1'),
  ]);

  _savedKingdom = savedKingdom;
  _savedCodex   = savedCodex;
  initState(savedKingdom);

  if (!state.onboarded) {
    showView('onboarding');
    renderOnboarding();
  } else {
    await bootHome();
  }
}

async function bootHome() {
  codexEntries = _savedCodex?.entries ?? [];

  // Cloud sync: pull-first, may restore state from remote (silent, no UI change).
  // Run before rendering so the user sees their restored kingdom immediately.
  const restored = await syncOnBoot(_savedKingdom, _savedCodex);
  if (restored) {
    // Remote state was loaded into `state` by syncOnBoot → re-read codex from IDB.
    const freshCodex = await idb.get('codex', 'v1');
    codexEntries = freshCodex?.entries ?? [];
  }

  await loadPools();
  daily = await getTodayDaily();
  renderCards();
  renderCodex();
  renderStats();
  showView('home');
}

// ── Onboarding ────────────────────────────────────────────────────────────────

function renderOnboarding() {
  document.getElementById('btn-ob-continue').onclick = () => {
    document.getElementById('ob-step1').style.display = 'none';
    const step2 = document.getElementById('ob-step2');
    step2.style.display    = 'flex';
    step2.style.flexDirection = 'column';
  };

  const container = document.getElementById('ob-directions');
  for (const dir of DIRECTIONS) {
    const btn = document.createElement('button');
    btn.className = 'btn-direction';
    btn.style.setProperty('--dir-color', dir.color);
    btn.innerHTML = `<span style="color:${dir.color};font-weight:600">${dir.label}</span>`;
    btn.onclick = () => chooseDirection(dir.id);
    container.appendChild(btn);
  }
}

async function chooseDirection(attr) {
  state.direction  = attr;
  state.onboarded  = true;
  if (state.land.length === 0) state.land.push([0, 0]);
  state.firstDay   = todayString();
  state.lastActive = todayString();
  state.syncVer    = (state.syncVer ?? 0) + 1;

  const s = serializeState();
  await idb.put('kingdom', s);
  schedulePush(s, codexEntries);

  // First tile pulse
  state.pulses.push({ x: cx(0), y: cy(0), t: performance.now(), color: COL[attr] });

  await bootHome();
}

// ── Render: cards ─────────────────────────────────────────────────────────────

function renderCards() {
  if (!daily) return;
  const container = document.getElementById('cards-container');
  container.innerHTML = '';
  for (const slot of ['safe', 'main', 'surprise']) {
    container.appendChild(buildCard(slot));
  }
}

function buildCard(slot) {
  const card = daily.cards[slot];
  const done = daily.completed[slot];
  const color = COL[card.attribute];

  const div = document.createElement('div');
  div.className = 'card' + (done ? ' completed' : '');
  div.style.setProperty('--attr-color', color);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.innerHTML = `
    <span class="card-role">${ROLE_NAMES[slot]}</span>
    <span class="card-dot"></span>
    <span class="card-attr">${ATTR_NAMES[card.attribute]}</span>
  `;

  const textEl = document.createElement('div');
  textEl.className = 'card-text';
  textEl.textContent = card.text;

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const completeBtn = document.createElement('button');
  completeBtn.className = 'btn-complete';
  completeBtn.textContent = done ? '已完成 ✓' : '完成';
  completeBtn.disabled = done;
  completeBtn.onclick = () => completeCard(slot);
  actions.appendChild(completeBtn);

  if (slot === 'surprise') {
    const swapBtn = document.createElement('button');
    swapBtn.className = 'btn-swap';
    const canSwap = !done && daily.swapsUsed < 1;
    swapBtn.textContent = `換一張${daily.swapsUsed > 0 ? ' (已換)' : ''}`;
    swapBtn.disabled = !canSwap;
    swapBtn.onclick = handleSwap;
    actions.appendChild(swapBtn);
  }

  div.append(meta, textEl, actions);
  return div;
}

// ── Render: codex ─────────────────────────────────────────────────────────────

function renderCodex() {
  document.getElementById('codex-count').textContent = codexEntries.length;
  const list  = document.getElementById('codex-list');
  const empty = document.getElementById('codex-empty');
  list.innerHTML = '';

  if (codexEntries.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  for (const entry of codexEntries) {
    const li = document.createElement('li');
    li.className = 'codex-entry';
    li.innerHTML = `
      <div class="codex-dot" style="--dot-color:${COL[entry.attribute]}"></div>
      <div class="codex-content">
        <div class="codex-text">${entry.text}</div>
        <div class="codex-date">${entry.date} · ${ATTR_NAMES[entry.attribute]}</div>
      </div>
    `;
    list.appendChild(li);
  }
}

function renderStats() {
  const { courage, vitality, focus, warmth, curiosity } = state.counts;
  document.getElementById('stats').textContent =
    `土地 ${state.land.length} · 勇 ${courage} 活 ${vitality} 專 ${focus} 溫 ${warmth} 奇 ${curiosity}`;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function completeCard(slot) {
  if (!daily || daily.completed[slot]) return;

  const card = daily.cards[slot];
  daily.completed[slot] = true;
  state.lastActive = daily.date;

  const result = growElement(card.attribute);
  if (!result.blocked) {
    state.pulses.push({ x: result.x, y: result.y, t: performance.now(), color: COL[card.attribute] });
  } else {
    state.counts[card.attribute]++;
    showToast(BLOCKED_MSG[result.blocked] ?? '元素已加入圖鑑');
  }

  codexEntries.unshift({ date: daily.date, attribute: card.attribute, text: card.text });
  state.syncVer = (state.syncVer ?? 0) + 1;

  const s = serializeState();
  await Promise.all([
    idb.put('daily',   daily),
    idb.put('kingdom', s),
    idb.put('codex',   { id: 'v1', entries: codexEntries }),
  ]);
  schedulePush(s, codexEntries);

  renderCards();
  renderCodex();
  renderStats();
}

async function handleSwap() {
  if (!daily) return;
  const updated = await doSwap(daily);
  if (updated) {
    daily = updated;
    renderCards();
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Navigation ────────────────────────────────────────────────────────────────

window.showView = function(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.getElementById('nav-'  + view)?.classList.add('active');
  // Hide nav bar during onboarding
  document.getElementById('bottom-nav').style.display = view === 'onboarding' ? 'none' : '';
};

// ── rAF loop ──────────────────────────────────────────────────────────────────

function loop(now) {
  drawBg(now);
  updateCitizens();
  draw(ctx, now);
  requestAnimationFrame(loop);
}

init().catch(console.error);

// ── Service-worker registration ───────────────────────────────────────────────
// registerType:'prompt' — new SW waits in `waiting`.
// We surface a banner; user decides when to reload. Never forced mid-session.
const updateSW = registerSW({
  onNeedRefresh() { showUpdateBanner(); },
  onOfflineReady() { showToast('可離線使用 ✓'); },
});

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  banner.style.display = 'flex';
  document.getElementById('btn-update-apply').onclick = () => updateSW(true);
}

// ── Cross-day detection ───────────────────────────────────────────────────────
// Refreshes cards when the local calendar date changes, without losing kingdom
// or codex data. No "you missed yesterday" messaging — just a clean new day.
let _lastDate = todayString();

async function checkDayChange() {
  const today = todayString();
  if (today === _lastDate) return;
  _lastDate = today;
  if (!daily) return;                  // not on home view yet
  daily = await getTodayDaily();
  renderCards();
}

// When user returns from background (phone lock, tab switch, etc.)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkDayChange();
});

// Low-frequency safety net for apps left open through midnight
setInterval(checkDayChange, 60_000);
