// End-to-end smoke test in headless Chromium: boots the game, starts a new
// game and walks through the vertical slice, taking screenshots.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright')); }
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve('.');
const OUT = resolve('tests/e2e/out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  return new Promise((ok) => {
    const srv = createServer(async (req, res) => {
      try {
        const url = decodeURIComponent(req.url.split('?')[0]);
        const file = join(ROOT, url === '/' ? 'index.html' : url);
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, () => ok(srv));
  });
}

const steps = process.argv.slice(2);
const srv = await serve();
const port = srv.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const mobile = steps.includes('mobile');
const page = await browser.newPage(mobile ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 720 } });
// Serve the CDN copy of three.js from node_modules so the test runs offline.
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async (route) => {
  const rel = route.request().url().split('three@0.170.0/')[1];
  try { route.fulfill({ body: await readFile(join(ROOT, 'node_modules/three', rel)), contentType: 'text/javascript' }); } catch { route.abort(); }
});
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', contentType: 'text/css' }));
await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
try {
await page.goto(`http://localhost:${port}/?dev=1`);
await page.waitForFunction(() => window.__game && document.querySelector('.title-screen'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-title.png` });
await page.click('text=New game');
await page.waitForSelector('.panel');
await page.screenshot({ path: `${OUT}/02-creator.png` });
await page.click('text=Begin expedition');
const t0 = Date.now();
await page.waitForFunction(() => window.__game.state && window.__game.mode === 'foot', null, { timeout: 120000 });
console.log('game started in', Date.now() - t0, 'ms');
await page.waitForTimeout(4000);
await page.screenshot({ path: `${OUT}/03-surface.png` });
const info = await page.evaluate(() => {
  const g = window.__game;
  const b = g.player.body;
  return {
    mode: g.mode, fps: g.fps, body: b.def.name, alt: b.altitude(g.player.pos), grounded: g.player.grounded,
    terrain: b.terrain.stats, visible: b.terrain.visibleCount(), scatter: b.scatter.stats(), creatures: b.fauna.creatures.length,
    calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, hour: g.localHour,
  };
});
console.log(JSON.stringify(info));
const shot = async (name, fn, wait = 2500) => {
  await page.evaluate(fn);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const st = await page.evaluate(() => ({ mode: window.__game.mode, fps: Math.round(window.__game.fps), speed: Math.round(window.__game.ship.speed), alt: Math.round(window.__game.ship.altitude), lb: window.__game.ship.lb.phase, sys: window.__game.universe.system.name }));
  console.log(name, JSON.stringify(st));
};
if (!steps.includes('quick')) {
  await shot('04-third-person', () => { window.__game.toggleView(); });
  await shot('05-city', () => { const g = window.__game; g.toggleView(); const b = g.homeBody(); const c = b.city; g.player.placeOnBody(b, c.toLocal(0, 60, 0), new window.__game.player.forward.constructor(...c.frame.north).negate()); g.setMode('foot'); g.warmup(); });
  await shot('06-interior', () => { const g = window.__game; g.enterShipFromOutside(); g.player.forward.set(0, 0, -1); });
  await shot('07-techbay', () => { const g = window.__game; g.state.addItem('nitro'); g.player.pos.set(-2.4, 0, 4); g.player.forward.set(-1, 0, 0); });
  await shot('08-techbay-menu', () => { const g = window.__game; g.ship.model.nitro.open = true; g.menus.open('techbay'); }, 800);
  await page.click('text=Install Nitro');
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/09-nitro-installed.png` });
  await shot('10-cockpit', () => { const g = window.__game; g.menus.closeAll(); g.sitInPilotSeat(); });
  await shot('11-takeoff', () => { const g = window.__game; g.ship.takeoff(); g.ship.throttle = 0.6; g.ship.root.quaternion.multiply(new (g.ship.root.quaternion.constructor)().setFromAxisAngle(new (g.player.forward.constructor)(1, 0, 0), 0.5)); }, 5000);
  await shot('12-orbit', () => { const g = window.__game; const b = g.homeBody(); const up = b.ship ? null : g.ship.root.position.clone().normalize(); g.ship.root.position.copy(up.multiplyScalar(b.atmoTop + 9000)); g.ship.vel.set(0, 0, 0); g.ship.throttle = 0; g.cameraMode = 'third'; g.updateCameraParent(); }, 3000);
  await shot('13-overdrive', () => { const g = window.__game; const s = g.state.ship; s.lightbreak.state = 'ready'; s.lightbreak.charge = 100; g.ship.throttle = 1; g.ship.overdrive = true; }, 1500);
  await shot('14-lightbreak', () => { const g = window.__game; const near = g.menus.mapData().list[0]; g.director.setInterstellarTarget(near); g.tryLightbreak(); }, 3500);
  await shot('15-arrival', () => {}, 6000);
  await shot('16-new-world', () => { const g = window.__game; g.cameraMode = 'first'; g.updateCameraParent(); }, 3000);
}
console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 30).join('\n'));
} catch (e) {
  console.log('FAILED:', e.message);
  console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
  try { await page.screenshot({ path: `${OUT}/fail.png` }); } catch { /* ignore */ }
  process.exitCode = 1;
}
await browser.close();
srv.close();
