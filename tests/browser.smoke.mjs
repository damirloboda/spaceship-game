/**
 * Headless browser smoke test (§116 "Mobile Performance Test" / general
 * integration check). Not part of `npm test` (it needs a running dev server
 * and a browser binary neither of which every environment has) — run it
 * manually with `node tools/serve.js &` then `node tests/browser.smoke.mjs`.
 *
 * Boots the real game in Chromium and asserts the vertical slice actually
 * works: it renders pixels (not a black screen), the player can walk, board
 * the ship, and launch to orbit — with zero console/page errors throughout.
 */
import { chromium } from 'playwright-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const URL = process.env.GAME_URL || 'http://localhost:8080/';

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

const browser = await chromium.launch({ executablePath: CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(1500);

const boot = await page.evaluate(() => {
  const uc = window.__ULTRA_COSMOS__;
  return uc ? { ready: true, mode: uc.mode, planet: uc.planet.name, alive: uc.player.alive } : { ready: false };
});
if (!boot.ready) fail('game did not expose window.__ULTRA_COSMOS__ — boot failed');
else console.log('OK: booted on', boot.planet, '| mode', boot.mode, '| alive', boot.alive);

// The canvas must actually have drawn something, not be a black/blank frame.
const shot = await page.screenshot();
if (shot.length < 8000) fail(`screenshot suspiciously small (${shot.length} bytes) — likely a black frame`);
else console.log('OK: rendered frame is', shot.length, 'bytes');

// Walk and confirm position changes.
await page.mouse.click(640, 400);
const before = await page.evaluate(() => ({ ...window.__ULTRA_COSMOS__.player.pos }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(1500);
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => ({ ...window.__ULTRA_COSMOS__.player.pos }));
const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
if (moved < 1) fail(`player barely moved (${moved.toFixed(2)}m) — movement may be broken`);
else console.log('OK: player moved', moved.toFixed(1), 'm while holding W');

// Board the ship and launch.
await page.evaluate(() => {
  const uc = window.__ULTRA_COSMOS__;
  Object.assign(uc.player.pos, uc.ship.pos);
});
await page.keyboard.down('KeyE'); await page.waitForTimeout(200); await page.keyboard.up('KeyE');
const boarded = await page.evaluate(() => window.__ULTRA_COSMOS__.mode);
if (boarded !== 'ship_landed') fail(`expected ship_landed after boarding, got ${boarded}`);
else console.log('OK: boarded ship');

await page.keyboard.down('KeyW');
await page.waitForTimeout(20000);
await page.keyboard.up('KeyW');
const flying = await page.evaluate(() => window.__ULTRA_COSMOS__.mode);
if (flying !== 'ship_flight' && flying !== 'space') fail(`expected launch to leave ground, mode is ${flying}`);
else console.log('OK: launched, mode is', flying);

if (errors.length) {
  fail(`${errors.length} console/page error(s) during the run`);
  for (const e of errors.slice(0, 10)) console.error('  ', e);
} else {
  console.log('OK: zero console/page errors');
}

await browser.close();
if (process.exitCode) {
  console.error('\nBROWSER SMOKE TEST: FAILED');
} else {
  console.log('\nBROWSER SMOKE TEST: PASSED');
}
process.exit(process.exitCode || 0);
