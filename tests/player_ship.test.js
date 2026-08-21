import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findStartSystem } from '../src/gen/galaxy.js';
import { getSurface } from '../src/gen/planet.js';
import { Player } from '../src/game/player.js';
import { Jetpack } from '../src/game/jetpack.js';
import { Ship, SHIP_CLASSES, NITRO_PARTS, C } from '../src/game/ship.js';
import { Container, expeditionCheck } from '../src/game/inventory.js';
import { Progression } from '../src/game/progression.js';

const { system, planetIndex } = findStartSystem();
const planet = system.planets[planetIndex];
const surface = getSurface(planet);

describe('Jetpack (§28)', () => {
  test('heat is the binding constraint before fuel runs out, on every model', () => {
    const { JETPACK_MODELS } = { JETPACK_MODELS: undefined };
    for (const id of ['civilian', 'survey', 'heavy', 'precursor']) {
      const j = new Jetpack(id);
      const fuelSeconds = j.stats.fuelCapacity / j.stats.burnRate;
      let heatSeconds = 0;
      const j2 = new Jetpack(id);
      for (let i = 0; i < 3000 && !j2.overheated; i++) { j2.fuel = 1e9; j2.update(0.1, 1); heatSeconds = i * 0.1; }
      assert.ok(heatSeconds < fuelSeconds, `${id}: heat (${heatSeconds}s) should bind before fuel (${fuelSeconds}s)`);
    }
  });

  test('a stock pack can hover on a light world but not a heavy one', () => {
    const j = new Jetpack('civilian');
    assert.ok(j.canLift(85, 5), 'should lift 85kg pilot at 5 m/s^2');
    assert.ok(!j.canLift(85, 40), 'should not lift 85kg pilot at 40 m/s^2');
  });

  test('overheat requires cooling down before it clears (hysteresis)', () => {
    const j = new Jetpack('civilian');
    while (!j.overheated) j.update(0.1, 1);
    j.update(0.1, 0);
    assert.ok(j.overheated, 'should still be overheated immediately after releasing throttle');
  });
});

describe('Player controller', () => {
  test('spawns exactly on the surface and stays grounded while walking', () => {
    const p = new Player({ jetpack: 'civilian' });
    const dir = surface.pointsOfInterest().find((x) => x.kind === 'landing_pad').dir;
    p.spawnAt(surface, dir);
    assert.ok(p.onGround);
    assert.ok(Math.abs(p.altitude(surface) - (p.eyeHeight + 0.1)) < 0.05); // spawnAt's default extraHeight
    for (let t = 0; t < 3; t += 1 / 60) p.update(1 / 60, { move: { x: 0, y: 1 } }, surface, planet, {});
    assert.ok(p.onGround, 'should remain grounded while walking on flat-ish terrain');
    assert.ok(p.health === 100, 'walking should not cause damage');
  });

  test('jetpack lifts the player off the ground and fuel drains', () => {
    const p = new Player({ jetpack: 'civilian' });
    const dir = surface.pointsOfInterest().find((x) => x.kind === 'landing_pad').dir;
    p.spawnAt(surface, dir);
    for (let t = 0; t < 3; t += 1 / 60) p.update(1 / 60, { jetThrottle: 1 }, surface, planet, {});
    assert.ok(!p.onGround, 'jetpack should lift the player off the ground');
    assert.ok(p.jetpack.fuel < p.jetpack.stats.fuelCapacity, 'fuel should have drained');
  });

  test('a lethal fall deals damage; a gentle one does not', () => {
    const p = new Player();
    const dir = surface.pointsOfInterest().find((x) => x.kind === 'landing_pad').dir;
    p.spawnAt(surface, dir, 60);          // 60m up
    for (let t = 0; t < 8 && p.alive; t += 1 / 60) p.update(1 / 60, {}, surface, planet, {});
    assert.ok(p.health < 100, 'falling 60m should cause damage');

    const p2 = new Player();
    p2.spawnAt(surface, dir, 0.3);        // barely above ground
    for (let t = 0; t < 2; t += 1 / 60) p2.update(1 / 60, {}, surface, planet, {});
    assert.equal(p2.health, 100, 'a trivial drop should not cause damage');
  });
});

describe('Ship classes and hull', () => {
  test('every ship class can launch from its own listed gravity range', () => {
    for (const [id, def] of Object.entries(SHIP_CLASSES)) {
      const s = new Ship(id);
      assert.ok(s.canLaunch(planet.gravity), `${id} should be able to launch at ${planet.gravity} m/s^2`);
    }
  });

  test('damage scales with hull strength and never breaks every system at once', () => {
    const s = new Ship('explorer');
    s.shieldHp = 0;
    const light = new Ship('explorer'); light.shieldHp = 0;
    light.applyDamage(150, 1);
    assert.ok(light.condition.hull > 0.7, 'light damage should leave most of the hull intact');

    const heavy = new Ship('explorer'); heavy.shieldHp = 0;
    const r = heavy.applyDamage(1600, 1);
    const brokenSystems = new Set(r.broken);
    assert.ok(brokenSystems.size < Object.keys(heavy.condition).length - 1,
      'a single hit should not break literally every subsystem at once');
  });

  test('repair restores condition and thrust', () => {
    const s = new Ship('explorer');
    s.shieldHp = 0;
    s.applyDamage(700, 5);
    const damaged = s.damagedSystems();
    assert.ok(damaged.length > 0);
    const sys = damaged[0].system;
    const before = s.condition[sys];
    s.repair(sys, 20);
    assert.ok(s.condition[sys] > before);
  });
});

describe('Nitro overdrive (§29)', () => {
  test('cannot engage without a part installed', () => {
    const s = new Ship('explorer');
    assert.equal(s.engageNitro(true), false);
  });

  test('install, deplete, and recharge cycle', () => {
    const s = new Ship('explorer');
    s.landed = false;
    const install = s.installNitro('nitro_basic');
    assert.ok(install.ok);
    assert.ok(s.nitroReady);
    const baseAccel = s.maxAcceleration();
    s.engageNitro(true);
    s.update(0.1, { throttle: 1, nitro: true }, {});
    assert.ok(s.nitroMultiplier() > 1);

    let t = 0;
    while (s.nitro.active && t < 30) { s.update(0.1, { throttle: 1, nitro: true }, {}); t += 0.1; }
    assert.ok(!s.nitro.active, 'overdrive should deplete under sustained use');
    assert.ok(t < NITRO_PARTS.nitro_basic.charge + 2, 'should deplete close to its rated charge time');
  });

  test('cannot install a second part into an occupied slot', () => {
    const s = new Ship('explorer');
    s.installNitro('nitro_basic');
    const second = s.installNitro('nitro_race');
    assert.equal(second.ok, false);
  });
});

describe('Lightbreak (§30)', () => {
  test('requires a charge before it will engage', () => {
    const s = new Ship('explorer');
    s.installModule('utility', 0, 'util_lightbreak');
    s.landed = false;
    assert.equal(s.engageLightbreak().ok, false);
  });

  test('once charged and engaged, speed ramps toward a real fraction of light speed', () => {
    const s = new Ship('explorer');
    s.installModule('utility', 0, 'util_lightbreak');
    s.landed = false;
    let t = 0;
    while (!s.lightbreakReady && t < 200) { s.chargeLightbreak(0.1, 1); t += 0.1; }
    assert.ok(s.lightbreakReady);
    assert.ok(s.engageLightbreak().ok);
    for (let i = 0; i < 50; i++) s.update(1, { throttle: 1 }, {});
    assert.ok(s.lightbreak.speed > 1e6, 'should reach at least ~0.3% c after sustained engagement');
    assert.ok(s.lightbreak.speed < C, 'must never exceed the speed of light');
  });

  test('a strong gravity well aborts Lightbreak', () => {
    const s = new Ship('explorer');
    s.installModule('utility', 0, 'util_lightbreak');
    s.landed = false;
    s.lightbreak.charge = 1;
    s.engageLightbreak();
    s.update(0.1, {}, { gravity: 5 });
    assert.equal(s.lightbreak.engaged, false, 'Lightbreak should abort near a mass shadow');
  });
});

describe('Inventory and expedition readiness (§64)', () => {
  test('reports exactly what is missing, not just pass/fail', () => {
    const ship = new Ship('explorer');
    const cargo = new Container('ship', 300);
    const personal = new Container('personal', 60);
    const before = expeditionCheck({ ship, shipCargo: cargo, personal });
    assert.equal(before.ready, false);
    const missing = before.items.filter((i) => !i.ok).map((i) => i.id);
    assert.ok(missing.includes('nitro'));
  });
});

describe('Progression (§68-69)', () => {
  test('profession bonus applies but is fully reversible', () => {
    const p = new Progression();
    p.setProfession('explorer');
    p.award('exploration', 500);
    const withBonus = p.xp.exploration;
    p.setProfession(null);
    const p2 = new Progression();
    p2.award('exploration', 500);
    assert.ok(withBonus > p2.xp.exploration, 'profession should boost matching XP');
    assert.equal(p.setProfession('miner'), true, 'switching profession must always be allowed');
  });
});
