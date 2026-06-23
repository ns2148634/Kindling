import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 900 } });

await page.goto('http://localhost:5173');
await page.waitForTimeout(1500);

// 1. Cards rendered
const roles = await page.locator('.card-role').allTextContents();
const texts = await page.locator('.card-text').allTextContents();
console.log('Roles:', roles.join(', '));
console.log('Texts:', texts);
await page.screenshot({ path: 'verify-m2-01-initial.png' });

// 2. Complete all 3 cards — re-query each time because renderCards() replaces DOM
for (let i = 0; i < 3; i++) {
  const btn = page.locator('.btn-complete:not(:disabled)').first();
  const visible = await btn.isVisible().catch(() => false);
  if (!visible) { console.log(`Card ${i}: no enabled button found`); break; }
  await btn.click();
  await page.waitForTimeout(600);
}
const codexCount = await page.locator('#codex-count').textContent();
const completedCount = await page.locator('.card.completed').count();
console.log(`After 3 completions — codex: ${codexCount}, completed cards: ${completedCount}/3`);
await page.screenshot({ path: 'verify-m2-02-all-done.png' });

// 3. Codex view
await page.click('#nav-codex');
await page.waitForTimeout(300);
const entries = await page.locator('.codex-entry').count();
const headerText = await page.locator('#codex-header').textContent();
console.log('Codex entries:', entries, '|', headerText.trim());
await page.screenshot({ path: 'verify-m2-03-codex.png' });

// 4. Swap: reload fresh page (no cards completed) — but swap was already done above
//    Just check reload preserves state
await page.reload();
await page.waitForTimeout(1500);
const afterReloadCompleted = await page.locator('.card.completed').count();
const afterReloadCodex = await page.locator('#codex-count').textContent();
console.log(`After reload — completed: ${afterReloadCompleted}/3, codex: ${afterReloadCodex}`);
await page.screenshot({ path: 'verify-m2-04-reload.png' });

// 5. IDB check
const idbState = await page.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('kindling', 1);
    r.onsuccess = e => res(e.target.result);
    r.onerror = e => rej(e);
  });
  const get = (store, key) => new Promise((res, rej) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const today = new Date().toISOString().slice(0, 10);
  const [kingdom, daily, codex] = await Promise.all([
    get('kingdom', 'v1'), get('daily', today), get('codex', 'v1'),
  ]);
  return {
    landLength: kingdom?.land?.length,
    counts: kingdom?.counts,
    allCompleted: daily ? Object.values(daily.completed).every(Boolean) : false,
    codexEntries: codex?.entries?.length ?? 0,
  };
});
console.log('IDB:', JSON.stringify(idbState));

// 6. Test swap on a fresh browser context (no prior completions)
const ctx2 = await browser.newContext();
const page2 = await ctx2.newPage({ viewport: { width: 480, height: 900 } });
await page2.goto('http://localhost:5173');
await page2.waitForTimeout(1500);
const surpriseTextBefore = await page2.locator('.card').nth(2).locator('.card-text').textContent();
const swapBtn = page2.locator('.btn-swap');
if (await swapBtn.isEnabled()) {
  await swapBtn.click();
  await page2.waitForTimeout(400);
  const surpriseTextAfter = await page2.locator('.card').nth(2).locator('.card-text').textContent();
  console.log(`Swap: "${surpriseTextBefore}" → "${surpriseTextAfter}"`);
  const swapDisabledNow = await swapBtn.isDisabled();
  console.log('Swap button disabled after use:', swapDisabledNow);
} else {
  console.log('Swap btn was disabled (already used or completed)');
}
await page2.screenshot({ path: 'verify-m2-05-swap.png' });
await ctx2.close();

await browser.close();
console.log('DONE');
