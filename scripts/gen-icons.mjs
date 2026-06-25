/**
 * Generate PWA icons (192px + 512px PNG) using Playwright canvas.
 * Run once: node scripts/gen-icons.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page    = await browser.newPage();

for (const sz of [192, 512]) {
  await page.setViewportSize({ width: sz, height: sz });
  await page.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;overflow:hidden;background:#000">
    <canvas id="c" width="${sz}" height="${sz}"></canvas></body></html>`);

  const b64 = await page.evaluate((s) => {
    const c   = document.getElementById('c');
    const ctx = c.getContext('2d');
    const f   = s / 192; // scale factor

    // ── Background ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, s, s);

    // ── Stars ──────────────────────────────────────────────────────────────
    const stars = [[0.15,0.12],[0.72,0.08],[0.42,0.22],[0.88,0.28],
                   [0.08,0.38],[0.58,0.18],[0.92,0.65],[0.28,0.78],[0.5,0.05]];
    ctx.fillStyle = '#cdd9ff';
    for (const [x,y] of stars) {
      ctx.beginPath();
      ctx.arc(x*s, y*s, Math.max(1, 2*f), 0, Math.PI*2);
      ctx.fill();
    }

    // ── Island glow ────────────────────────────────────────────────────────
    const grd = ctx.createRadialGradient(s*0.5,s*0.65,0, s*0.5,s*0.65,s*0.35);
    grd.addColorStop(0,  'rgba(52,113,95,0.30)');
    grd.addColorStop(1,  'rgba(52,113,95,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, s, s);

    // ── Land tiles ─────────────────────────────────────────────────────────
    const ts = 22*f;            // tile size
    const ox = s*0.5, oy = s*0.68;
    const tiles = [[-1,0],[0,0],[1,0],[-0.5,1],[0.5,1]];
    for (const [tc,tr] of tiles) {
      const tx = ox + tc*ts - ts/2;
      const ty = oy + tr*ts*0.6 - ts/2;
      // Top face
      ctx.fillStyle = '#34715f';
      ctx.fillRect(tx, ty, ts, ts*0.55);
      // Highlight line
      ctx.fillStyle = '#498c76';
      ctx.fillRect(tx, ty, ts, 2*f);
      // Soil side
      ctx.fillStyle = '#3a2c22';
      ctx.fillRect(tx, ty+ts*0.55, ts, ts*0.25);
    }

    // ── Tower (focus / 專注) ───────────────────────────────────────────────
    const tw  = 14*f, th = 52*f;
    const tpx = s*0.44, tpy = oy - ts*0.3 - th;

    ctx.fillStyle = '#3b4670';
    ctx.fillRect(tpx - tw/2, tpy, tw, th);

    // Glowing windows
    ctx.shadowBlur  = 8*f;
    ctx.shadowColor = '#6E9BFF';
    ctx.fillStyle   = '#8fb0ff';
    for (let i = 1; i <= 3; i++) {
      ctx.fillRect(tpx - 3*f, tpy + th*0.15*i, 6*f, 5*f);
    }
    ctx.shadowBlur = 0;

    // Tower top glow
    ctx.shadowBlur  = 14*f;
    ctx.shadowColor = '#6E9BFF';
    ctx.fillStyle   = '#6E9BFF';
    ctx.beginPath();
    ctx.arc(tpx, tpy, 6*f, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Battlements
    ctx.fillStyle = '#3b4670';
    for (let i = -1; i <= 1; i++) {
      ctx.fillRect(tpx + i*6*f - 2*f, tpy - 6*f, 5*f, 7*f);
    }

    // ── Warm house (溫暖) ──────────────────────────────────────────────────
    const hx = s*0.58, hy = oy - ts*0.25;
    const hw = 18*f,   hh = 14*f;

    // Roof (warm orange)
    ctx.shadowBlur  = 6*f;
    ctx.shadowColor = '#FF8A6B';
    ctx.fillStyle   = '#FF8A6B';
    ctx.beginPath();
    ctx.moveTo(hx - hw*0.15, hy);
    ctx.lineTo(hx + hw/2,    hy - hh*0.65);
    ctx.lineTo(hx + hw*1.15, hy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Walls
    ctx.fillStyle = '#1e2540';
    ctx.fillRect(hx, hy, hw, hh);

    // Glowing window
    ctx.shadowBlur  = 5*f;
    ctx.shadowColor = '#FF8A6B';
    ctx.fillStyle   = '#ff9f80';
    ctx.fillRect(hx + hw*0.25, hy + hh*0.2, hw*0.4, hh*0.4);
    ctx.shadowBlur = 0;

    // ── Glowing tree (好奇) ────────────────────────────────────────────────
    const vx = s*0.32, vy = oy - ts*0.2;
    ctx.shadowBlur  = 8*f;
    ctx.shadowColor = '#B08CFF';
    ctx.fillStyle   = '#B08CFF';
    ctx.beginPath();
    ctx.arc(vx, vy - 10*f, 11*f, 0, Math.PI*2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(vx - 2*f, vy, 4*f, 8*f);

    return c.toDataURL('image/png').split(',')[1];
  }, sz);

  writeFileSync(join(outDir, `icon-${sz}.png`), Buffer.from(b64, 'base64'));
  console.log(`✓ icon-${sz}.png`);
}

await browser.close();
console.log('Icons done →', outDir);
