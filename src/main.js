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

let daily              = null;
let storyEntries       = []; // append-only: every completion, including repeats
let collectionEntries  = []; // deduped: one entry per cardId, with count
let _savedKingdom      = null;
let _savedStory        = null;
let _savedCollection   = null;
let _nextStoryId       = 1;  // monotonic id for story events

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  requestAnimationFrame(loop); // Stars start immediately

  const [savedKingdom, savedStory, savedCollection] = await Promise.all([
    idb.get('kingdom',    'v1'),
    idb.get('codex',      'v1'),  // story store (name kept for backward-compat)
    idb.get('collection', 'v1'),
  ]);

  _savedKingdom    = savedKingdom;
  _savedStory      = savedStory;
  _savedCollection = savedCollection;
  initState(savedKingdom);

  if (!state.onboarded) {
    showView('onboarding');
    renderOnboarding();
  } else {
    await bootHome();
  }
}

async function bootHome() {
  storyEntries      = _savedStory?.entries      ?? [];
  collectionEntries = _savedCollection?.entries ?? [];
  _nextStoryId = storyEntries.reduce((mx, e) => Math.max(mx, e.id ?? 0), 0) + 1;

  const restored = await syncOnBoot(_savedKingdom, _savedStory, _savedCollection);
  if (restored) {
    const [freshStory, freshColl] = await Promise.all([
      idb.get('codex',      'v1'),
      idb.get('collection', 'v1'),
    ]);
    storyEntries      = freshStory?.entries ?? [];
    collectionEntries = freshColl?.entries  ?? [];
    _nextStoryId = storyEntries.reduce((mx, e) => Math.max(mx, e.id ?? 0), 0) + 1;
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
  schedulePush(s, storyEntries, collectionEntries);

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

// ── Render: codex (two-tab: 收藏 grid + 紀錄 timeline) ──────────────────────

function renderCodex() {
  document.getElementById('codex-count').textContent = collectionEntries.length;
  renderCollection();
  renderStory();
}

function renderCollection() {
  const grid  = document.getElementById('codex-grid');
  const empty = document.getElementById('codex-empty');
  grid.innerHTML = '';

  if (collectionEntries.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  // newest completion first
  const sorted = [...collectionEntries].sort((a, b) =>
    (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));

  for (const entry of sorted) {
    const color    = COL[entry.attribute] ?? '#cdd9ff';
    const attrName = ATTR_NAMES[entry.attribute] ?? entry.attribute ?? '';
    const title    = entry.title ?? entry.cardId ?? '—';

    const wrapper = document.createElement('div');
    wrapper.className = 'codex-card-wrapper';
    wrapper.style.setProperty('--attr-color', color);

    const card = document.createElement('div');
    card.className = 'codex-card';

    const face = document.createElement('div');
    face.className = 'codex-face';
    face.innerHTML = `
      <div class="codex-face-glow"><div class="codex-face-orb"></div></div>
      <div class="codex-face-attr">${attrName}</div>
      <div class="codex-face-title">${title}</div>
    `;

    const back = document.createElement('div');
    back.className = 'codex-back';
    back.innerHTML = `
      <div class="codex-back-text">${entry.text ?? ''}</div>
      <div class="codex-back-count">完成 ×${entry.count}</div>
      <div class="codex-back-date">${entry.lastDate ?? entry.firstDate ?? ''}</div>
    `;

    card.append(face, back);
    wrapper.appendChild(card);
    wrapper.addEventListener('click', () => card.classList.toggle('flipped'));
    grid.appendChild(wrapper);
  }
}

function renderStory() {
  const list  = document.getElementById('story-list');
  const empty = document.getElementById('story-empty');
  list.innerHTML = '';

  if (storyEntries.length === 0) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const firstDay = state.firstDay;

  for (const entry of storyEntries) {
    const title    = entry.title  ?? entry.text ?? '—';
    const action   = entry.action ?? entry.text ?? '—';
    const color    = COL[entry.attribute] ?? '#cdd9ff';
    const dayLabel = firstDay
      ? `第${Math.floor((new Date(entry.date) - new Date(firstDay)) / 86400000) + 1}天`
      : entry.date;

    const li = document.createElement('li');
    li.className = 'story-entry';
    li.innerHTML = `
      <div class="story-dot" style="background:${color};box-shadow:0 0 5px ${color}"></div>
      <div class="story-content">
        <div class="story-title">${title}</div>
        <div class="story-action">${action}</div>
        <div class="story-meta">${dayLabel} · ${entry.date}</div>
      </div>
    `;
    list.appendChild(li);
  }
}

window.switchCodexTab = function(tab) {
  const isCollection = tab === 'collection';
  document.getElementById('codex-collection').style.display = isCollection ? '' : 'none';
  document.getElementById('codex-story').style.display      = isCollection ? 'none' : '';
  document.getElementById('tab-collection').classList.toggle('active', isCollection);
  document.getElementById('tab-story').classList.toggle('active', !isCollection);
};

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

  // 1) Story: always append (every completion is a unique event, even for repeat cards)
  const storyEntry = {
    id:        _nextStoryId++,
    date:      daily.date,
    cardId:    card.id,
    title:     card.title ?? card.text,
    action:    card.text,
    attribute: card.attribute,
  };
  storyEntries.unshift(storyEntry);

  // 2) Collection: upsert by cardId (deduped — count++ on repeat)
  const existing = collectionEntries.find(c => c.cardId === card.id);
  if (existing) {
    existing.count++;
    existing.lastDate = daily.date;
  } else {
    collectionEntries.push({
      cardId:    card.id,
      count:     1,
      firstDate: daily.date,
      lastDate:  daily.date,
      title:     card.title ?? card.text,
      attribute: card.attribute,
      text:      card.text,
      rarity:    card.rarity ?? 'common',
    });
  }

  // 3) growElement (unchanged — leaves a kingdom trace)
  const result = growElement(card.attribute);
  if (!result.blocked) {
    state.pulses.push({ x: result.x, y: result.y, t: performance.now(), color: COL[card.attribute] });
  } else {
    state.counts[card.attribute]++;
    showToast(BLOCKED_MSG[result.blocked] ?? '元素已加入卡冊');
  }

  state.syncVer = (state.syncVer ?? 0) + 1;
  const s = serializeState();
  await Promise.all([
    idb.put('daily',      daily),
    idb.put('kingdom',    s),
    idb.put('codex',      { id: 'v1', entries: storyEntries }),
    idb.put('collection', { id: 'v1', entries: collectionEntries }),
  ]);
  schedulePush(s, storyEntries, collectionEntries);

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
