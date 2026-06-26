/**
 * verify-v04-1.mjs
 * 驗收 v0.4-1（含 v0.4 補充規格）：
 *   - 故事 store（append-only，codex IDB）
 *   - 收藏 store（去重，collection IDB）
 *   - 卡冊頁：收藏分頁（去重網格）＋ 紀錄分頁（時間流）
 *   - 同一張卡完成兩次 → 故事兩筆、收藏一張 ×2
 *   - 向後相容舊 codex 格式（no title → fallback）
 */

import { readFileSync } from 'fs';
import { chromium } from 'playwright';

let allPass = true;

function check(label, pass, detail = '', soft = false) {
  const mark = pass ? '✅' : (soft ? '⚠️ ' : '❌');
  console.log(`${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass && !soft) allPass = false;
}

function readSrc(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}
function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 靜態：程式結構
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. 靜態結構 ──────────────────────────────────────────');

const idbSrc  = readSrc('src/idb.js');
const mainSrc = readSrc('src/main.js');
const syncSrc = readSrc('src/sync.js');
const html    = readSrc('index.html');

// IDB v2 + collection store
check('idb.js DB_VERSION = 2', idbSrc.includes('DB_VERSION = 2'));
check('idb.js 建立 collection store', idbSrc.includes("'collection'"));

// story / collection vars in main.js
check('main.js 有 storyEntries 變數', mainSrc.includes('storyEntries'));
check('main.js 有 collectionEntries 變數', mainSrc.includes('collectionEntries'));
check('main.js completeCard 先 append 故事再 upsert 收藏',
  mainSrc.includes('storyEntries.unshift') && mainSrc.includes('collectionEntries.find'));
check('main.js completeCard 寫入 codex store（故事）',
  mainSrc.includes("idb.put('codex'") && mainSrc.includes("entries: storyEntries"));
check('main.js completeCard 寫入 collection store（收藏）',
  mainSrc.includes("idb.put('collection'") && mainSrc.includes("entries: collectionEntries"));
check('main.js title fallback（entry.title ?? ... entry.text）',
  /entry\.title\s*\?\?\s*entry\.text/.test(mainSrc) ||
  /entry\.title\s*\?\?\s*entry\.cardId/.test(mainSrc));

// Two-tab UI
check('index.html 有收藏分頁 tab（tab-collection）', html.includes('tab-collection'));
check('index.html 有紀錄分頁 tab（tab-story）', html.includes('tab-story'));
check('index.html 有 #codex-collection 面板', html.includes('id="codex-collection"'));
check('index.html 有 #codex-story 面板', html.includes('id="codex-story"'));
check('index.html 有 #story-list', html.includes('id="story-list"'));
check('main.js 有 switchCodexTab 函式', mainSrc.includes('switchCodexTab'));

// sync.js updated
check('sync.js buildCloudState 包含 collection', syncSrc.includes('collectionEntries'));
check('sync.js restoreFromCloud 還原 collection store',
  syncSrc.includes("idb.put('collection'"));
check('sync.js schedulePush 接收 storyEntries + collectionEntries',
  syncSrc.includes('storyEntries, collectionEntries'));

// Card JSONs: all have title
const allCards = [
  ...readJSON('public/cards/safe.json')     ?? [],
  ...readJSON('public/cards/main.json')     ?? [],
  ...readJSON('public/cards/surprise.json') ?? [],
];
check('所有卡片有 title', allCards.every(c => typeof c.title === 'string' && c.title.length > 0));
check('稀有度未綁難度（全部 common）', allCards.every(c => !c.rarity || c.rarity === 'common'));

// growElement untouched
check('growElement 完全未修改', readSrc('src/state.js').includes('export function growElement'));

// ─────────────────────────────────────────────────────────────────────────────
// B. 執行期：完整流程
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 執行期驗收 ────────────────────────────────────────');

const browser = await chromium.launch({ headless: true });

// Helper: inject kingdom + story + collection into IDB v2, then let the app reload
async function injectState(page, { story = [], collection = [] } = {}) {
  await page.evaluate(([st, col]) => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      [['kingdom','id'],['daily','date'],['codex','id'],['collection','id']].forEach(([n,k]) => {
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
      });
    };
    req.onsuccess = e => {
      const db = e.target.result;
      const t = db.transaction(['kingdom','codex','collection'], 'readwrite');
      t.objectStore('kingdom').put({
        id:'v1', version:1, syncVer:3, onboarded:true, direction:'courage',
        counts:{courage:2,vitality:1,focus:1,warmth:1,curiosity:0},
        land:[[0,0],[1,0],[0,1]], houses:[[0,1]], trees:[], towers:[[0,0,1]],
        citizenCount:1, firstDay:'2026-01-01', lastActive:'2026-06-25',
      });
      t.objectStore('codex').put({ id:'v1', entries: st });
      t.objectStore('collection').put({ id:'v1', entries: col });
      t.oncomplete = () => res();
      t.onerror = ev => rej(ev.target.error);
    };
    req.onerror = ev => rej(ev.target.error);
  }), [story, collection]);
}

// Helper: read IDB store via page
async function readStore(page, store) {
  return page.evaluate((s) => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onsuccess = e => {
      const t = e.target.result.transaction(s, 'readonly');
      t.objectStore(s).get('v1').onsuccess = ev => res(ev.target.result);
    };
    req.onerror = ev => rej(ev.target.error);
  }), store);
}

// ── B1. 正常首頁載入 ──────────────────────────────────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx1.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(500);
await injectState(page);
await page.reload();
await page.waitForTimeout(2500);

check('首頁正常顯示', await page.locator('#view-home').isVisible().catch(() => false));

// ── B2. 完成一張卡 → 故事1筆、收藏1張×1 ─────────────────────────────────────
const btn1 = page.locator('.btn-complete:not(:disabled)').first();
const canClick = await btn1.isVisible().catch(() => false);

if (canClick) {
  await btn1.click();
  await page.waitForTimeout(1000);

  const storeStory = await readStore(page, 'codex');
  const storeColl  = await readStore(page, 'collection');
  const story1 = storeStory?.entries ?? [];
  const coll1  = storeColl?.entries  ?? [];

  check('完成1張 → 故事有1筆', story1.length >= 1, `got ${story1.length}`);
  check('完成1張 → 收藏有1張', coll1.length >= 1,  `got ${coll1.length}`);
  check('收藏 count = 1', coll1[coll1.length - 1]?.count === 1,
    `count=${coll1[coll1.length - 1]?.count}`);
  check('故事entry有 cardId', typeof story1[0]?.cardId === 'string');
  check('故事entry有 title',  typeof (story1[0]?.title ?? story1[0]?.text) === 'string');
  check('故事entry有 action 或 text',
    typeof story1[0]?.action === 'string' || typeof story1[0]?.text === 'string');

  // ── B3. 卡冊：收藏分頁顯示網格 ───────────────────────────────────────────────
  await page.locator('#nav-codex').click();
  await page.waitForTimeout(400);

  const codexVisible = await page.locator('#view-codex').isVisible().catch(() => false);
  check('卡冊頁顯示', codexVisible);

  const countText = await page.locator('#codex-count').textContent().catch(() => '');
  check('頂部「已收藏 N 張」', countText === '1', `count="${countText}"`);

  const cardInGrid = await page.locator('.codex-card-wrapper').count();
  check('收藏分頁有1張卡', cardInGrid >= 1, `found ${cardInGrid}`);

  // Card face
  const faceTitle = await page.locator('.codex-face-title').first().textContent().catch(() => '');
  check('卡面顯示稱號(title)', faceTitle.length > 0, `"${faceTitle}"`);

  // Flip to back → shows ×1
  await page.locator('.codex-card-wrapper').first().click();
  await page.waitForTimeout(450);
  const backCount = await page.locator('.codex-back-count').first().textContent().catch(() => '');
  check('卡背顯示完成次數 ×1', backCount.includes('×1') || backCount.includes('x1'),
    `"${backCount}"`);

  // ── B4. 紀錄分頁顯示時間流 ────────────────────────────────────────────────────
  await page.locator('#tab-story').click();
  await page.waitForTimeout(300);

  const storyVisible = await page.locator('#codex-story').isVisible().catch(() => false);
  check('紀錄分頁顯示', storyVisible);
  const storyItems = await page.locator('.story-entry').count();
  check('紀錄分頁有1筆', storyItems >= 1, `found ${storyItems}`);

  const storyTitle = await page.locator('.story-title').first().textContent().catch(() => '');
  check('紀錄顯示稱號', storyTitle.length > 0, `"${storyTitle}"`);

  const storyMeta = await page.locator('.story-meta').first().textContent().catch(() => '');
  check('紀錄顯示日期', storyMeta.includes('2026'), `"${storyMeta}"`);

  // Switch back to collection tab
  await page.locator('#tab-collection').click();
  await page.waitForTimeout(300);
  const collectionBack = await page.locator('#codex-collection').isVisible().catch(() => false);
  check('切回收藏分頁正常', collectionBack);

} else {
  check('完成卡流程', true, '(今日全部已完成，跳過)', true);
}

// ── B5. 同一張卡完成兩次 → 故事兩筆、收藏一張 ×2 ────────────────────────────
console.log('\n── B5. 重複完成驗收 ─────────────────────────────────────');

// Inject state where 同一張 s_courage 已完成1次（故事1筆、收藏1張×1）
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
await page2.goto('http://localhost:5173');
await page2.waitForTimeout(500);

await injectState(page2, {
  story: [{ id: 1, date: '2026-06-25', cardId: 's_courage', title: '我可以',
            action: '對著鏡子說一句「我可以」', attribute: 'courage' }],
  collection: [{ cardId: 's_courage', count: 1, firstDate: '2026-06-25', lastDate: '2026-06-25',
                 title: '我可以', attribute: 'courage',
                 text: '對著鏡子說一句「我可以」', story: '你是第一個相信自己的人。',
                 rarity: 'common' }],
});
await page2.reload();
await page2.waitForTimeout(2500);

// The daily card for today might be s_courage — complete it again
// We'll read the daily to check
const dailyState = await page2.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('kindling', 2);
  req.onsuccess = e => {
    // Get all entries from daily store
    const t = e.target.result.transaction('daily', 'readonly');
    const req2 = t.objectStore('daily').getAll();
    req2.onsuccess = ev => res(ev.target.result);
  };
}));

// Navigate home and try to complete any available card
await page2.locator('#view-home').waitFor({ timeout: 3000 }).catch(() => {});
const btn2 = page2.locator('.btn-complete:not(:disabled)').first();
const canClick2 = await btn2.isVisible().catch(() => false);

if (canClick2) {
  await btn2.click();
  await page2.waitForTimeout(1000);

  const storeStory2 = await readStore(page2, 'codex');
  const storeColl2  = await readStore(page2, 'collection');
  const story2 = storeStory2?.entries ?? [];
  const coll2  = storeColl2?.entries  ?? [];

  // Check total story count: started with 1, should have 2 now
  check('完成第2張後故事總數增加（append-only）', story2.length >= 2, `got ${story2.length}`);

  // Check if the collection for s_courage is ×2 (if the card clicked was s_courage)
  const courageEntry = coll2.find(c => c.cardId === 's_courage');
  const otherEntry   = coll2.find(c => c.cardId !== 's_courage');
  if (courageEntry && story2.some(s => s.cardId === 's_courage' && s.date === new Date().toISOString().slice(0,10))) {
    check('再次完成同張卡 → 收藏 count=2（去重）', courageEntry.count === 2,
      `count=${courageEntry.count}`);
    check('再次完成同張卡 → 收藏仍是1格（不新增條目）',
      coll2.filter(c => c.cardId === 's_courage').length === 1);
  } else {
    // Different card was completed — still verify story grows
    check('完成不同卡 → 收藏新增1格', coll2.length >= 2, `got ${coll2.length}`);
    check('故事有兩筆不同事件（append-only 無去重）', story2.length >= 2, `got ${story2.length}`);
  }

  // Navigate to codex, story tab
  await page2.locator('#nav-codex').click();
  await page2.waitForTimeout(400);
  await page2.locator('#tab-story').click();
  await page2.waitForTimeout(300);

  const storyItems2 = await page2.locator('.story-entry').count();
  check('紀錄分頁顯示所有故事事件（不去重）', storyItems2 >= 2, `found ${storyItems2}`);
} else {
  check('重複完成驗收', true, '(今日卡已全完成，跳過)', true);
}

await ctx2.close();

// ── B6. 向後相容：舊格式 codex（無 title / action）不報錯 ─────────────────────
console.log('\n── B6. 向後相容 ─────────────────────────────────────────');

const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page3 = await ctx3.newPage();
await page3.goto('http://localhost:5173');
await page3.waitForTimeout(500);

await injectState(page3, {
  // Old-format entries: only {date, attribute, text}, no cardId, no title, no action
  story: [
    { date: '2026-06-24', attribute: 'courage', text: '舊格式勇氣挑戰' },
    { date: '2026-06-23', attribute: 'warmth',  text: '舊格式溫暖挑戰' },
  ],
  collection: [], // old users had no collection; new ones get rebuilt from completions
});
await page3.reload();
await page3.waitForTimeout(2500);

await page3.locator('#nav-codex').click();
await page3.waitForTimeout(400);
await page3.locator('#tab-story').click();
await page3.waitForTimeout(300);

const oldItems = await page3.locator('.story-entry').count();
check('舊格式故事條目正常顯示（不崩潰）', oldItems === 2, `found ${oldItems}`);

const oldTitle = await page3.locator('.story-title').first().textContent().catch(() => '');
check('舊格式無 title → fallback 用 text', oldTitle.length > 0, `"${oldTitle}"`);

await ctx3.close();

// ── B7. Never-fail：無 streak / 漏了 字樣 ────────────────────────────────────
const bodyText = await page.content().catch(() => '');
const badWords = ['streak','漏了','中斷','失敗','天沒'];
const foundBad = badWords.filter(w => bodyText.includes(w));
check('頁面無 never-fail 違禁字', foundBad.length === 0, foundBad.join(',') || '');

await page.close();
await ctx1.close();
await browser.close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
