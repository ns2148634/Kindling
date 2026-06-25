/**
 * verify-layout.mjs
 * 驗收「排版任務卡 — 首頁同框 + 圖鑑分頁」的 6 條驗收條件。
 * 需要 dev server 跑在 localhost:5173。
 */

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
let allPass = true;

function check(label, pass, detail = '') {
  const mark = pass ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass) allPass = false;
}

// Inject a pre-onboarded kingdom + codex state so the home view loads instead of onboarding.
async function injectState(page) {
  await page.evaluate(() => new Promise((resolve, reject) => {
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
      const t = db.transaction(['kingdom', 'codex'], 'readwrite');
      t.objectStore('kingdom').put({
        id: 'v1', version: 1, onboarded: true, direction: 'courage',
        counts: { courage: 3, vitality: 2, focus: 1, warmth: 1, curiosity: 1 },
        land: [[0,0],[1,0],[0,1],[1,1],[2,0]],
        houses: [[0,1]], trees: [[1,0]], towers: [[0,-1,1]],
        citizenCount: 2, firstDay: '2026-01-01', lastActive: '2026-06-25',
      });
      t.objectStore('codex').put({
        id: 'v1',
        entries: [
          { date: '2026-06-25', attribute: 'courage', text: '對著鏡子說一句「我可以」' },
          { date: '2026-06-24', attribute: 'warmth',  text: '對一個人說謝謝' },
        ],
      });
      t.oncomplete = () => resolve();
      t.onerror    = ev => reject(ev.target.error);
    };
    req.onerror = ev => reject(ev.target.error);
  }));
}

// ── iPhone 14 (390×844) ───────────────────────────────────────────────────────
const iphone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const page = await iphone.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(600);
await injectState(page);
await page.reload();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'verify-layout-iphone.png' });

const VP_H = 844;

const kingdomBox = await page.locator('#kingdom-section').boundingBox();
const cardsBox   = await page.locator('#cards-section').boundingBox();
const canvasBox  = await page.locator('#kingdom').boundingBox();

console.log('\n── iPhone 14 (390×844) ──────────────────────────────────');

// 1. 王國在上、三張卡在下，同框不捲動
check(
  '王國在卡片上方',
  kingdomBox && cardsBox && kingdomBox.y < cardsBox.y,
  `kingdom.y=${kingdomBox?.y?.toFixed(0)} cards.y=${cardsBox?.y?.toFixed(0)}`
);
const cardsBottom = cardsBox ? cardsBox.y + cardsBox.height : 0;
check(
  '三張卡完全在 viewport 內（不需捲動）',
  cardsBottom <= VP_H,
  `cards bottom=${cardsBottom.toFixed(0)} vp=${VP_H}`
);

// 2. Canvas 正方形（等比放到最大）
const squareDiff = canvasBox ? Math.abs(canvasBox.width - canvasBox.height) : 999;
check(
  'Canvas 是正方形',
  squareDiff < 2,
  `${canvasBox?.width?.toFixed(0)}×${canvasBox?.height?.toFixed(0)}`
);

// 3. 底部導覽只有兩頁：首頁 + 圖鑑，沒有獨立王國頁
const navBtns   = await page.locator('#bottom-nav .nav-btn').all();
const navLabels = await Promise.all(navBtns.map(b => b.textContent()));
check('底部導覽剛好兩頁', navBtns.length === 2, `找到 ${navBtns.length} 頁`);
check('有「首頁」頁籤', navLabels.some(t => t.includes('首頁')));
check('有「圖鑑」頁籤', navLabels.some(t => t.includes('圖鑑')));
check('沒有獨立的「王國」頁籤', !navLabels.some(t => t.includes('王國') && !t.includes('首頁')));

// 4. 首頁不可整頁捲動
const homeScrollable = await page.evaluate(() => {
  const view = document.getElementById('view-home');
  return view.scrollHeight > view.clientHeight + 4;
});
check('首頁不可捲動', !homeScrollable);

// ── 切到圖鑑頁 ────────────────────────────────────────────────────────────────
await page.click('#nav-codex');
await page.waitForTimeout(300);
await page.screenshot({ path: 'verify-layout-codex.png' });

// 5. 圖鑑頁頂部標題可見
const codexHeader = await page.locator('#codex-header').isVisible();
check('圖鑑頁：頂部總數標題可見', codexHeader);

// 6. 圖鑑頁本身可捲動（overflow-y: auto / scroll）
const codexScrollable = await page.evaluate(() => {
  const view = document.getElementById('view-codex');
  const ov = getComputedStyle(view).overflowY;
  return ov === 'auto' || ov === 'scroll';
});
check('圖鑑頁可在頁內捲動', codexScrollable);

// ── iPhone SE (375×667) ───────────────────────────────────────────────────────
console.log('\n── iPhone SE (375×667) ──────────────────────────────────');
const se = await browser.newContext({ viewport: { width: 375, height: 667 } });
const p2 = await se.newPage();
await p2.goto('http://localhost:5173');
await p2.waitForTimeout(600);
await injectState(p2);
await p2.reload();
await p2.waitForTimeout(1500);
await p2.screenshot({ path: 'verify-layout-se.png' });

const cardsBoxSE    = await p2.locator('#cards-section').boundingBox();
const cardsBottomSE = cardsBoxSE ? cardsBoxSE.y + cardsBoxSE.height : 0;
check(
  'SE：三張卡完全在 viewport 內',
  cardsBottomSE <= 667,
  `cards bottom=${cardsBottomSE.toFixed(0)} vp=667`
);
const homeScrollableSE = await p2.evaluate(() => {
  const view = document.getElementById('view-home');
  return view.scrollHeight > view.clientHeight + 4;
});
check('SE：首頁不可捲動', !homeScrollableSE);

// ── 結果 ──────────────────────────────────────────────────────────────────────
await browser.close();
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
