// Ad-hoc debug scenes: node tests/e2e/debug.mjs "<js to run>" name [wait]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = resolve('.');
const OUT = resolve('tests/e2e/out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = await new Promise((ok) => { const s = createServer(async (req, res) => { try { const url = decodeURIComponent(req.url.split('?')[0]); const f = join(ROOT, url === '/' ? 'index.html' : url); const d = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(d); } catch { res.writeHead(404); res.end(); } }); s.listen(0, () => ok(s)); });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const vp = process.env.PORTRAIT ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : process.env.MOBILE ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } };
const page = await browser.newPage(vp);
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async (route) => { const rel = route.request().url().split('three@0.170.0/')[1]; try { route.fulfill({ body: await readFile(join(ROOT, 'node_modules/three', rel)), contentType: 'text/javascript' }); } catch { route.abort(); } });
if (!process.env.FONTS) {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
  await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
}
// MODELS_BUNDLE=<dir>: simulate a host that refuses .glb and serves the
// base64 bundles from tools/pack-models-bundle.mjs instead.
if (process.env.MODELS_BUNDLE) {
  await page.route(/\.glb$/, (r) => r.fulfill({ status: 404, body: '' }));
  await page.route(/\/assets\/models\/models[-0-9]*\.json$/, async (r) => { const n = r.request().url().split('/').pop(); try { r.fulfill({ body: await readFile(join(process.env.MODELS_BUNDLE, n)), contentType: 'application/json' }); } catch { r.fulfill({ status: 404, body: '' }); } });
}
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('DBG')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${srv.address().port}/?dev=1`);
await page.waitForFunction(() => window.__game && document.querySelector('.title-screen'));
await page.evaluate(() => { window.__game.menus.closeAll(); window.__game.newGame({ name: 'Test' }); window.__game.hud.bannerQueue.length = 0; });
await page.waitForTimeout(1500);
await page.addScriptTag({ path: resolve('tests/e2e/scenes.js') });
const scenes = process.argv.slice(2);
for (let i = 0; i < scenes.length; i += 3) {
  const code = scenes[i], name = scenes[i + 1], wait = Number(scenes[i + 2] || 2000);
  const r = await page.evaluate(code);
  if (r !== undefined) console.log(name, JSON.stringify(r));
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/dbg-${name}.png`, timeout: 120000 });
}
console.log('errors:', [...new Set(errors)].slice(0, 10).join('\n'));
await browser.close();
srv.close();
