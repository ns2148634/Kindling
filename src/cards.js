import { idb } from './idb.js';
import { state } from './state.js';

const SWAPS_PER_DAY = 1;

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

function drawDailyCards(date, pools) {
  const rng = seededRNG(hash32(date));
  const safeCard     = pickRandom(pools.safe, rng);
  const surpriseCard = pickRandom(pools.surprise, rng);
  return {
    date,
    cards:     { safe: safeCard, main: null, surprise: surpriseCard },
    completed: { safe: false,    main: false, surprise: false },
    mainAttr:  null,   // set when player picks an attribute
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
  const rng = seededRNG(hash32(daily.date + ':main:' + attr));
  const attrPool = pools.main.filter(c => c.attribute === attr);
  daily.cards.main = pickRandom(attrPool.length > 0 ? attrPool : pools.main, rng);
  daily.mainAttr = attr;
  await idb.put('daily', daily);
  return daily;
}

export async function getTodayDaily() {
  const date = todayString();
  const saved = await idb.get('daily', date);
  if (saved) return saved;

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
