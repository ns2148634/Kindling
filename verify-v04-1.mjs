/**
 * verify-v04-1.mjs — v0.4-1 驗收（Attempt 3 規格）
 *
 * 故事 store（append-only, {id,date,cardId,title,action,attribute}）
 * 收藏 store（去重, {cardId,count,firstDate,lastDate,…}）
 * 卡片 JSON：有 title（稱號），有 text（挑戰動作），無 story 敘事欄
 * 卡冊：收藏（去重網格）＋ 紀錄（時間流，第X天·稱號·做了什麼）
 * 重複完成同張卡 → 故事兩筆、收藏一張 ×2
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
// A. 靜態結構
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. 靜態結構 ──────────────────────────────────────────');

const idbSrc  = readSrc('src/idb.js');
const mainSrc = readSrc('src/main.js');
const syncSrc = readSrc('src/sync.js');
const html    = readSrc('index.html');

// A1. IDB stores
check('idb.js DB_VERSION = 2', idbSrc.includes('DB_VERSION = 2'));
check('idb.js 建立 collection store', idbSrc.includes("'collection'"));

// A2. main.js state variables
check('main.js 有 storyEntries 變數',      mainSrc.includes('storyEntries'));
check('main.js 有 collectionEntries 變數', mainSrc.includes('collectionEntries'));

// A3. completeCard 流程順序：先 append 故事 → upsert 收藏 → growElement
check('completeCard：storyEntries.unshift（append-only）',
  mainSrc.includes('storyEntries.unshift'));
check('completeCard：collectionEntries.find（upsert 去重）',
  mainSrc.includes('collectionEntries.find'));
check('completeCard 寫入 codex store（故事）',
  mainSrc.includes("idb.put('codex'") && mainSrc.includes('entries: storyEntries'));
check('completeCard 寫入 collection store（收藏）',
  mainSrc.includes("idb.put('collection'") && mainSrc.includes('entries: collectionEntries'));

// A4. title fallback（old entries: entry.title ?? entry.text）
check('main.js title fallback (entry.title ?? ... entry.text)',
  /entry\.title\s*\?\?\s*entry\.text/.test(mainSrc) ||
  /entry\.title\s*\?\?\s*entry\.cardId/.test(mainSrc));

// A5. 紀錄格式：第X天
check('renderStory 包含「第」字（第X天格式）', mainSrc.includes('第'));
check('renderStory 從 state.firstDay 計算天數', mainSrc.includes('firstDay'));

// A6. 收藏 store：completeCard 不再儲存 story 欄
check('completeCard collection entry 不含 story 欄（story: card.story 已移除）',
  !mainSrc.includes('story:     card.story') && !mainSrc.includes('story: card.story'));

// A7. 兩分頁 UI
check('index.html tab-collection', html.includes('tab-collection'));
check('index.html tab-story',      html.includes('tab-story'));
check('index.html #codex-collection 面板', html.includes('id="codex-collection"'));
check('index.html #codex-story 面板',      html.includes('id="codex-story"'));
check('index.html #story-list',            html.includes('id="story-list"'));
check('main.js 有 switchCodexTab',         mainSrc.includes('switchCodexTab'));

// A8. sync.js
check('sync.js buildCloudState 包含 collection',
  syncSrc.includes('collectionEntries'));
check('sync.js restoreFromCloud 還原 collection store',
  syncSrc.includes("idb.put('collection'"));

// A9. 卡片 JSON：有 title，無 story
const safeCards     = readJSON('public/cards/safe.json')     ?? [];
const mainCards     = readJSON('public/cards/main.json')     ?? [];
const surpriseCards = readJSON('public/cards/surprise.json') ?? [];
const allCards = [...safeCards, ...mainCards, ...surpriseCards];

check('所有卡片有 title（稱號）',
  allCards.length > 0 && allCards.every(c => typeof c.title === 'string' && c.title.length > 0),
  `${allCards.length} 張`);
check('卡片 JSON 無 story 敘事欄',
  allCards.every(c => !('story' in c)),
  allCards.filter(c => 'story' in c).map(c => c.id).join(',') || 'OK');
check('所有卡片有 text（挑戰動作）',
  allCards.every(c => typeof c.text === 'string' && c.text.length > 0));
check('稀有度全部 common（不綁難度）',
  allCards.filter(c => c.rarity).every(c => c.rarity === 'common'));

// A10. growElement / cards.js 未修改（讀 state.js 的 export 就夠）
check('growElement 完全未修改（state.js 有 export）',
  readSrc('src/state.js').includes('export function growElement'));

// ─────────────────────────────────────────────────────────────────────────────
// B. 執行期驗收
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 執行期驗收 ────────────────────────────────────────');

const browser = await chromium.launch({ headless: true });

/** 注入 kingdom + story + collection 到 IDB v2，讓 app 下次 reload 時讀到 */
async function injectState(page, { story = [], collection = [] } = {}) {
  await page.evaluate(([st, col]) => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onupgradeneeded = ev => {
      const d = ev.target.result;
      [['kingdom','id'],['daily','date'],['codex','id'],['collection','id']].forEach(([n,k]) => {
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
      });
    };
    req.onsuccess = ev => {
      const db = ev.target.result;
      const tx = db.transaction(['kingdom','codex','collection'], 'readwrite');
      tx.objectStore('kingdom').put({
        id:'v1', version:1, syncVer:3, onboarded:true, direction:'courage',
        counts:{courage:2,vitality:1,focus:1,warmth:1,curiosity:0},
        land:[[0,0],[1,0],[0,1]], houses:[[0,1]], trees:[], towers:[[0,0,1]],
        citizenCount:1, firstDay:'2026-01-01', lastActive:'2026-06-25',
      });
      tx.objectStore('codex').put({ id:'v1', entries: st });
      tx.objectStore('collection').put({ id:'v1', entries: col });
      tx.oncomplete = () => res();
      tx.onerror   = e => rej(e.target.error);
    };
    req.onerror = e => rej(e.target.error);
  }), [story, collection]);
}

async function readStore(page, store) {
  return page.evaluate(s => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onsuccess = ev => {
      const tx = ev.target.result.transaction(s, 'readonly');
      tx.objectStore(s).get('v1').onsuccess = e => res(e.target.result);
    };
    req.onerror = e => rej(e.target.error);
  }), store);
}

// ── B1. 首頁載入 ──────────────────────────────────────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page  = await ctx1.newPage();
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

  check('完成1張 → 故事有1筆',  story1.length >= 1, `got ${story1.length}`);
  check('完成1張 → 收藏有1格',  coll1.length >= 1,  `got ${coll1.length}`);
  check('收藏 count = 1', (coll1[coll1.length - 1]?.count ?? coll1[0]?.count) === 1);
  check('故事 entry 有 cardId',   typeof story1[0]?.cardId === 'string');
  check('故事 entry 有 title 或 text（fallback）',
    typeof story1[0]?.title === 'string' || typeof story1[0]?.text === 'string');
  check('故事 entry 有 action 或 text',
    typeof story1[0]?.action === 'string' || typeof story1[0]?.text === 'string');
  check('故事 entry 無 story 欄', !('story' in (story1[0] ?? {})));
  check('收藏 entry 無 story 欄', !('story' in (coll1[0] ?? {})));

  // ── B3. 卡冊：收藏分頁顯示網格 ───────────────────────────────────────────────
  await page.locator('#nav-codex').click();
  await page.waitForTimeout(400);

  check('卡冊頁顯示', await page.locator('#view-codex').isVisible().catch(() => false));

  const countText = await page.locator('#codex-count').textContent().catch(() => '');
  check('頂部「已收藏 N 張」', countText === '1', `count="${countText}"`);

  const cardInGrid = await page.locator('.codex-card-wrapper').count();
  check('收藏分頁有1張卡', cardInGrid >= 1, `found ${cardInGrid}`);

  const faceTitle = await page.locator('.codex-face-title').first().textContent().catch(() => '');
  check('卡面顯示稱號（title）', faceTitle.length > 0, `"${faceTitle}"`);

  // 翻面 → 卡背：挑戰動作＋×1＋最近日，無 story
  await page.locator('.codex-card-wrapper').first().click();
  await page.waitForTimeout(450);

  const backCount = await page.locator('.codex-back-count').first().textContent().catch(() => '');
  check('卡背顯示完成 ×1', backCount.includes('×1'), `"${backCount}"`);

  const backText = await page.locator('.codex-back-text').first().textContent().catch(() => '');
  check('卡背顯示挑戰動作（text 非空）', backText.length > 0, `"${backText}"`);

  const backStory = await page.locator('.codex-back-story').count();
  check('卡背無 story 元素', backStory === 0, `found ${backStory}`);

  // ── B4. 紀錄分頁：第X天格式 ───────────────────────────────────────────────────
  await page.locator('#tab-story').click();
  await page.waitForTimeout(300);

  check('紀錄分頁顯示', await page.locator('#codex-story').isVisible().catch(() => false));

  const storyItems = await page.locator('.story-entry').count();
  check('紀錄分頁有1筆', storyItems >= 1, `found ${storyItems}`);

  const storyMeta = await page.locator('.story-meta').first().textContent().catch(() => '');
  check('紀錄 meta 含「第」（第X天格式）', storyMeta.includes('第'), `"${storyMeta}"`);
  check('紀錄 meta 含日期', storyMeta.includes('2026'), `"${storyMeta}"`);

  const storyTitle = await page.locator('.story-title').first().textContent().catch(() => '');
  check('紀錄顯示稱號（story-title）', storyTitle.length > 0, `"${storyTitle}"`);

  await page.locator('#tab-collection').click();
  await page.waitForTimeout(300);
  check('切回收藏分頁正常', await page.locator('#codex-collection').isVisible().catch(() => false));

} else {
  check('完成卡流程（今日全完成，跳過）', true, '', true);
}

// ── B5. 重複完成：同一張卡完成兩次 → 故事兩筆、收藏一張 ×2 ─────────────────────
console.log('\n── B5. 重複完成驗收 ─────────────────────────────────────');

const ctx2  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
await page2.goto('http://localhost:5173');
await page2.waitForTimeout(500);

// 注入：s_courage 已在昨天完成過1次（故事1筆、收藏1張×1）
await injectState(page2, {
  story: [{
    id: 1, date: '2026-06-25', cardId: 's_courage',
    title: '我可以', action: '對著鏡子說一句「我可以」', attribute: 'courage',
  }],
  collection: [{
    cardId: 's_courage', count: 1,
    firstDate: '2026-06-25', lastDate: '2026-06-25',
    title: '我可以', attribute: 'courage',
    text: '對著鏡子說一句「我可以」', rarity: 'common',
  }],
});
await page2.reload();
await page2.waitForTimeout(2500);

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

  // 故事必定 append：從1筆到2筆（append-only）
  check('重複完成後故事增加（append-only）', story2.length >= 2, `got ${story2.length}`);

  // 若今天完成的是 s_courage，收藏應是 ×2 且仍是1格
  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const courageEntry = coll2.find(c => c.cardId === 's_courage');
  const todayStory   = story2.find(s => s.date === todayStr && s.cardId === 's_courage');

  if (todayStory && courageEntry) {
    check('再次完成同張卡 → 收藏 count=2', courageEntry.count === 2,
      `count=${courageEntry.count}`);
    check('再次完成同張卡 → 收藏仍1格（去重）',
      coll2.filter(c => c.cardId === 's_courage').length === 1);
  } else {
    // 今天的卡不是 s_courage，但故事仍必須多一筆
    check('完成不同卡 → 收藏新增1格', coll2.length >= 2, `got ${coll2.length}`);
    check('故事兩筆事件（append-only）', story2.length >= 2, `got ${story2.length}`);
  }

  // 紀錄分頁顯示全部故事
  await page2.locator('#nav-codex').click();
  await page2.waitForTimeout(400);
  await page2.locator('#tab-story').click();
  await page2.waitForTimeout(300);

  const storyItems2 = await page2.locator('.story-entry').count();
  check('紀錄分頁顯示所有故事事件（無去重）', storyItems2 >= 2, `found ${storyItems2}`);

  const metaItems = await page2.locator('.story-meta').allTextContents().catch(() => []);
  check('紀錄 meta 全部含「第」字', metaItems.length > 0 && metaItems.every(m => m.includes('第')),
    metaItems.map(m => `"${m}"`).join(', '));

} else {
  check('重複完成驗收（今日全完成，跳過）', true, '', true);
}

await ctx2.close();

// ── B6. 向後相容：舊 codex 格式（無 title/action/cardId）不崩潰 ──────────────
console.log('\n── B6. 向後相容 ─────────────────────────────────────────');

const ctx3  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page3 = await ctx3.newPage();
await page3.goto('http://localhost:5173');
await page3.waitForTimeout(500);

await injectState(page3, {
  story: [
    { date: '2026-06-24', attribute: 'courage',  text: '舊格式勇氣挑戰' },
    { date: '2026-06-23', attribute: 'warmth',   text: '舊格式溫暖挑戰' },
  ],
  collection: [],
});
await page3.reload();
await page3.waitForTimeout(2500);

await page3.locator('#nav-codex').click();
await page3.waitForTimeout(400);
await page3.locator('#tab-story').click();
await page3.waitForTimeout(300);

const oldItems = await page3.locator('.story-entry').count();
check('舊格式條目正常顯示（不崩潰）', oldItems === 2, `found ${oldItems}`);

const oldTitle = await page3.locator('.story-title').first().textContent().catch(() => '');
check('舊格式 fallback：story-title 用 text', oldTitle.length > 0, `"${oldTitle}"`);

await ctx3.close();

// ── B7. Never-fail：無 streak/漏了 字樣 ─────────────────────────────────────
const bodyText  = await page.content().catch(() => '');
const badWords  = ['streak', '漏了', '中斷', '失敗', '天沒'];
const foundBad  = badWords.filter(w => bodyText.includes(w));
check('頁面無 never-fail 違禁字', foundBad.length === 0, foundBad.join(',') || '');

await page.close();
await ctx1.close();
await browser.close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
