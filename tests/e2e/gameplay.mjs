// Gameplay test with real keyboard input: walk, scan, mine, buy a jetpack,
// fly it, buy and install Nitro, take off, save and reload.
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
const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
await context.addInitScript(() => { try { localStorage.setItem('ultracosmos.settings', JSON.stringify({ preset: 'LOW', platform: 'pc', language: 'en' })); } catch {} });
const page = await context.newPage();
await page.route('https://cdn.jsdelivr.net/npm/three@0.170.0/**', async (route) => { const rel = route.request().url().split('three@0.170.0/')[1]; try { route.fulfill({ body: await readFile(join(ROOT, 'node_modules/three', rel)), contentType: 'text/javascript' }); } catch { route.abort(); } });
await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
await page.route('https://fonts.gstatic.com/**', (r) => r.abort());
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${detail}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);
// Hold a key while the simulation advances deterministically (software
// rendering in CI is too slow to rely on real-time frames).
const hold = async (key, ms) => { await page.keyboard.down(key); await ev((s) => window.__game.simulate(s), ms / 1000); await page.keyboard.up(key); };
const tap = async (key) => { await page.keyboard.press(key); await ev(() => window.__game.simulate(0.1)); };
const url = `http://localhost:${srv.address().port}/?dev=1`;
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__game && document.querySelector('.title-screen'));
  await page.waitForTimeout(800);
  await page.click('text=New game');
  await page.click('text=Begin expedition');
  await page.waitForFunction(() => window.__game.mode === 'foot');
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 360);
  // 1. Walk
  const d0 = await ev(() => window.__game.player.pos.toArray());
  await page.keyboard.down('KeyW');
  await ev(() => window.__game.simulate(1.5));
  const mid = await ev(() => ({ speed: window.__game.player.speed, paused: window.__game.paused, mode: window.__game.mode }));
  await ev(() => window.__game.simulate(2));
  await page.keyboard.up('KeyW');
  const d1 = await ev(() => window.__game.player.pos.toArray());
  const moved = Math.hypot(d1[0] - d0[0], d1[1] - d0[1], d1[2] - d0[2]);
  check('walk forward with W', moved > 5, `${moved.toFixed(1)} m ${JSON.stringify(mid)}`);
  // 2. Scan
  await tap('KeyF');
  const sc = await ev(() => ({ scans: window.__game.state.stats.scans, species: Object.keys(window.__game.state.discoveries.species).length }));
  check('scanner (F)', sc.scans === 1, JSON.stringify(sc));
  // 3. Mine: stand next to a deposit and look at it
  const placed = await ev(() => {
    const g = window.__game; const b = g.player.body; const deps = b.scatter.activeDeposits;
    let best = null, bd = Infinity;
    for (const d of deps) { const dd = d.pos.distanceTo(g.player.pos); if (dd < bd) { bd = dd; best = d; } }
    if (!best) return null;
    const up = best.pos.clone().normalize();
    const side = new best.pos.constructor(1, 0, 0).cross(up).normalize();
    const stand = best.pos.clone().addScaledVector(side, 3);
    g.player.placeOnBody(b, stand, best.pos.clone().sub(stand));
    g.player.pitch = -0.45;
    return best.type;
  });
  await ev(() => window.__game.simulate(0.1));
  await hold('KeyR', 3200);
  const mined = await ev(() => window.__game.state.stats.mined);
  check('mine a deposit (hold R)', mined >= 1, `type=${placed} mined=${mined}`);
  // 4. Buy a Jetpack at the workshop
  await ev(() => { const g = window.__game; g.state.credits = 5000; const b = g.player.body; const w = b.city.buildings.find((x) => x.kind === 'workshop'); g.player.placeOnBody(b, b.city.toLocal(w.door.x, w.door.z, 0), null); });
  await ev(() => window.__game.simulate(0.1));
  const prompt = await ev(() => window.__game.interaction?.key);
  check('workshop prompt', prompt === 'prompt.shop_equipment', prompt);
  await tap('KeyE');
  await page.waitForSelector('.panel');
  await page.locator('.shoprow', { hasText: 'Jetpack' }).first().locator('button').click();
  await page.locator('.shoprow', { hasText: 'Nitro module' }).first().locator('button').click();
  const inv = await ev(() => ({ jet: window.__game.state.jetpack.owned, nitro: window.__game.state.count('nitro') }));
  check('buy Jetpack + Nitro', inv.jet && inv.nitro === 1, JSON.stringify(inv));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // 5. Fly the jetpack
  const alt0 = await ev(() => window.__game.player.body.altitude(window.__game.player.pos));
  await page.keyboard.down('Space');
  await ev(() => window.__game.simulate(2.2));
  const altUp = await ev(() => ({ alt: window.__game.player.body.altitude(window.__game.player.pos), fuel: window.__game.state.jetpack.fuel, active: window.__game.player.jetActive }));
  await page.keyboard.up('Space');
  check('jetpack lifts the player', altUp.alt - alt0 > 3, JSON.stringify(altUp));
  await page.screenshot({ path: `${OUT}/gp-jetpack.png` });
  await ev(() => window.__game.simulate(6));
  // Hand-made animated models are in use (ship hull, player, creatures).
  const models = await ev(() => { const g = window.__game; const f = g.player.body.fauna; const c = f.spawnAt(g.player.pos.clone().addScaledVector(g.player.forward, 12)); return { shell: !!g.ship.model.shell, player: !!g.player.anim, creature: !!c?.anim, trees: g.player.body.scatter.species.filter((s) => s.model).length }; });
  check('animated models loaded', models.shell && models.player && models.creature && models.trees > 5, JSON.stringify(models));
  // Points of interest: the nearest site to the landing area is ruins; walk
  // up, get the discovery, use the altar, receive a relic. Then walk back.
  const poi = await ev(() => {
    const g = window.__game, p = g.player, b = p.body;
    const back = { pos: p.pos.clone(), fwd: p.forward.clone() };
    const site = b.pois[0];
    const c = g.pois.place(b, site);
    const up = c.clone().normalize();
    const side = new up.constructor(0, 1, 0).cross(up).normalize();
    const at = c.clone().addScaledVector(side, 30).normalize();
    p.placeOnBody(b, at.clone().multiplyScalar(b.radius + b.surface.heightAt(at.x, at.y, at.z) + 0.1), c.clone().sub(at).normalize());
    g.simulate(1, 1 / 30);
    const found = g.pois.isFound(site);
    const loot = site.obj.lootLocal[0];
    p.pos.copy(loot.local);
    const it = g.pois.interaction(b, p.pos);
    const before = g.state.count('relic');
    it?.action();
    g.menus.closeAll();
    const r = { kind: site.kind, found, key: it?.key, relic: g.state.count('relic') - before, markers: g.pois.markers().length, pois: b.pois.length };
    p.placeOnBody(b, back.pos, back.fwd);
    g.simulate(0.5, 1 / 30);
    return r;
  });
  check('points of interest: discover ruins, loot the altar', poi.found && poi.key === 'poi.act.altar' && poi.relic === 1 && poi.pois >= 20, JSON.stringify(poi));
  // 6. Board the ship from beside the cockpit (not only at the ramp)
  await ev(() => { const g = window.__game; const s = g.ship; const side = s.body.spin.worldToLocal(s.root.localToWorld(new s.root.position.constructor(-7, -2.6, -6))); g.player.placeOnBody(s.body, side, null); });
  await ev(() => window.__game.simulate(0.1));
  const pSide = await ev(() => window.__game.interaction?.key);
  check('board prompt beside the hull', pSide === 'prompt.enter_ship', pSide);
  // Board the ship and install Nitro in the engine compartment
  await ev(() => { const g = window.__game; const s = g.ship; const ramp = s.body.spin.worldToLocal(s.root.localToWorld(new s.root.position.constructor(0, -2.6, 16))); g.player.placeOnBody(s.body, ramp, null); });
  await ev(() => window.__game.simulate(0.1));
  const p2 = await ev(() => window.__game.interaction?.key);
  check('ship ramp prompt', p2 === 'prompt.enter_ship', p2);
  await tap('KeyE');
  check('inside ship', (await ev(() => window.__game.mode)) === 'interior');
  // Walk through the ship to the engine compartment on the left wall of the tech bay.
  await ev(() => { const g = window.__game; g.player.pos.set(0, 0, 3.2); g.player.forward.set(-1, 0, 0); });
  await hold('KeyW', 1400);
  const p3 = await ev(() => ({ key: window.__game.interaction?.key, pos: window.__game.player.pos.toArray().map((v) => +v.toFixed(2)) }));
  check('engine compartment prompt', p3.key === 'prompt.engine_compartment', JSON.stringify(p3));
  await tap('KeyE');
  await page.waitForSelector('text=Install Nitro');
  await page.click('text=Install Nitro');
  const nitro = await ev(() => window.__game.state.ship.nitro);
  check('Nitro installed via tech bay', nitro.installed && nitro.charge === 100, JSON.stringify(nitro));
  await page.screenshot({ path: `${OUT}/gp-techbay.png` });
  await page.keyboard.press('Escape');
  // 6b. Sleep in the bunk: lie down, time skips to the morning, stand up.
  const slept = await ev(() => {
    const g = window.__game, p = g.player;
    p.pos.set(-0.8, 0, -3.6);
    g.sleepInBunk(() => g.menus.skipToHour(7), 'rest.woke_up');
    const started = !!g.sleep;
    let lay = 0;
    for (let i = 0; i < 30 * 9 && g.sleep; i++) { g.simulate(1 / 30, 1 / 30); lay = Math.max(lay, p.model.rotation.x); }
    return { started, lay: +lay.toFixed(2), done: !g.sleep, hour: +(g.localHour || 0).toFixed(1), mode: g.mode, stand: p.model.rotation.x };
  });
  check('sleep in the bunk until morning', slept.started && slept.lay > 1.3 && slept.done && slept.hour >= 6.5 && slept.hour < 9 && slept.mode === 'interior' && slept.stand === 0, JSON.stringify(slept));
  // 7. Walk to the cockpit, sit, take off
  await ev(() => { const g = window.__game; g.player.pos.set(0, 0, -6); g.player.forward.set(0, 0, -1); });
  await hold('KeyW', 1500);
  const p4 = await ev(() => window.__game.interaction?.key);
  check('pilot seat prompt', p4 === 'prompt.pilot', p4);
  await tap('KeyE');
  await hold('Space', 2500);
  const fl = await ev(() => ({ landed: window.__game.ship.landed, alt: window.__game.ship.altitude, mode: window.__game.mode }));
  check('take off with SPACE', !fl.landed && fl.alt > 5, JSON.stringify(fl));
  await hold('KeyW', 2500);
  const fl2 = await ev(() => ({ speed: window.__game.ship.speed, thr: window.__game.ship.throttle }));
  check('throttle up with W', fl2.thr > 0.5 && fl2.speed > 30, JSON.stringify(fl2));
  await page.screenshot({ path: `${OUT}/gp-flight.png` });
  // 8. Save, reload, continue
  await page.keyboard.press('Escape');
  await page.click('text=Save game');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.__game && document.querySelector('.title-screen'));
  await page.waitForTimeout(500);
  await page.click('text=Continue');
  await page.waitForFunction(() => window.__game.state);
  await page.waitForTimeout(1500);
  const re = await ev(() => ({ mode: window.__game.mode, jet: window.__game.state.jetpack.owned, nitro: window.__game.state.ship.nitro.installed, mined: window.__game.state.stats.mined, landed: window.__game.ship.landed }));
  check('save/load keeps progress', re.jet && re.nitro && re.mined >= 1 && re.mode === 'pilot' && !re.landed, JSON.stringify(re));
  await page.screenshot({ path: `${OUT}/gp-reloaded.png` });
  // 9. Dive nose-down at the ground: the landing assist should set it down.
  const dive = await ev(() => {
    const g = window.__game, s = g.ship;
    const up = s.root.position.clone().normalize();
    s.root.position.copy(up).multiplyScalar(s.body.groundRadius(up) + 250);
    s.vel.copy(up).multiplyScalar(-30);
    s.root.quaternion.setFromAxisAngle(new s.root.position.constructor(1, 0, 0), 0);
    s.alignUp(up, null, 1);
    s.root.rotateX(-0.7);
    s.throttle = 0.2;
    const hp = g.state.ship.modules.hull.hp;
    g.simulate(25, 1 / 30);
    return { landed: s.landed, alt: Math.round(s.altitude), dmg: +(hp - g.state.ship.modules.hull.hp).toFixed(1) };
  });
  check('nose-down approach lands without crashing', dive.landed && dive.dmg < 5, JSON.stringify(dive));
  // 10. Full-throttle dive from 20 km: entry braking and the sink-rate cap
  // must bring it down to the ground without damage.
  const entry = await ev(() => {
    const g = window.__game, s = g.ship;
    s.landed = false;
    const up = s.root.position.clone().normalize();
    s.root.position.copy(up).multiplyScalar(s.body.radius + 20000);
    s.alignUp(up, null, 1);
    s.root.rotateX(-1.45);
    s.throttle = 1;
    s.vel.set(0, 0, -2400).applyQuaternion(s.root.quaternion);
    const hp = g.state.ship.modules.hull.hp;
    let heat = 0, minAlt = Infinity;
    for (let i = 0; i < 60 * 30 && !s.landed; i++) {
      g.simulate(1 / 30, 1 / 30);
      heat = Math.max(heat, s.entryHeat);
      minAlt = Math.min(minAlt, s.altitude);
      if (s.altitude < 60) s.throttle = 0;
    }
    return { landed: s.landed, heat: +heat.toFixed(2), dmg: +(hp - g.state.ship.modules.hull.hp).toFixed(1), alt: Math.round(s.altitude) };
  });
  check('20 km full-throttle dive: re-entry braking, no crash', entry.dmg < 5 && entry.heat > 0.3 && (entry.landed || entry.alt > -1), JSON.stringify(entry));
} catch (e) {
  check('no exception', false, e.message);
  await page.screenshot({ path: `${OUT}/gp-fail.png` }).catch(() => {});
}
check('no console errors', errors.length === 0, [...new Set(errors)].slice(0, 5).join(' | '));
await browser.close();
srv.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
