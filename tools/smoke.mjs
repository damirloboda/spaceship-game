import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://localhost:8080/';
const shot = process.argv[3] || null;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('[console.error] ' + msg.text());
});
page.on('pageerror', (err) => errors.push('[pageerror] ' + err.message));
page.on('requestfailed', (req) => errors.push('[requestfailed] ' + req.url() + ' ' + (req.failure()?.errorText || '')));

await page.goto(url, { waitUntil: 'load', timeout: 20000 });
await page.waitForTimeout(3000);

const state = await page.evaluate(() => {
  const uc = window.__ULTRA_COSMOS__;
  if (!uc) return { ready: false };
  return {
    ready: true,
    mode: uc.mode,
    planet: uc.planet && uc.planet.name,
    playerAlive: uc.player.alive,
    playerHealth: uc.player.health,
    onGround: uc.player.onGround,
    hasCanvas: !!document.querySelector('canvas'),
    bootHidden: document.getElementById('boot-screen').classList.contains('hidden'),
  };
});

console.log('STATE:', JSON.stringify(state, null, 2));
console.log('ERRORS:', errors.length);
for (const e of errors.slice(0, 30)) console.log(' ', e);

if (shot) {
  await page.screenshot({ path: shot });
  console.log('screenshot saved:', shot);
}

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
