/**
 * verify-m3.mjs
 * 驗收 M3：Onboarding 流程 + 方向選擇 + 接線抽卡
 * 每個測試用獨立 browserContext（隔離 IndexedDB），不需手動清除。
 * 需要 dev server 跑在 localhost:5173
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
let allPass = true;

function check(label, pass, detail = '') {
  const mark = pass ? '✅' : '❌';
  console.log(`${mark} ${label}${detail ? '  (' + detail + ')' : ''}`);
  if (!pass) allPass = false;
}

async function getKingdom(page) {
  return page.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open('kindling', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      const r  = db.transaction('kingdom','readonly').objectStore('kingdom').get('v1');
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    };
    req.onerror = () => rej(req.error);
  }));
}

async function getDaily(page) {
  return page.evaluate(() => new Promise((res, rej) => {
    const today = new Date().toISOString().slice(0, 10);
    const req = indexedDB.open('kindling', 1);
    req.onsuccess = e => {
      const db = e.target.result;
      const r  = db.transaction('daily','readonly').objectStore('daily').get(today);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    };
    req.onerror = () => rej(req.error);
  }));
}

// ── A：首次開啟 → onboarding ───────────────────────────────────────────────────
console.log('\n── A：首次開啟 ──────────────────────────────────────────');
{
  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'verify-m3-A1-onboarding.png' });

  check('Onboarding 畫面可見',          await page.locator('#view-onboarding').isVisible());
  check('首頁隱藏（尚未完成 onboarding）', !(await page.locator('#view-home').isVisible()));
  check('Step 1（打招呼）可見',           await page.locator('#ob-step1').isVisible());
  check('底部 nav 隱藏',                 !(await page.locator('#bottom-nav').isVisible()));

  // 按繼續 → step 2
  await page.click('#btn-ob-continue');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verify-m3-A2-step2.png' });
  const dirBtns = await page.locator('.btn-direction').count();
  check('按繼續後 Step 2 可見', await page.locator('#ob-step2').isVisible());
  check('方向選項有 5 個',      dirBtns === 5, `找到 ${dirBtns} 個`);

  // 選 focus（第 2 個，index 1）
  await page.locator('.btn-direction').nth(1).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'verify-m3-A3-home.png' });

  check('選方向後進入首頁',    await page.locator('#view-home').isVisible());
  check('Onboarding 消失',   !(await page.locator('#view-onboarding').isVisible()));
  check('底部 nav 恢復顯示',   await page.locator('#bottom-nav').isVisible());

  // IDB
  const kingdom = await getKingdom(page);
  check('onboarded = true 儲存', kingdom?.onboarded === true);
  check('direction = focus 儲存', kingdom?.direction === 'focus', `got: ${kingdom?.direction}`);
  check('第一格土地存在', (kingdom?.land?.length ?? 0) >= 1, `land.length=${kingdom?.land?.length}`);

  const daily = await getDaily(page);
  check('今日 daily 已抽出',       !!daily);
  check('主線卡屬性 = focus（或 off-dir）', daily?.cards?.main?.attribute === 'focus',
    `got: ${daily?.cards?.main?.attribute}`);

  await ctx.close();
}

// ── B：回訪略過 onboarding ─────────────────────────────────────────────────────
console.log('\n── B：回訪不再出現 onboarding ───────────────────────────');
{
  const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(1000);

  // 完成 onboarding — 選 warmth（index 3）
  await page.click('#btn-ob-continue');
  await page.waitForTimeout(200);
  await page.locator('.btn-direction').nth(3).click();
  await page.waitForTimeout(600);

  // 重新整理
  await page.reload();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'verify-m3-B1-reload.png' });

  check('重載後直接進首頁',            await page.locator('#view-home').isVisible());
  check('重載後 onboarding 不再出現',  !(await page.locator('#view-onboarding').isVisible()));

  const kingdom = await getKingdom(page);
  check('direction = warmth 持久化',  kingdom?.direction === 'warmth', `got: ${kingdom?.direction}`);
  check('onboarded = true 持久化',    kingdom?.onboarded === true);
  check('土地持久化',                  (kingdom?.land?.length ?? 0) >= 1);

  await ctx.close();
}

// ── C：不同方向 → 主線卡屬性不同 ──────────────────────────────────────────────
console.log('\n── C：不同方向影響主線卡 ────────────────────────────────');
{
  async function pickDir(index) {
    const ctx  = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(1000);
    await page.click('#btn-ob-continue');
    await page.waitForTimeout(200);
    await page.locator('.btn-direction').nth(index).click();
    await page.waitForTimeout(600);
    const kingdom = await getKingdom(page);
    const daily   = await getDaily(page);
    await ctx.close();
    return { kingdom, daily };
  }

  const { kingdom: kV, daily: dV } = await pickDir(0); // vitality
  const { kingdom: kC, daily: dC } = await pickDir(4); // curiosity

  check('vitality 方向儲存', kV?.direction === 'vitality', `got: ${kV?.direction}`);
  check('curiosity 方向儲存', kC?.direction === 'curiosity', `got: ${kC?.direction}`);
  check(
    '兩方向主線卡屬性符合各自方向（或 off-dir）',
    dV?.cards?.main?.attribute !== dC?.cards?.main?.attribute ||
    dV?.cards?.main?.attribute !== 'courage',
    `vitality→${dV?.cards?.main?.attribute}, curiosity→${dC?.cards?.main?.attribute}`
  );
}

// ── 結果 ──────────────────────────────────────────────────────────────────────
await browser.close();
console.log('\n' + (allPass ? '✅ 全部通過' : '❌ 有項目未通過'));
process.exit(allPass ? 0 : 1);
