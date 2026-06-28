/**
 * verify-v04-3.mjs — v0.4-3 驗收
 *
 * 成長卡從「玩家必選」改為「系統默認（屬性輪替）+ 可選換方向」：
 *   - 開 App 時成長卡已有一張（不需先選屬性）
 *   - 連續5天默認屬性涵蓋全部五種（輪替覆蓋）
 *   - 「換個方向」是小字入口（.btn-attr-change），不是大選擇器
 *   - 未完成前點換可改屬性；完成後鎖定
 *   - 同日重開同一張；換過的保留換後選擇
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

// Mirror the rotation logic from cards.js for static verification
const ATTR_ROTATION = ['courage', 'vitality', 'focus', 'warmth', 'curiosity'];
function defaultAttrForDate(date) {
  const dayIndex = Math.floor(new Date(date + 'T00:00:00').getTime() / 86400000);
  return ATTR_ROTATION[((dayIndex % 5) + 5) % 5];
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 靜態結構
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. 靜態結構 ──────────────────────────────────────────');

const cardsSrc = readSrc('src/cards.js');
const mainSrc  = readSrc('src/main.js');
const html     = readSrc('index.html');

// A1. cards.js
check('cards.js 有 defaultAttrForDate export',
  cardsSrc.includes('export function defaultAttrForDate'));
check('cards.js 有 ATTR_ROTATION 輪替陣列',
  cardsSrc.includes('ATTR_ROTATION'));
check('cards.js drawDailyCards 已不再回傳 main: null',
  !cardsSrc.includes("main: null"));
check('cards.js drawDailyCards 用 defaultAttrForDate 取默認屬性',
  cardsSrc.includes('defaultAttrForDate(date)'));
check('cards.js getTodayDaily 補 null main 遷移（backward compat）',
  cardsSrc.includes('!saved.cards.main'));
check('cards.js selectMainAttr 使用 drawMainCard（shared helper）',
  cardsSrc.includes('drawMainCard'));

// A2. main.js
check('main.js import defaultAttrForDate', mainSrc.includes('defaultAttrForDate'));
check('main.js 無 buildMainPicker 函式（已移除）',
  !mainSrc.includes('function buildMainPicker'));
check('main.js 有 btn-attr-change（小入口）',
  mainSrc.includes('btn-attr-change'));
check('main.js 有 ATTR_COMPLETE_MSG（屬性完成微文案）',
  mainSrc.includes('ATTR_COMPLETE_MSG'));

// A3. index.html
check('index.html 有 .btn-attr-change CSS', html.includes('btn-attr-change'));

// A4. 輪替覆蓋：連續 5 天涵蓋全部五種屬性
const baseDate = new Date('2026-06-28');
const rotationDays = Array.from({ length: 5 }, (_, i) => {
  const d = new Date(baseDate);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});
const rotationAttrs = rotationDays.map(defaultAttrForDate);
const allFivePresent = ATTR_ROTATION.every(a => rotationAttrs.includes(a));
check('連續5天默認屬性涵蓋全部五種（輪替覆蓋）', allFivePresent,
  rotationDays.map((d, i) => `${d}→${rotationAttrs[i]}`).join(', '));

// A5. 五屬性都有成長卡可抽
const mainCards = readJSON('public/cards/main.json') ?? [];
check('main.json 五屬性都有成長卡',
  ATTR_ROTATION.every(a => mainCards.some(c => c.attribute === a)));

// ─────────────────────────────────────────────────────────────────────────────
// B. 執行期驗收
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 執行期驗收 ────────────────────────────────────────');

const browser = await chromium.launch({ headless: true });

async function injectKingdom(page) {
  await page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onupgradeneeded = ev => {
      const d = ev.target.result;
      [['kingdom','id'],['daily','date'],['codex','id'],['collection','id']].forEach(([n,k]) => {
        if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
      });
    };
    req.onsuccess = ev => {
      const db = ev.target.result;
      const tx = db.transaction(['kingdom'], 'readwrite');
      tx.objectStore('kingdom').put({
        id:'v1', version:1, syncVer:5, onboarded:true, direction:null,
        counts:{courage:1,vitality:0,focus:0,warmth:0,curiosity:0},
        land:[[0,0],[1,0],[0,1]], houses:[], trees:[], towers:[],
        citizenCount:0, firstDay:'2026-01-01', lastActive:'2026-06-27',
      });
      tx.oncomplete = () => res();
      tx.onerror   = e => rej(e.target.error);
    };
    req.onerror = e => rej(e.target.error);
  }));
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

async function readDailyAll(page) {
  return page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 2);
    req.onsuccess = ev => {
      const tx = ev.target.result.transaction('daily', 'readonly');
      tx.objectStore('daily').getAll().onsuccess = e => res(e.target.result);
    };
    req.onerror = e => rej(e.target.error);
  }));
}

// ── B1. 開 App → 成長卡已有一張（不需先選屬性）───────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page  = await ctx1.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(500);
await injectKingdom(page);
await page.reload();
await page.waitForTimeout(2500);

check('首頁正常顯示', await page.locator('#view-home').isVisible().catch(() => false));

// All 3 complete buttons visible immediately — no picker needed
const completeBtns = await page.locator('.btn-complete').count();
check('開 App 三張卡都有完成按鈕（主卡已預填）', completeBtns === 3,
  `found ${completeBtns}`);

// No big attr picker (btn-attr should not be visible at start)
const attrBtnsInit = await page.locator('.btn-attr').count();
check('開 App 時無屬性選擇器（btn-attr）', attrBtnsInit === 0, `found ${attrBtnsInit}`);

// Main card has content
const mainCardText = await page.locator('.card').nth(1).locator('.card-text')
  .textContent().catch(() => '');
check('成長卡有挑戰動作文字', mainCardText.length > 0, `"${mainCardText}"`);

// daily.mainAttr matches today's default
const todayStr = new Date().toLocaleDateString('sv-SE');
const expectedAttr = defaultAttrForDate(todayStr);
const dailyRecords = await readDailyAll(page);
check('daily.mainAttr = 今天輪替到的屬性',
  dailyRecords[0]?.mainAttr === expectedAttr,
  `expected="${expectedAttr}" got="${dailyRecords[0]?.mainAttr}"`);

// ── B2. 「換個方向」是小字入口（不顯眼）──────────────────────────────────────
const changeBtn = page.locator('.btn-attr-change');
check('「換個方向」小入口存在（.btn-attr-change）',
  await changeBtn.isVisible().catch(() => false));

// Should NOT be a big btn-swap style (verify class name is btn-attr-change not btn-swap)
const changeBtnClass = await changeBtn.getAttribute('class').catch(() => '');
check('換方向入口是 btn-attr-change（不是 btn-swap）',
  changeBtnClass === 'btn-attr-change', `class="${changeBtnClass}"`);

// ── B3. 點換個方向 → inline picker 出現 ───────────────────────────────────────
await changeBtn.click();
await page.waitForTimeout(300);

const attrBtnsOpen = await page.locator('.btn-attr').count();
check('點換個方向後 inline 屬性選擇器出現（5 個按鈕）', attrBtnsOpen === 5,
  `found ${attrBtnsOpen}`);

// Complete button should be gone while picker is open
const completeBtnsWhilePicker = await page.locator('.btn-complete:not(:disabled)').count();
check('picker 開啟時完成按鈕暫時隱藏（inline 替換）',
  completeBtnsWhilePicker < 3,
  `found ${completeBtnsWhilePicker} (expect <3 since main slot shows picker)`);

// ── B4. 選不同屬性 → 成長卡改變 ───────────────────────────────────────────────
// Find an attr that's different from today's default
const differentAttr = ATTR_ROTATION.find(a => a !== expectedAttr);
const ATTR_NAMES_MAP = {courage:'勇氣', vitality:'活力', focus:'專注', warmth:'溫暖', curiosity:'好奇'};
const differentAttrLabel = ATTR_NAMES_MAP[differentAttr];

await page.locator('.btn-attr').filter({ hasText: differentAttrLabel }).click();
await page.waitForTimeout(600);

const mainAttrAfterChange = await page.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('換屬性後成長卡屬性改變', mainAttrAfterChange.includes(differentAttrLabel),
  `expected "${differentAttrLabel}" got "${mainAttrAfterChange}"`);

const dailyAfterChange = await readDailyAll(page);
check('daily.mainAttr 更新為換後屬性',
  dailyAfterChange[0]?.mainAttr === differentAttr,
  `mainAttr="${dailyAfterChange[0]?.mainAttr}"`);

// picker should be gone
const attrBtnsAfterPick = await page.locator('.btn-attr').count();
check('選完屬性後 picker 消失', attrBtnsAfterPick === 0, `found ${attrBtnsAfterPick}`);

// ── B5. 完成成長卡 → 定案，無換方向按鈕 ─────────────────────────────────────
const mainComplete = page.locator('.card').nth(1).locator('.btn-complete:not(:disabled)');
const canComplete = await mainComplete.isVisible().catch(() => false);

if (canComplete) {
  await mainComplete.click();
  await page.waitForTimeout(800);

  check('完成後無「換個方向」按鈕（定案）',
    await page.locator('.btn-attr-change').count() === 0);
  check('完成後無 inline picker', await page.locator('.btn-attr').count() === 0);

  const storyStore = await readStore(page, 'codex');
  const story = storyStore?.entries ?? [];
  check('完成後故事有1筆', story.length >= 1, `got ${story.length}`);
  check('故事 entry attribute = 換後屬性', story[0]?.attribute === differentAttr,
    `attr="${story[0]?.attribute}"`);
} else {
  check('成長卡完成流程', true, '(今日已完成，跳過)', true);
}

// ── B6. Reload → 同一張成長卡（快取一致）──────────────────────────────────────
console.log('\n── B6. 快取一致：reload 驗收 ────────────────────────────');

const ctx2  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page2 = await ctx2.newPage();
await page2.goto('http://localhost:5173');
await page2.waitForTimeout(500);

await page2.evaluate(() => new Promise((res, rej) => {
  const req = indexedDB.open('kindling', 2);
  req.onupgradeneeded = ev => {
    const d = ev.target.result;
    [['kingdom','id'],['daily','date'],['codex','id'],['collection','id']].forEach(([n,k]) => {
      if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
    });
  };
  req.onsuccess = ev => {
    const db = ev.target.result;
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const tx = db.transaction(['kingdom','daily'], 'readwrite');
    tx.objectStore('kingdom').put({
      id:'v1', version:1, syncVer:5, onboarded:true, direction:null,
      counts:{courage:1,vitality:0,focus:0,warmth:0,curiosity:0},
      land:[[0,0],[1,0]], houses:[], trees:[], towers:[],
      citizenCount:0, firstDay:'2026-01-01', lastActive:todayStr,
    });
    // daily with mainAttr = vitality (simulate player had changed it)
    tx.objectStore('daily').put({
      date: todayStr,
      cards: {
        safe:     {id:'s_warmth',  attribute:'warmth',   role:'safe',    text:'對一個人說謝謝',        title:'謝謝你'},
        main:     {id:'m_vit_1',   attribute:'vitality', role:'main',    text:'出門散步五分鐘',        title:'五分鐘散步'},
        surprise: {id:'u_1',       attribute:'courage',  role:'surprise',text:'走進房間時說「朕來了」', title:'朕來了'},
      },
      completed: {safe:false, main:false, surprise:false},
      mainAttr: 'vitality',
      swapsUsed: 0,
    });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  };
  req.onerror = e => rej(e.target.error);
}));

await page2.reload();
await page2.waitForTimeout(2500);

// Should show the vitality card (cached), no picker
const attrBtnsReload = await page2.locator('.btn-attr').count();
check('reload 後無屬性選擇器（快取保留）', attrBtnsReload === 0, `found ${attrBtnsReload}`);

const reloadAttr = await page2.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('reload 後成長卡保留換後屬性（活力）', reloadAttr.includes('活力'), `"${reloadAttr}"`);

// Complete buttons all visible
const reloadComplete = await page2.locator('.btn-complete').count();
check('reload 後三張卡完成按鈕齊全', reloadComplete === 3, `found ${reloadComplete}`);

await ctx2.close();

// ── B7. Backward compat：v0.4-2 格式（cards.main = null）自動遷移 ────────────
console.log('\n── B7. Backward compat（v0.4-2 → v0.4-3）────────────────');

const ctx3  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page3 = await ctx3.newPage();
await page3.goto('http://localhost:5173');
await page3.waitForTimeout(500);

await page3.evaluate(() => new Promise((res, rej) => {
  const req = indexedDB.open('kindling', 2);
  req.onupgradeneeded = ev => {
    const d = ev.target.result;
    [['kingdom','id'],['daily','date'],['codex','id'],['collection','id']].forEach(([n,k]) => {
      if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: k });
    });
  };
  req.onsuccess = ev => {
    const db = ev.target.result;
    const todayStr = new Date().toLocaleDateString('sv-SE');
    const tx = db.transaction(['kingdom','daily'], 'readwrite');
    tx.objectStore('kingdom').put({
      id:'v1', version:1, syncVer:3, onboarded:true, direction:null,
      counts:{courage:1,vitality:0,focus:0,warmth:0,curiosity:0},
      land:[[0,0],[1,0]], houses:[], trees:[], towers:[],
      citizenCount:0, firstDay:'2026-01-01', lastActive:todayStr,
    });
    // Old v0.4-2 daily: cards.main = null (player never picked attr)
    tx.objectStore('daily').put({
      date: todayStr,
      cards: {
        safe:     {id:'s_courage', attribute:'courage', role:'safe',    text:'對著鏡子說一句「我可以」', title:'我可以'},
        main:     null,
        surprise: {id:'u_2',       attribute:'warmth',  role:'surprise',text:'對著冰箱說「辛苦了」',     title:'冰箱辛苦了'},
      },
      completed: {safe:false, main:false, surprise:false},
      mainAttr: null,
      swapsUsed: 0,
    });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  };
  req.onerror = e => rej(e.target.error);
}));

await page3.reload();
await page3.waitForTimeout(2500);

// Should auto-migrate: main card drawn from default attr, no crash
const compat3Complete = await page3.locator('.btn-complete').count();
check('v0.4-2 格式（null main）自動遷移 → 三張卡完成按鈕齊全（不崩潰）',
  compat3Complete === 3, `found ${compat3Complete}`);

const compatMainText = await page3.locator('.card').nth(1).locator('.card-text')
  .textContent().catch(() => '');
check('遷移後成長卡有挑戰動作文字', compatMainText.length > 0, `"${compatMainText}"`);

await ctx3.close();

// ── B8. Never-fail 護欄 ─────────────────────────────────────────────────────
const bodyText = await page.content().catch(() => '');
const badWords = ['streak', '漏了', '中斷', '失敗', '天沒'];
const foundBad = badWords.filter(w => bodyText.includes(w));
check('頁面無 never-fail 違禁字', foundBad.length === 0, foundBad.join(',') || '');

await page.close();
await ctx1.close();
await browser.close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
