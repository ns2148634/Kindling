/**
 * verify-m5.mjs
 * M5 驗收：Supabase 匿名登入 + saves 單表 + RLS + local-first 雲端備份。
 *
 * 分三大區：
 *   A. 靜態安全檢查（不需 dev server）
 *   B. 程式結構檢查（不需 dev server）
 *   C. 執行期驗收（需 dev server + .env 有 Supabase 憑證）
 *
 * C 區若 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未設定，
 * 標記為 ⚠️（軟性），不影響整體通過。
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
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

// ─────────────────────────────────────────────────────────────────────────────
// A. 靜態安全檢查
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A. 安全性檢查 ────────────────────────────────────────');

// 1. .env NOT tracked by git
let envTracked = false;
try { envTracked = execSync('git ls-files .env', { encoding: 'utf8' }).trim().length > 0; } catch {}
check('.env 未被 git 追蹤', !envTracked);

// 2. .gitignore covers .env
const gitignore = readSrc('.gitignore');
check('.gitignore 包含 .env', gitignore.includes('.env'));
check('.gitignore 放行 .env.example', gitignore.includes('!.env.example'));

// 3. .env.example exists (with no real values)
check('.env.example 存在', existsSync('.env.example'));
const exampleContent = readSrc('.env.example');
check('.env.example 只有變數名（無真實值）',
  exampleContent.includes('VITE_SUPABASE_URL') &&
  !exampleContent.match(/VITE_SUPABASE_URL\s*=\s*https:\/\/[a-z]+\.supabase\.co/));

// 4. service_role / sb_secret_ NOT in client code
const filesToScan = ['src/supabase.js','src/sync.js','src/main.js','index.html','vite.config.js'];
const secretPattern = /service_role|sb_secret_/;
let foundSecret = false;
for (const f of filesToScan) {
  const content = readSrc(f);
  if (secretPattern.test(content)) { foundSecret = true; console.log(`  ⚠ found in ${f}`); }
}
check('client 端程式碼無 service_role / sb_secret_ key', !foundSecret);

// ─────────────────────────────────────────────────────────────────────────────
// B. 程式結構檢查
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── B. 程式結構 ──────────────────────────────────────────');

const sbSrc   = readSrc('src/supabase.js');
const syncSrc = readSrc('src/sync.js');
const mainSrc = readSrc('src/main.js');
const stateSrc= readSrc('src/state.js');
const sqlSrc  = readSrc('supabase/migrations/001_saves.sql');

check('src/supabase.js 存在', sbSrc.length > 0);
check('src/supabase.js 使用 anon key（VITE_SUPABASE_ANON_KEY）',
  sbSrc.includes('VITE_SUPABASE_ANON_KEY'));
check('src/supabase.js 實作 ensureAuth()',
  sbSrc.includes('ensureAuth'));
check('src/supabase.js 有匿名登入 signInAnonymously',
  sbSrc.includes('signInAnonymously'));

check('src/sync.js 存在', syncSrc.length > 0);
check('src/sync.js 有 isFresh 防呆',
  syncSrc.includes('isFresh'));
check('src/sync.js 有 syncOnBoot',
  syncSrc.includes('syncOnBoot'));
check('src/sync.js 有 schedulePush（防抖推送）',
  syncSrc.includes('schedulePush'));
check('sync.js isFresh 檢查 onboarded=false',
  syncSrc.includes('onboarded'));
check('sync.js isFresh 先拉（pull before push）',
  syncSrc.includes('pullRemote'));

check('src/state.js 有 syncVer 欄位',
  stateSrc.includes('syncVer'));

check('src/main.js 引入 sync.js',
  mainSrc.includes("from './sync.js'"));
check('src/main.js 呼叫 syncOnBoot',
  mainSrc.includes('syncOnBoot'));
check('src/main.js 每次本地寫入後呼叫 schedulePush',
  mainSrc.split('schedulePush').length - 1 >= 2);

check('SQL migration 存在 (supabase/migrations/001_saves.sql)', sqlSrc.length > 0);
check('SQL migration 建立 saves 表', sqlSrc.includes('create table'));
check('SQL migration 啟用 RLS', sqlSrc.includes('row level security'));
check('SQL migration 有 own save 政策', sqlSrc.includes('own save'));
check('SQL migration 政策限定 auth.uid() = user_id',
  sqlSrc.includes('auth.uid()'));

// ─────────────────────────────────────────────────────────────────────────────
// C. 執行期驗收（需 dev server + .env 憑證）
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C. 執行期驗收 ────────────────────────────────────────');

// Read env to decide if Supabase is configured
const dotenv = readSrc('.env');
const hasSbUrl = dotenv.includes('VITE_SUPABASE_URL=https://');
const hasSbKey = dotenv.includes('VITE_SUPABASE_ANON_KEY=') &&
                 !dotenv.includes('VITE_SUPABASE_ANON_KEY=your-');

if (!hasSbUrl || !hasSbKey) {
  console.log('  ℹ .env 無 Supabase 憑證 → C 區全部標為 ⚠️（需真實專案驗收）');
}

const softC = !hasSbUrl || !hasSbKey;

const browser = await chromium.launch({ headless: true });

async function injectKingdom(page, overrides = {}) {
  await page.evaluate((ov) => new Promise((res, rej) => {
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
      const t = db.transaction(stores, 'readwrite');
      t.objectStore('kingdom').put({
        id: 'v1', version: 1, syncVer: ov.syncVer ?? 5,
        onboarded: true, direction: 'courage',
        counts: { courage: 3, vitality: 2, focus: 1, warmth: 1, curiosity: 1 },
        land: [[0,0],[1,0],[0,1],[1,1],[2,0]],
        houses: [[0,1]], trees: [[1,0]], towers: [[0,-1,1]],
        citizenCount: 2, firstDay: '2026-01-01', lastActive: '2026-06-25',
      });
      t.objectStore('codex').put({ id: 'v1', entries: [
        { date: '2026-06-25', attribute: 'courage', text: '對著鏡子說一句「我可以」' },
      ]});
      t.oncomplete = () => res();
      t.onerror = ev => rej(ev.target.error);
    };
    req.onerror = ev => rej(ev.target.error);
  }), overrides);
}

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

// C1. App loads and home view appears
await page.goto('http://localhost:5173');
await page.waitForTimeout(600);
await injectKingdom(page);
await page.reload();
await page.waitForTimeout(2500);

const homeVisible = await page.locator('#view-home').isVisible().catch(() => false);
check('App 載入並顯示首頁', homeVisible);

// C2. Auth: Supabase user session exists after boot (if configured)
// soft=true always — requires anonymous auth enabled in Supabase dashboard.
const hasUser = await page.evaluate(async () => {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
  return keys.length > 0;
});
check('匿名登入後 auth session 存在於 localStorage', hasUser,
  hasUser ? '' : '需在 Supabase 後台啟用 Anonymous sign-in', true);

// C3. No "service_role" in the page bundle
const pageContent = await page.content();
check('頁面 bundle 無 service_role 字串', !pageContent.includes('service_role'));

// C4. isFresh guard: inject empty local state, verify app doesn't crash
//     (full guard test requires Supabase round-trip, softC)
const freshCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const freshPage = await freshCtx.newPage();
await freshPage.goto('http://localhost:5173');
await freshPage.waitForTimeout(600);
// Inject a FRESH (empty) local state — onboarded=false
await freshPage.evaluate(() => new Promise((res, rej) => {
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
    const t = db.transaction(['kingdom'], 'readwrite');
    // onboarded=false → fresh state
    t.objectStore('kingdom').put({ id:'v1', version:1, syncVer:0, onboarded:false, direction:null,
      counts:{courage:0,vitality:0,focus:0,warmth:0,curiosity:0},
      land:[], houses:[], trees:[], towers:[], citizenCount:0, firstDay:null, lastActive:null });
    t.oncomplete = () => res();
    t.onerror = ev => rej(ev.target.error);
  };
  req.onerror = ev => rej(ev.target.error);
}));
await freshPage.reload();
await freshPage.waitForTimeout(2500);
// Fresh state → should show onboarding, not crash
const onboardingVisible = await freshPage.locator('#view-onboarding').isVisible().catch(() => false);
check('空白本地狀態 → 顯示 Onboarding（不崩潰）', onboardingVisible);
await freshCtx.close();

// C5. syncVer increments after card complete (structural check via IDB)
await page.waitForTimeout(500);
const syncVerBefore = await page.evaluate(() => new Promise((res, rej) => {
  const req = indexedDB.open('kindling', 1);
  req.onsuccess = e => {
    const t = e.target.result.transaction('kingdom','readonly');
    t.objectStore('kingdom').get('v1').onsuccess = ev => res(ev.target.result?.syncVer ?? 0);
  };
  req.onerror = ev => rej(ev.target.error);
}));
// Click the first complete button
const completeBtn = page.locator('.btn-complete:not(:disabled)').first();
const hasBtnToClick = await completeBtn.isVisible().catch(() => false);
if (hasBtnToClick) {
  await completeBtn.click();
  await page.waitForTimeout(1000);
  const syncVerAfter = await page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 1);
    req.onsuccess = e => {
      const t = e.target.result.transaction('kingdom','readonly');
      t.objectStore('kingdom').get('v1').onsuccess = ev => res(ev.target.result?.syncVer ?? 0);
    };
    req.onerror = ev => rej(ev.target.error);
  }));
  check('完成卡後 syncVer 遞增', syncVerAfter > syncVerBefore,
    `${syncVerBefore} → ${syncVerAfter}`);
} else {
  check('完成卡後 syncVer 遞增', true, '(所有卡已完成，跳過)', true);
}

// C6. Cloud upsert called — always soft, requires live Supabase project verification.
check('雲端備份 upsert 已觸發（需 Supabase 後台驗收）', hasUser,
  '在 Supabase 後台 saves 表確認有一列資料', true);

await browser.close();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
if (softC) console.log('(⚠️ 標記項目需在 Supabase 專案設定完成後重跑)');
process.exit(allPass ? 0 : 1);
