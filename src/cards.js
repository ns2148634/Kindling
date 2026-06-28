import { idb } from './idb.js';

const SWAPS_PER_DAY = 1;

// Five attributes rotate by calendar day so a non-choosing player
// gets all five element types over any 5-day window.
const ATTR_ROTATION = ['courage', 'vitality', 'focus', 'warmth', 'curiosity'];

export function defaultAttrForDate(date) {
  const dayIndex = Math.floor(new Date(date + 'T00:00:00').getTime() / 86400000);
  return ATTR_ROTATION[((dayIndex % 5) + 5) % 5];
}

export function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// FNV-1a 32-bit hash
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// xorshift32 seeded RNG — returns [0, 1)
function seededRNG(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function pickRandom(arr, rng) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)];
}

function pickDifferent(arr, current, rng) {
  const pool = arr.filter(c => c.id !== current?.id);
  return pool.length > 0 ? pickRandom(pool, rng) : pickRandom(arr, rng);
}

let _pools = null;

export async function loadPools() {
  if (_pools) return _pools;
  const base = import.meta.env.BASE_URL;
  const [safe, main, surprise] = await Promise.all([
    fetch(base + 'cards/safe.json').then(r => r.json()),
    fetch(base + 'cards/main.json').then(r => r.json()),
    fetch(base + 'cards/surprise.json').then(r => r.json()),
  ]);
  _pools = { safe, main, surprise };
  return _pools;
}

function drawMainCard(date, attr, pools) {
  const rng  = seededRNG(hash32(date + ':main:' + attr));
  const pool = pools.main.filter(c => c.attribute === attr);
  return pickRandom(pool.length > 0 ? pool : pools.main, rng);
}

function drawDailyCards(date, pools) {
  const rng          = seededRNG(hash32(date));
  const safeCard     = pickRandom(pools.safe, rng);
  const surpriseCard = pickRandom(pools.surprise, rng);
  const defaultAttr  = defaultAttrForDate(date);
  const mainCard     = drawMainCard(date, defaultAttr, pools);
  return {
    date,
    cards:     { safe: safeCard, main: mainCard, surprise: surpriseCard },
    completed: { safe: false,    main: false,    surprise: false },
    mainAttr:  defaultAttr,
    swapsUsed: 0,
  };
}

/**
 * Player picks an attribute → draw main card from that attr's pool.
 * Stable seed (date + ':main:' + attr) means the same choice always gives
 * the same card; changing attr gives a deterministically different card.
 * Returns updated daily or null if main card is already completed.
 */
export async function selectMainAttr(daily, attr) {
  if (daily.completed.main) return null;
  const pools = await loadPools();
  daily.cards.main = drawMainCard(daily.date, attr, pools);
  daily.mainAttr   = attr;
  await idb.put('daily', daily);
  return daily;
}

export async function getTodayDaily() {
  const date = todayString();
  const saved = await idb.get('daily', date);
  if (saved) {
    // Migrate v0.4-2 dailies where cards.main was null (player never picked)
    if (!saved.cards.main) {
      const pools = await loadPools();
      const attr = saved.mainAttr ?? defaultAttrForDate(date);
      saved.cards.main = drawMainCard(date, attr, pools);
      saved.mainAttr   = attr;
      await idb.put('daily', saved);
    }
    return saved;
  }
  const pools = await loadPools();
  const daily = drawDailyCards(date, pools);
  await idb.put('daily', daily);
  return daily;
}

export async function swapSurprise(daily) {
  if (daily.completed.surprise || daily.swapsUsed >= SWAPS_PER_DAY) return null;
  const pools = await loadPools();
  const rng = seededRNG(hash32(daily.date + ':swap:' + daily.swapsUsed));
  daily.cards.surprise = pickDifferent(pools.surprise, daily.cards.surprise, rng);
  daily.swapsUsed++;
  await idb.put('daily', daily);
  return daily;
}
