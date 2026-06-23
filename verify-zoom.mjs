import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
// Use a larger viewport so canvas renders bigger
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });

// Override canvas CSS size to 800px for this verification
await page.goto('http://localhost:5173');
await page.addStyleTag({ content: '#canvas-wrap { width: 800px !important; height: 800px !important; } canvas { width: 800px !important; height: 800px !important; }' });
await page.waitForTimeout(500);

// Add one of each element
for (const attr of ['courage', 'warmth', 'curiosity', 'focus', 'vitality', 'vitality', 'vitality']) {
  await page.click(`.btn-${attr}`);
  await page.waitForTimeout(200);
}
// Add more land first so placement has room
for (let i = 0; i < 5; i++) { await page.click('.btn-courage'); await page.waitForTimeout(100); }

await page.waitForTimeout(600);
await page.screenshot({ path: 'verify-zoom.png', clip: { x: 0, y: 0, width: 850, height: 500 } });

// Pixel color checks for each element type
const checks = await page.evaluate(() => {
  const canvas = document.getElementById('kingdom');
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, 400, 400).data;

  function countColor(r, g, b, tolerance = 30) {
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i]-r) < tolerance && Math.abs(data[i+1]-g) < tolerance && Math.abs(data[i+2]-b) < tolerance) count++;
    }
    return count;
  }

  return {
    // land green top #34715f => (52,113,95)
    landGreen:  countColor(52, 113, 95, 25),
    // warmth house window: #FF8A6B => (255,138,107)
    warmthOrange: countColor(255, 138, 107, 40),
    // curiosity tree glow: #5ecf6b => (94,207,107)
    curiousGreen: countColor(94, 207, 107, 40),
    // focus tower body: #3b4670 => (59,70,112)
    focusBlue: countColor(59, 70, 112, 25),
    // citizen head: #ffe0a0 => (255,224,160)
    citizenHead: countColor(255, 224, 160, 40),
    // star pixels: #cdd9ff => (205,217,255)
    starPixels: countColor(205, 217, 255, 40),
  };
});

console.log('Color checks:', JSON.stringify(checks, null, 2));
await browser.close();
