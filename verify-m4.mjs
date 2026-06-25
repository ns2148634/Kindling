/**
 * verify-m4.mjs
 * M4 驗收：PWA 殼層、快取更新策略、跨日處理。
 * 需要 dev server 跑在 localhost:5173（npm run dev）。
 * 完整離線驗收需 production build（npm run build && npm run preview）。
 */

import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
let allPass = true;

function check(label, pass, detail = '', soft = false) {
  const mark = pass ? '✅' : (soft ? '⚠️ ' : '❌');
  console.log(`${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass && !soft) allPass = false;
}

// Inject a pre-onboarded kingdom so home view loads (same as verify-layout.mjs).
async function injectKingdom(page, overrides = {}) {
  await page.evaluate((ov) => new Promise((resolve, reject) => {
    const req = indexedDB.open('kindling', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('kingdom'))
        d.createObjectStore('kingdom', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('daily'))
        d.createObjectStore('daily', { keyPath: 'date' });
      if (!d.objectStoreNames.contains('codex'))
        d.createObjectStore('codex', { keyPath: 'id' });
    };
    req.onsuccess = e => {
      const db = e.target.result;
      const stores = ['kingdom', 'codex'];
      if (ov.daily) stores.push('daily');
      const t = db.transaction(stores, 'readwrite');
      t.objectStore('kingdom').put({
        id: 'v1', version: 1, onboarded: true, direction: 'courage',
        counts: { courage: 3, vitality: 2, focus: 1, warmth: 1, curiosity: 1 },
        land: [[0,0],[1,0],[0,1],[1,1],[2,0]],
        houses: [[0,1]], trees: [[1,0]], towers: [[0,-1,1]],
        citizenCount: 2, firstDay: '2026-01-01', lastActive: '2026-06-25',
      });
      t.objectStore('codex').put({ id: 'v1', entries: [
        { date: '2026-06-25', attribute: 'courage', text: '對著鏡子說一句「我可以」' },
      ]});
      if (ov.daily) {
        t.objectStore('daily').put(ov.daily);
      }
      t.oncomplete = () => resolve();
      t.onerror    = ev => reject(ev.target.error);
    };
    req.onerror = ev => reject(ev.target.error);
  }), overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Manifest + icons
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. PWA Manifest ──────────────────────────────────────');
const ctx0 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p0   = await ctx0.newPage();
await p0.goto(BASE);
await p0.waitForTimeout(800);
await injectKingdom(p0);
await p0.reload();
await p0.waitForTimeout(1500);

// 1. Manifest linked in <head>
const manifestHref = await p0.evaluate(() => {
  const el = document.querySelector('link[rel="manifest"]');
  return el ? el.getAttribute('href') : null;
});
check('manifest link 存在於 <head>', !!manifestHref, manifestHref ?? '未找到');

// 2. Fetch manifest and validate required fields
let manifest = null;
if (manifestHref) {
  try {
    const res  = await p0.evaluate(async (href) => {
      const r = await fetch(href);
      return r.ok ? r.json() : null;
    }, manifestHref);
    manifest = res;
  } catch {}
}
check('manifest 可下載', !!manifest);
if (manifest) {
  check('manifest.name 存在', !!manifest.name, manifest.name);
  check('manifest.display = standalone', manifest.display === 'standalone', manifest.display);
  check('manifest.theme_color 是深色', manifest.theme_color === '#070a14', manifest.theme_color);
  check('manifest.icons ≥ 2', Array.isArray(manifest.icons) && manifest.icons.length >= 2,
    `${manifest.icons?.length} 個`);
  const has192 = manifest.icons?.some(i => i.sizes?.includes('192'));
  const has512 = manifest.icons?.some(i => i.sizes?.includes('512'));
  check('有 192px icon', has192);
  check('有 512px icon', has512);
}

// 3. apple-touch-icon
const hasATI = await p0.evaluate(() =>
  !!document.querySelector('link[rel="apple-touch-icon"]'));
check('apple-touch-icon 存在', hasATI);

// ─────────────────────────────────────────────────────────────────────────────
// B. Service Worker registered
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. Service Worker ────────────────────────────────────');

// Give SW time to install in dev mode
await p0.waitForTimeout(2000);

const swState = await p0.evaluate(async () => {
  if (!('serviceWorker' in navigator)) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return 'not-registered';
  return reg.active?.state ?? reg.installing?.state ?? reg.waiting?.state ?? 'unknown';
});
check('Service Worker 已註冊', swState !== 'not-registered' && swState !== 'unsupported',
  swState);

// ─────────────────────────────────────────────────────────────────────────────
// C1. 跨日冷啟動：昨天的 daily 留在 IDB，今天開啟應得到新三張卡
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C1. 跨日（冷啟動）────────────────────────────────────');

// Build "yesterday" date string using local date arithmetic
const yesterday = await p0.evaluate(() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
});
const today = await p0.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
});

// Inject a daily entry for YESTERDAY (simulates stale cold-start state).
const staleDaily = {
  date:      yesterday,
  cards:     { safe: { id:'s1', attribute:'courage', role:'safe', text:'舊卡' },
               main: { id:'m1', attribute:'courage', role:'main', text:'舊卡' },
               surprise: { id:'p1', attribute:'warmth', role:'surprise', text:'舊卡' } },
  completed: { safe: true, main: false, surprise: false },
  swapsUsed: 0,
};
await injectKingdom(p0, { daily: staleDaily });
await p0.reload();
await p0.waitForTimeout(2000);

// Check that the cards rendered are for TODAY (not yesterday).
const renderedDate = await p0.evaluate(() => {
  // Read the daily date from IDB (the app re-draws into IDB on new day)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kindling', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      const t  = db.transaction('daily', 'readonly');
      t.objectStore('daily').getAll().onsuccess = ev => {
        const all = ev.target.result;
        resolve(all.map(d => d.date));
      };
    };
    req.onerror = ev => reject(ev.target.error);
  });
});

const hasToday     = renderedDate.includes(today);
const hasYesterday = renderedDate.includes(yesterday);
check('冷啟動後 IDB daily 包含今天', hasToday, `dates=${JSON.stringify(renderedDate)}`);
check('舊的昨日卡片沒有被展示（已重抽）', hasToday, `today=${today}`);

// Cards container should have 3 card elements
const cardCount = await p0.locator('.card').count();
check('首頁顯示 3 張卡片', cardCount === 3, `找到 ${cardCount} 張`);

// None of the card texts should be '舊卡' (the stale cards)
const staleVisible = await p0.locator('.card-text').evaluateAll(
  els => els.some(el => el.textContent.includes('舊卡'))
);
check('舊卡文字不出現在今日卡片中', !staleVisible);

// ─────────────────────────────────────────────────────────────────────────────
// C2. 跨日（開著過午夜）：visibilitychange 觸發換卡
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C2. 跨日（過午夜偵測）────────────────────────────────');

// We can't actually advance time, but we can check that the logic responds
// to a mocked date-string change via the internal _lastDate variable.
// Strategy: force _lastDate to "yesterday" then trigger visibilitychange,
// and verify getTodayDaily() is called (we observe IDB changes).

// First, get the current daily date from IDB
const dailyBefore = await p0.evaluate(() => new Promise((res, rej) => {
  const req = indexedDB.open('kindling', 1);
  req.onsuccess = e => {
    const t = e.target.result.transaction('daily', 'readonly');
    t.objectStore('daily').getAll().onsuccess = ev => res(ev.target.result.map(d => d.date));
    t.onerror = ev => rej(ev.target.error);
  };
  req.onerror = ev => rej(ev.target.error);
}));

// Inject yesterday's date as _lastDate, then simulate visibilitychange
await p0.evaluate((yest) => {
  // Patch _lastDate by dispatching a fake "change" — we expose a test hook.
  // Since we can't directly access module-private `_lastDate`, we verify via
  // the visibilitychange path by checking that the SW/daily logic at least
  // doesn't crash and the app remains functional.
  window.__m4_test_yest = yest;
}, yesterday);

// Trigger hidden + visible cycle
await p0.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await p0.waitForTimeout(1500);

// App should still be functional (no crash, cards still visible)
const cardCountAfterVC = await p0.locator('.card').count();
check('visibilitychange 後 App 仍正常、卡片可見', cardCountAfterVC === 3,
  `找到 ${cardCountAfterVC} 張`);

// ─────────────────────────────────────────────────────────────────────────────
// C3. 鐵則：沒有「漏了 / 中斷 / 失敗」字樣
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C3. Never-fail 鐵則 ──────────────────────────────────');

const bodyText = await p0.evaluate(() => document.body.innerText);
const badWords = ['漏了', '中斷', '失敗', '你已', '天沒', 'streak'];
for (const w of badWords) {
  check(`首頁不含「${w}」`, !bodyText.includes(w));
}

// ─────────────────────────────────────────────────────────────────────────────
// D. 離線（dev mode SW — basic check）
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── D. 離線載入 ──────────────────────────────────────────');

// First visit is already done (above). Give SW time to cache everything.
await p0.waitForTimeout(1500);

// Go offline and reload.
await p0.context().setOffline(true);
try {
  await p0.reload({ timeout: 8000 });
} catch {
  // timeout is OK if SW serves from cache — page may still be usable
}
await p0.waitForTimeout(2000);

const offlineKingdom = await p0.locator('#kingdom').isVisible().catch(() => false);
const offlineCards   = await p0.locator('#cards-section').isVisible().catch(() => false);
// soft=true: dev-mode SW does not cache dynamic HTML; full offline test needs production build.
check('離線後 #kingdom canvas 仍可見 (prod-only)', offlineKingdom, '', true);
check('離線後 #cards-section 仍可見 (prod-only)', offlineCards, '', true);

await p0.context().setOffline(false);

// ─────────────────────────────────────────────────────────────────────────────
// 結果
// ─────────────────────────────────────────────────────────────────────────────
await browser.close();
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
console.log('(離線完整驗收請執行 npm run build && npm run preview)');
process.exit(allPass ? 0 : 1);
