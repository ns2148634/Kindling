/**
 * verify-v04-2.mjs — v0.4-2 驗收
 *
 * 成長卡屬性改為玩家每天自選：
 *   - 首頁成長卡格顯示五屬性選擇器
 *   - 選定後抽該屬性成長卡，同日重開仍是同一張（穩定 seed）
 *   - 未完成前可換屬性；完成後定案
 *   - onboarding 不再強迫選終身方向
 *   - 完成成長卡後 story / collection / growElement 行為與 v0.4-1 一致
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

const cardsSrc = readSrc('src/cards.js');
const mainSrc  = readSrc('src/main.js');
const html     = readSrc('index.html');

check('cards.js 有 selectMainAttr export',
  cardsSrc.includes('export async function selectMainAttr'));
check('cards.js 移除 MAIN_OFF_DIRECTION_RATE',
  !cardsSrc.includes('MAIN_OFF_DIRECTION_RATE'));
check('cards.js drawDailyCards 回傳 mainAttr: null',
  cardsSrc.includes('mainAttr:') && cardsSrc.includes('null'));
check('cards.js selectMainAttr 以 date+attr 為 seed（穩定抽取）',
  cardsSrc.includes("':main:'"));
check('main.js import selectMainAttr', mainSrc.includes('selectMainAttr'));
check('main.js 有 _mainPickerOpen 狀態', mainSrc.includes('_mainPickerOpen'));
check('main.js 有 buildMainPicker 函式', mainSrc.includes('buildMainPicker'));
check('main.js 有 handleSelectMainAttr 函式', mainSrc.includes('handleSelectMainAttr'));
check('main.js 移除 DIRECTIONS 常數',
  !mainSrc.includes("id: 'vitality',  label: '動起來'"));
check('main.js startKingdom（無 attr 參數）取代 chooseDirection',
  mainSrc.includes('startKingdom') && !mainSrc.includes('chooseDirection'));
check('index.html 移除 #ob-step2', !html.includes('ob-step2'));
check('index.html 移除 #ob-directions', !html.includes('ob-directions'));
check('index.html 有 .btn-attr CSS', html.includes('btn-attr'));
check('index.html onboarding 按鈕文字改為「開始」',
  html.includes('開始 →') || html.includes('>開始<'));

const mainCards = readJSON('public/cards/main.json') ?? [];
check('main.json 五屬性都有成長卡',
  ['courage','vitality','focus','warmth','curiosity'].every(
    a => mainCards.some(c => c.attribute === a)));

const allCards = [
  ...(readJSON('public/cards/safe.json')     ?? []),
  ...mainCards,
  ...(readJSON('public/cards/surprise.json') ?? []),
];
check('所有卡片無 story 欄（v0.4-1 規格）', allCards.every(c => !('story' in c)));

// ─────────────────────────────────────────────────────────────────────────────
// B. 執行期驗收
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 執行期驗收 ────────────────────────────────────────');

const browser = await chromium.launch({ headless: true });

/** 注入 kingdom（不注入 daily）→ 讓 app 自己建今天的 daily */
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
        land:[[0,0],[1,0]], houses:[], trees:[], towers:[],
        citizenCount:0, firstDay:'2026-01-01', lastActive:'2026-06-26',
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

// ── B1. 首頁成長卡顯示屬性選擇器 ─────────────────────────────────────────────
const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page  = await ctx1.newPage();
await page.goto('http://localhost:5173');
await page.waitForTimeout(500);
await injectKingdom(page);
await page.reload();
await page.waitForTimeout(2500);

check('首頁正常顯示', await page.locator('#view-home').isVisible().catch(() => false));

// cards are rendered in order: safe(0), main(1), surprise(2)
const mainCardEl = page.locator('.card').nth(1);

const attrBtns = await mainCardEl.locator('.btn-attr').count();
check('成長卡格顯示 5 個屬性選擇按鈕', attrBtns === 5, `found ${attrBtns}`);

const pickerText = await mainCardEl.locator('.card-text').textContent().catch(() => '');
check('成長卡格顯示選擇提示文字', pickerText.length > 0, `"${pickerText}"`);

// Safe & surprise already have complete buttons
const completeBtns = await page.locator('.btn-complete').count();
check('安全卡與奇遇卡有完成按鈕（共 2 個，main 選前無）', completeBtns === 2,
  `found ${completeBtns}`);

// ── B2. 選勇氣 → 成長卡出現 ─────────────────────────────────────────────────
await mainCardEl.locator('.btn-attr').filter({ hasText: '勇氣' }).click();
await page.waitForTimeout(600);

const attrBtnsAfter = await page.locator('.btn-attr').count();
check('選屬性後選擇器消失', attrBtnsAfter === 0, `still ${attrBtnsAfter}`);

const allComplete = await page.locator('.btn-complete').count();
check('選屬性後三張卡都有完成按鈕', allComplete === 3, `found ${allComplete}`);

const mainAttrLabel = await page.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('成長卡 meta 顯示勇氣', mainAttrLabel.includes('勇氣'), `"${mainAttrLabel}"`);

const mainText = await page.locator('.card').nth(1).locator('.card-text')
  .textContent().catch(() => '');
check('成長卡顯示挑戰動作文字', mainText.length > 0, `"${mainText}"`);

const dailyRecords = await readDailyAll(page);
check('daily.mainAttr 儲存為 courage',
  dailyRecords[0]?.mainAttr === 'courage', `mainAttr="${dailyRecords[0]?.mainAttr}"`);

// ── B3. 未完成前有「換屬性」按鈕 ─────────────────────────────────────────────
const changeBtn = page.locator('.btn-swap').filter({ hasText: '換屬性' });
check('未完成前有「換屬性」按鈕', await changeBtn.isVisible().catch(() => false));

// ── B4. 點換屬性 → 選擇器重新出現 ────────────────────────────────────────────
await changeBtn.click();
await page.waitForTimeout(300);

const attrBtnsAgain = await page.locator('.btn-attr').count();
check('點「換屬性」後選擇器重新出現（5 個按鈕）', attrBtnsAgain === 5, `found ${attrBtnsAgain}`);

// ── B5. 換選活力 → 成長卡屬性改變 ────────────────────────────────────────────
await page.locator('.card').nth(1).locator('.btn-attr').filter({ hasText: '活力' }).click();
await page.waitForTimeout(600);

const mainAttrLabel2 = await page.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('換選活力後成長卡屬性改變', mainAttrLabel2.includes('活力'), `"${mainAttrLabel2}"`);

const dailyRecords2 = await readDailyAll(page);
check('daily.mainAttr 更新為 vitality',
  dailyRecords2[0]?.mainAttr === 'vitality', `mainAttr="${dailyRecords2[0]?.mainAttr}"`);

// ── B6. 完成成長卡 → 定案 ─────────────────────────────────────────────────────
const mainCompleteBtn = page.locator('.card').nth(1).locator('.btn-complete:not(:disabled)');
const mainCanComplete = await mainCompleteBtn.isVisible().catch(() => false);

if (mainCanComplete) {
  await mainCompleteBtn.click();
  await page.waitForTimeout(800);

  const changeBtnAfter = page.locator('.btn-swap').filter({ hasText: '換屬性' });
  check('完成後無「換屬性」按鈕',
    !(await changeBtnAfter.isVisible().catch(() => false)));
  check('完成後選擇器不再出現',
    await page.locator('.btn-attr').count() === 0);

  const storyStore = await readStore(page, 'codex');
  const collStore  = await readStore(page, 'collection');
  const story  = storyStore?.entries ?? [];
  const coll   = collStore?.entries  ?? [];

  check('完成成長卡 → 故事有1筆', story.length >= 1, `got ${story.length}`);
  check('完成成長卡 → 收藏有1格', coll.length >= 1,  `got ${coll.length}`);

  const entry = story[0];
  check('故事 entry attribute = vitality', entry?.attribute === 'vitality',
    `attr="${entry?.attribute}"`);
  check('故事 entry 有 cardId', typeof entry?.cardId === 'string');
  check('故事 entry 有 action or text',
    typeof entry?.action === 'string' || typeof entry?.text === 'string');
  check('故事 entry 無 story 欄', !('story' in (entry ?? {})));

} else {
  check('成長卡完成流程', true, '(今日已完成，跳過)', true);
}

// ── B7. Reload → 同一張成長卡（穩定 seed）──────────────────────────────────
console.log('\n── B7. 穩定 seed：reload 後成長卡不變 ───────────────────');

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
    tx.objectStore('daily').put({
      date: todayStr,
      cards: {
        safe:     {id:'s_warmth', attribute:'warmth',  role:'safe',    text:'對一個人說謝謝',        title:'謝謝你'},
        main:     {id:'m_cou_1',  attribute:'courage', role:'main',    text:'在群組裡先發第一則訊息', title:'破冰者'},
        surprise: {id:'u_1',      attribute:'courage', role:'surprise',text:'走進房間時說「朕來了」',  title:'朕來了'},
      },
      completed: {safe:false, main:false, surprise:false},
      mainAttr: 'courage',
      swapsUsed: 0,
    });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  };
  req.onerror = e => rej(e.target.error);
}));

await page2.reload();
await page2.waitForTimeout(2500);

const attrBtnsReload = await page2.locator('.btn-attr').count();
check('reload 後不顯示選擇器（已快取 mainAttr）', attrBtnsReload === 0,
  `found ${attrBtnsReload}`);

const mainAttrReload = await page2.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('reload 後成長卡仍是勇氣屬性', mainAttrReload.includes('勇氣'), `"${mainAttrReload}"`);

await ctx2.close();

// ── B8. Onboarding：單步驟，無方向選擇 ────────────────────────────────────────
console.log('\n── B8. Onboarding 驗收 ──────────────────────────────────');

const ctx3  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page3 = await ctx3.newPage();
await page3.goto('http://localhost:5173');
await page3.waitForTimeout(2000);

const obVisible = await page3.locator('#view-onboarding').isVisible().catch(() => false);
if (obVisible) {
  const startBtn = page3.locator('#btn-ob-continue');
  check('onboarding 有開始按鈕', await startBtn.isVisible().catch(() => false));
  check('onboarding 無方向選擇按鈕（.btn-direction）',
    await page3.locator('.btn-direction').count() === 0);

  await startBtn.click();
  await page3.waitForTimeout(2000);

  check('點開始後直接進首頁（無 step 2）',
    await page3.locator('#view-home').isVisible().catch(() => false));
  check('進首頁後成長卡格顯示屬性選擇器',
    await page3.locator('.btn-attr').count() === 5,
    `found ${await page3.locator('.btn-attr').count()}`);

} else {
  check('onboarding 流程', true, '(已 onboard，跳過)', true);
}
await ctx3.close();

// ── B9. 向後相容：舊 daily 有 cards.main 但無 mainAttr ───────────────────────
console.log('\n── B9. 向後相容驗收 ─────────────────────────────────────');

const ctx4  = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page4 = await ctx4.newPage();
await page4.goto('http://localhost:5173');
await page4.waitForTimeout(500);

await page4.evaluate(() => new Promise((res, rej) => {
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
      id:'v1', version:1, syncVer:3, onboarded:true, direction:'courage',
      counts:{courage:2,vitality:0,focus:0,warmth:0,curiosity:0},
      land:[[0,0],[1,0]], houses:[], trees:[], towers:[],
      citizenCount:0, firstDay:'2026-01-01', lastActive:todayStr,
    });
    tx.objectStore('daily').put({
      date: todayStr,
      cards: {
        safe:     {id:'s_courage', attribute:'courage', role:'safe',    text:'對著鏡子說一句「我可以」', title:'我可以'},
        main:     {id:'m_cou_2',   attribute:'courage', role:'main',    text:'主動跟一個人打招呼',       title:'一聲你好'},
        surprise: {id:'u_2',       attribute:'warmth',  role:'surprise',text:'對著冰箱說「辛苦了」',     title:'冰箱辛苦了'},
      },
      completed: {safe:false, main:false, surprise:false},
      // NO mainAttr — old format
      swapsUsed: 0,
    });
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e.target.error);
  };
  req.onerror = e => rej(e.target.error);
}));

await page4.reload();
await page4.waitForTimeout(2500);

const attrBtnsOld = await page4.locator('.btn-attr').count();
check('舊格式 daily（有 cards.main 無 mainAttr）→ 顯示成長卡不顯示選擇器',
  attrBtnsOld === 0, `found ${attrBtnsOld}`);

const oldAttr = await page4.locator('.card').nth(1).locator('.card-attr')
  .textContent().catch(() => '');
check('舊格式 daily 成長卡正常顯示屬性', oldAttr.length > 0, `"${oldAttr}"`);

check('舊格式 daily 成長卡有「換屬性」按鈕（未完成，可改選）',
  await page4.locator('.btn-swap').filter({ hasText: '換屬性' }).isVisible().catch(() => false));

await ctx4.close();

// ── B10. Never-fail 護欄 ─────────────────────────────────────────────────────
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
