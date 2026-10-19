// Builds public/og.png (1200x630) for link previews: the dusk helmet-cam hero
// shot behind the wordmark and one-line pitch. The hero is embedded as base64
// (file:// subresources are blocked from a synthetic page).
import { chromium } from 'file:///D:/Users/jeiel/DevTools/npm-global/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';

const hero = readFileSync('docs/screenshots/hero.jpg').toString('base64');

const html = `<!doctype html><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; }
  .card { position: relative; width: 1200px; height: 630px; background: #0b1120; }
  .shot { position: absolute; right: 0; top: 0; width: 660px; height: 630px; object-fit: cover; }
  .shade { position: absolute; inset: 0; background: linear-gradient(100deg, #0b1120 30%, rgba(11,17,32,0.55) 62%, rgba(11,17,32,0.15) 100%); }
  .glow { position: absolute; left: -140px; top: -180px; width: 560px; height: 560px; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,138,61,0.20), rgba(255,138,61,0) 65%); }
  .text { position: absolute; left: 72px; top: 156px; width: 620px; }
  h1 { font-size: 98px; font-style: italic; font-weight: 900; letter-spacing: -0.02em; line-height: 0.95; color: #f4f6fb; }
  h1 em { font-style: italic; color: #ff7a1a; }
  .tag { margin-top: 22px; font-size: 28px; font-weight: 700; color: #c3cee2; }
  .facts { margin-top: 38px; display: flex; gap: 10px; }
  .facts span { font-size: 19px; font-weight: 700; color: #e6ecf7; background: rgba(255,255,255,0.10);
                border: 1px solid rgba(255,255,255,0.18); border-radius: 999px; padding: 8px 18px; }
  .url { position: absolute; left: 72px; bottom: 54px; font-size: 23px; font-weight: 700; color: #ffb347; }
  .bar { position: absolute; left: 0; bottom: 0; width: 1200px; height: 8px; background: linear-gradient(90deg, #ff7a1a, #37c6ff 60%, #9b5cff); }
</style>
<div class="card">
  <img class="shot" src="data:image/jpeg;base64,${hero}">
  <div class="shade"></div>
  <div class="glow"></div>
  <div class="text">
    <h1><em>DUSK</em> KART</h1>
    <div class="tag">액션캠 시점 카트 레이싱 · Lumen Park</div>
    <div class="facts"><span>링크만 열면</span><span>설치 없음</span><span>코스 8</span><span>날씨 5</span><span>P2P 대전</span></div>
  </div>
  <div class="url">jeiel85.github.io/dusk-kart</div>
  <div class="bar"></div>
</div>`;

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: 'public/og.png' });
console.log('og.png saved');
await browser.close();
