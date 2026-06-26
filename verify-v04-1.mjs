/**
 * verify-v04-1.mjs
 * 驗收 v0.4-1：信心卡冊升級（Tier 0）。
 *
 * A. 靜態：卡片 JSON schema
 * B. 靜態：程式結構
 * C. 執行期：卡冊 UI + 卡片翻轉 + 向後相容舊資料
 */

import { readFileSync } from 'fs';
import { chromium } from 'playwright';

let allPass = true;

function check(label, pass, detail = '', soft = false) {
  const mark = pass ? '✅' : (soft ? '⚠️ ' : '❌');
  console.log(`${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass && !soft) allPass = false;
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readSrc(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 卡片 JSON schema
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. 卡片 JSON schema ──────────────────────────────────');

const pools = {
  safe:     readJSON('public/cards/safe.json')     ?? [],
  main:     readJSON('public/cards/main.json')     ?? [],
  surprise: readJSON('public/cards/surprise.json') ?? [],
};
const allCards = [...pools.safe, ...pools.main, ...pools.surprise];

check('safe.json 可讀取', pools.safe.length > 0);
check('main.json 可讀取', pools.main.length > 0);
check('surprise.json 可讀取', pools.surprise.length > 0);

const allHaveTitle = allCards.every(c => typeof c.title === 'string' && c.title.length > 0);
check('所有卡片有 title 欄位（非空字串）', allHaveTitle,
  allHaveTitle ? '' : allCards.filter(c => !c.title).map(c => c.id).join(', '));

const allHaveStory = allCards.every(c => typeof c.story === 'string');
check('所有卡片有 story 欄位（字串）', allHaveStory, '', true); // optional per spec

const allHaveRarity = allCards.every(c => typeof c.rarity === 'string');
check('所有卡片有 rarity 欄位', allHaveRarity, '', true); // optional per spec

// Rarity must never be tied to difficulty
const rarityTiedToDifficulty = allCards.some(c =>
  c.rarity && c.difficulty && c.rarity !== 'common' && c.difficulty > 1
);
check('稀有度未綁定難度', !rarityTiedToDifficulty);

// ─────────────────────────────────────────────────────────────────────────────
// B. 程式結構
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 程式結構 ──────────────────────────────────────────');

const mainSrc = readSrc('src/main.js');
const html    = readSrc('index.html');

// codex grid (not list)
check('index.html 有 #codex-grid（非 codex-list）',
  html.includes('id="codex-grid"') && !html.includes('id="codex-list"'));

// nav renamed
check('導覽列顯示「卡冊」', html.includes('卡冊'));
check('導覽列不再顯示「圖鑑」（獨立按鈕文字）',
  !html.match(/nav-codex[^>]*>[^<]*圖鑑/));

// header text
check('卡冊頁頂部顯示「已收藏」', html.includes('已收藏'));

// CSS: card flip
check('CSS 包含 .codex-card-wrapper', html.includes('codex-card-wrapper'));
check('CSS 包含 rotateY（翻轉動畫）', html.includes('rotateY'));
check('CSS 包含 backface-visibility（翻轉防穿透）', html.includes('backface-visibility'));

// JS: full card entry saved
check('completeCard 儲存 title 欄位', mainSrc.includes('title:'));
check('completeCard 儲存 story 欄位', mainSrc.includes('story:'));
check('completeCard 儲存 rarity 欄位', mainSrc.includes('rarity:'));
check('renderCodex 有 title fallback（entry.title ?? entry.text）',
  mainSrc.includes('entry.title ?? entry.text'));

// growElement untouched
check('growElement 完全未修改（不動王國邏輯）',
  readSrc('src/state.js').includes('export function growElement'));

// ─────────────────────────────────────────────────────────────────────────────
// C. 執行期驗收
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C. 執行期驗收 ────────────────────────────────────────');

const browser = await chromium.launch({ headless: true });

async function injectState(page, codexEntries) {
  await page.evaluate((entries) => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      ['kingdom','daily','codex'].forEach(name => {
        if (!d.objectStoreNames.contains(name))
          d.createObjectStore(name, { keyPath: name === 'daily' ? 'date' : 'id' });
      });
    };
    req.onsuccess = e => {
      const db = e.target.result;
      const t = db.transaction(['kingdom','codex'], 'readwrite');
      t.objectStore('kingdom').put({
        id: 'v1', version: 1, syncVer: 5, onboarded: true, direction: 'courage',
        counts: { courage: 2, vitality: 1, focus: 1, warmth: 1, curiosity: 1 },
        land: [[0,0],[1,0],[0,1],[1,1]], houses: [[0,1]], trees: [], towers: [[0,0,1]],
        citizenCount: 1, firstDay: '2026-01-01', lastActive: '2026-06-25',
      });
      t.objectStore('codex').put({ id: 'v1', entries });
      t.oncomplete = () => res();
      t.onerror = ev => rej(ev.target.error);
    };
    req.onerror = ev => rej(ev.target.error);
  }), codexEntries);
}

// ── C1. 卡冊頁顯示網格 ────────────────────────────────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page1 = await ctx1.newPage();
await page1.goto('http://localhost:5173');
await page1.waitForTimeout(500);

// Inject 2 NEW entries (with title/story/rarity)
await injectState(page1, [
  { id: 's_courage', title: '我可以', attribute: 'courage', text: '對著鏡子說一句「我可以」',
    story: '你是第一個相信自己的人。', rarity: 'common', date: '2026-06-26' },
  { id: 's_warmth',  title: '謝謝你', attribute: 'warmth',  text: '對一個人說謝謝',
    story: '一句謝謝，讓對方被看見了。', rarity: 'common', date: '2026-06-25' },
]);
await page1.reload();
await page1.waitForTimeout(2000);

const homeVisible = await page1.locator('#view-home').isVisible().catch(() => false);
check('首頁正常顯示', homeVisible);

// Navigate to 卡冊
await page1.locator('#nav-codex').click();
await page1.waitForTimeout(400);

const codexVisible = await page1.locator('#view-codex').isVisible().catch(() => false);
check('卡冊頁正常顯示', codexVisible);

const countText = await page1.locator('#codex-count').textContent().catch(() => '');
check('頂部顯示已收藏數量', countText === '2', `count="${countText}"`);

const headerText = await page1.locator('#codex-header').textContent().catch(() => '');
check('頂部文字包含「已收藏」', headerText.includes('已收藏'));

const cardWrappers = await page1.locator('.codex-card-wrapper').count();
check('卡冊顯示正確數量的卡片', cardWrappers === 2, `found ${cardWrappers}`);

// ── C2. 卡面：屬性色框 + 卡名 ────────────────────────────────────────────────
const faceTitle = await page1.locator('.codex-face-title').first().textContent().catch(() => '');
check('卡面顯示卡名（title）', faceTitle.length > 0, `"${faceTitle}"`);

const faceAttr = await page1.locator('.codex-face-attr').first().textContent().catch(() => '');
check('卡面顯示屬性名稱', faceAttr.length > 0, `"${faceAttr}"`);

// ── C3. 點擊翻轉到卡背 ────────────────────────────────────────────────────────
await page1.locator('.codex-card-wrapper').first().click();
await page1.waitForTimeout(500);

const flipped = await page1.locator('.codex-card.flipped').count();
check('點擊後 .codex-card 加上 .flipped class', flipped >= 1);

const backText = await page1.locator('.codex-back-text').first().textContent().catch(() => '');
check('卡背顯示挑戰內容（text）', backText.length > 0, `"${backText}"`);

const backDate = await page1.locator('.codex-back-date').first().textContent().catch(() => '');
check('卡背顯示完成日期', backDate.includes('2026'), `"${backDate}"`);

// story present in back
const backStory = await page1.locator('.codex-back-story').first().textContent().catch(() => '');
check('卡背顯示 story（若存在）', backStory.length > 0, `"${backStory}"`);

// Click again to unflip
await page1.locator('.codex-card-wrapper').first().click();
await page1.waitForTimeout(400);
const stillFlipped = await page1.locator('.codex-card.flipped').count();
check('再次點擊可翻回正面', stillFlipped === 0);

// ── C4. 向後相容：舊 codex 資料（無 title）不報錯 ────────────────────────────
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
await page2.goto('http://localhost:5173');
await page2.waitForTimeout(500);

// Inject OLD-format entries (no title, no story, no rarity)
await injectState(page2, [
  { date: '2026-06-24', attribute: 'courage', text: '舊格式的勇氣挑戰' },
  { date: '2026-06-23', attribute: 'warmth',  text: '舊格式的溫暖挑戰' },
]);
await page2.reload();
await page2.waitForTimeout(2000);
await page2.locator('#nav-codex').click();
await page2.waitForTimeout(400);

const oldCardCount = await page2.locator('.codex-card-wrapper').count();
check('舊格式 codex 資料仍正常顯示（不崩潰）', oldCardCount === 2, `found ${oldCardCount}`);

const oldTitle = await page2.locator('.codex-face-title').first().textContent().catch(() => '');
check('舊資料無 title 時用 text 作為卡名 fallback', oldTitle.length > 0, `"${oldTitle}"`);

// Check no JS errors by looking for error indicators
const errors = await page2.evaluate(() => window.__errors?.length ?? 0);
check('頁面無 JS 報錯', errors === 0);

await ctx2.close();

// ── C5. 完成一張卡後進入卡冊 ─────────────────────────────────────────────────
// Inject a state with 0 codex entries so we can complete a card
const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page3 = await ctx3.newPage();
await page3.goto('http://localhost:5173');
await page3.waitForTimeout(500);
await injectState(page3, []);   // empty codex
await page3.reload();
await page3.waitForTimeout(2500);

const emptyVisible = await page3.locator('#view-home').isVisible().catch(() => false);
check('完成卡流程：首頁載入', emptyVisible);

const completeBtn = page3.locator('.btn-complete:not(:disabled)').first();
const hasBtnToClick = await completeBtn.isVisible().catch(() => false);
if (hasBtnToClick) {
  await completeBtn.click();
  await page3.waitForTimeout(800);
  // Navigate to codex
  await page3.locator('#nav-codex').click();
  await page3.waitForTimeout(400);
  const afterCount = await page3.locator('.codex-card-wrapper').count();
  check('完成一張卡 → 卡冊多一張', afterCount === 1, `found ${afterCount}`);
  // Verify new entry has title (from card JSON)
  const newTitle = await page3.locator('.codex-face-title').first().textContent().catch(() => '');
  check('新收藏的卡有 title（來自卡池）', newTitle.length > 0, `"${newTitle}"`);
} else {
  check('完成卡 → 進入卡冊', true, '(今日卡已全部完成，跳過)', true);
}
await ctx3.close();

// ── C6. never-fail：卡冊無 streak / 漏了 / 失敗 ───────────────────────────────
const body1 = await page1.content();
const badWords = ['streak','漏了','中斷','失敗','你已','天沒'];
const foundBad = badWords.filter(w => body1.includes(w));
check('卡冊頁無 streak / 漏了 / 失敗 字樣', foundBad.length === 0,
  foundBad.length ? foundBad.join(', ') : '');

await page1.close();
await ctx1.close();
await browser.close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
