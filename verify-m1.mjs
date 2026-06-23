import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 700 } });

await page.goto('http://localhost:5173');
await page.waitForTimeout(1500); // let rAF run

// Screenshot 1: initial state
await page.screenshot({ path: 'verify-01-initial.png' });

// Click each button in sequence with a short pause
for (const attr of ['courage', 'vitality', 'focus', 'warmth', 'curiosity']) {
  await page.click(`.btn-${attr}`);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: 'verify-02-after-one-each.png' });

// Click courage 6 more times to grow land
for (let i = 0; i < 6; i++) {
  await page.click('.btn-courage');
  await page.waitForTimeout(150);
}
await page.screenshot({ path: 'verify-03-more-land.png' });

// Add 3 more citizens
for (let i = 0; i < 3; i++) {
  await page.click('.btn-vitality');
  await page.waitForTimeout(300);
}
await page.waitForTimeout(800); // let citizens walk
await page.screenshot({ path: 'verify-04-citizens-walking.png' });

// Read stats text
const stats = await page.textContent('#stats');
console.log('Stats:', stats);

// Check canvas is present and non-trivial
const canvasData = await page.evaluate(() => {
  const canvas = document.getElementById('kingdom');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, 400, 400).data;
  let nonBlack = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 20 || data[i+1] > 20 || data[i+2] > 20) nonBlack++;
  }
  return { width: canvas.width, height: canvas.height, nonBlackPixels: nonBlack };
});
console.log('Canvas:', JSON.stringify(canvasData));

await browser.close();
console.log('DONE');
