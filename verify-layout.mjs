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

// ── iPhone 14 (390×844) ───────────────────────────────────────────────────────
const iphone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
const page = await iphone.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'verify-layout-iphone.png' });

const VP_H = 844;
const VP_W = 390;

const kingdomBox = await page.locator('#kingdom-section').boundingBox();
const cardsBox   = await page.locator('#cards-section').boundingBox();
const canvasBox  = await page.locator('#kingdom').boundingBox();
const navBox     = await page.locator('#bottom-nav').boundingBox();

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

// 3. 底部導覽只有兩頁：首頁 + 圖鑑
const navBtns     = await page.locator('#bottom-nav .nav-btn').all();
const navLabels   = await Promise.all(navBtns.map(b => b.textContent()));
const hasTwoTabs  = navBtns.length === 2;
const hasHome     = navLabels.some(t => t.includes('首頁'));
const hasCodex    = navLabels.some(t => t.includes('圖鑑'));
const noKingdom   = !navLabels.some(t => t.includes('王國'));
check('底部導覽剛好兩頁', hasTwoTabs, `找到 ${navBtns.length} 頁`);
check('有「首頁」頁籤', hasHome);
check('有「圖鑑」頁籤', hasCodex);
check('沒有獨立的「王國」頁籤', noKingdom);

// 4. 首頁不可整頁捲動（scrollHeight ≈ clientHeight）
const homeScrollable = await page.evaluate(() => {
  const view = document.getElementById('view-home');
  return view.scrollHeight > view.clientHeight + 4;
});
check('首頁不可捲動', !homeScrollable);

// ── 圖鑑頁 ────────────────────────────────────────────────────────────────────
await page.click('#nav-codex');
await page.waitForTimeout(300);
await page.screenshot({ path: 'verify-layout-codex.png' });

// 5. 圖鑑頁頂部顯示已記下 N 件
const codexHeader = await page.locator('#codex-header').isVisible();
check('圖鑑頁：頂部總數標題可見', codexHeader);

// 6. 圖鑑頁本身可捲動（overflow-y: auto）
const codexScrollable = await page.evaluate(() => {
  const view = document.getElementById('view-codex');
  return getComputedStyle(view).overflowY === 'auto' ||
         getComputedStyle(view).overflowY === 'scroll';
});
check('圖鑑頁可在頁內捲動', codexScrollable);

// ── iPhone SE (375×667) ───────────────────────────────────────────────────────
console.log('\n── iPhone SE (375×667) ──────────────────────────────────');
const se = await browser.newContext({ viewport: { width: 375, height: 667 } });
const p2 = await se.newPage();
await p2.goto('http://localhost:5173');
await p2.waitForTimeout(1500);
await p2.screenshot({ path: 'verify-layout-se.png' });

const cardsBoxSE = await p2.locator('#cards-section').boundingBox();
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
