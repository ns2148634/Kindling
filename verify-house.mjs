import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });

await page.goto('http://localhost:5173');
await page.addStyleTag({ content: '#canvas-wrap { width: 800px !important; height: 800px !important; } canvas { width: 800px !important; height: 800px !important; }' });
await page.waitForTimeout(500);

// Only add warmth (house) - no trees to interfere
for (let i = 0; i < 4; i++) { await page.click('.btn-warmth'); await page.waitForTimeout(200); }
await page.waitForTimeout(400);
await page.screenshot({ path: 'verify-house.png', clip: { x: 0, y: 0, width: 1000, height: 600 } });

const warmthOrange = await page.evaluate(() => {
  const canvas = document.getElementById('kingdom');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, 400, 400).data;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    // #FF8A6B = (255, 138, 107)
    if (data[i] > 200 && data[i+1] > 100 && data[i+1] < 180 && data[i+2] > 70 && data[i+2] < 160) count++;
  }
  return count;
});
console.log('Warmth orange pixels:', warmthOrange);
await browser.close();
