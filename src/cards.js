import { idb } from './idb.js';
import { state } from './state.js';

const SWAPS_PER_DAY = 1;
const MAIN_OFF_DIRECTION_RATE = 0.2;

export function todayString() {
  return new Date().toISOString().slice(0, 10);
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

  const safeCard = pickRandom(pools.safe, rng);

  const dir = state.direction || 'courage';
  const useOffDir = rng() < MAIN_OFF_DIRECTION_RATE;
  const mainPool = useOffDir
    ? pools.main
    : pools.main.filter(c => c.attribute === dir);
  const mainCard = pickRandom(mainPool.length > 0 ? mainPool : pools.main, rng);

  const surpriseCard = pickRandom(pools.surprise, rng);

  return {
    date,
    cards: { safe: safeCard, main: mainCard, surprise: surpriseCard },
    completed: { safe: false, main: false, surprise: false },
    swapsUsed: 0,
  };
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
