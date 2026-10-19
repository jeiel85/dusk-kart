// Records a gameplay clip for social posting via lobby free roam (no start
// countdown, so the recording is all driving). Low quality preset keeps the
// software renderer fast enough for smooth frames.
import { chromium } from 'file:///D:/Users/jeiel/DevTools/npm-global/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs';
import { readdirSync, rmSync } from 'node:fs';

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: 'public', size: { width: 1280, height: 720 } } });
const g = await ctx.newPage();
await g.goto('http://127.0.0.1:5199/?quality=low', { waitUntil: 'networkidle' });
await g.waitForTimeout(4000);
await g.click('button[data-go="online"]');
await g.waitForTimeout(600);
await g.click('#btn-join');
await g.waitForTimeout(5000); // lobby ready
await g.click('#btn-freeroam');
await g.waitForTimeout(1200); // settle into the seat
await g.keyboard.down('w');
const pattern = [['a', 1300], ['d', 1600], ['a', 1400], ['d', 1500], ['a', 1200], ['d', 1600], ['a', 1400], ['d', 1500]];
for (const [key, ms] of pattern) {
  await g.keyboard.down(key);
  await g.waitForTimeout(ms);
  await g.keyboard.up(key);
  await g.waitForTimeout(250);
}
await g.keyboard.up('w');
await g.waitForTimeout(400);
await ctx.close();
await browser.close();

const webm = readdirSync('public').find((f) => f.endsWith('.webm'));
if (!webm) throw new Error('no recording');
console.log('raw:', webm);
