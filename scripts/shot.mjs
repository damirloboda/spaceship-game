// Скриншоты игры в headless Chromium (проверка рендера и отсутствия ошибок).
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const url = process.argv[2] || 'http://localhost:4173/?seed=7&mode=sandbox';
const out = process.argv[3] || '/tmp/claude-0/shots';
const steps = JSON.parse(process.argv[4] || '[]');
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(2500);
let i = 0;
for (const s of steps) {
  if (s.eval) await page.evaluate(s.eval);
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) { await page.screenshot({ path: `${out}/${s.shot}.png` }); i++; }
}
if (!steps.length) await page.screenshot({ path: `${out}/default.png` });
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
