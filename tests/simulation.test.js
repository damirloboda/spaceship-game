import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findStartSystem, generateSystem, sectorSystems } from '../src/gen/galaxy.js';
import { Ecosystem } from '../src/sim/ecosystem.js';
import { Market, bestTrades, COMMODITIES } from '../src/sim/economy.js';
import { FactionState } from '../src/sim/faction.js';
import { weatherAt, worldEventFor } from '../src/sim/weather.js';
import { World } from '../src/sim/world.js';
import { CIVILIZATIONS } from '../src/gen/civ.js';

describe('Ecosystem', () => {
  test('an undisturbed ecosystem is in equilibrium (§16 food chain holds)', () => {
    let worst = 0, tested = 0;
    for (let sx = 0; sx < 2; sx++) {
      for (const stub of sectorSystems(sx, 0, 0).slice(0, 8)) {
        for (const planet of generateSystem(stub).planets) {
          const eco = new Ecosystem(planet);
          if (!eco.species.length) continue;
          const before = { ...eco.populations };
          eco.tick(365 * 300);
          tested++;
          assert.equal(eco.collapsed.length, 0, `unprovoked extinction on ${planet.name} (${planet.class})`);
          for (const s of eco.species) {
            const drift = Math.abs(eco.populations[s.id] - before[s.id]) / before[s.id];
            worst = Math.max(worst, drift);
          }
        }
      }
    }
    assert.ok(tested > 5);
    assert.ok(worst < 0.01, `population drift too high: ${worst}`);
  });

  test('hunting a species to extinction cascades through predators (§1)', () => {
    const { system, planetIndex } = findStartSystem();
    const eco = new Ecosystem(system.planets[planetIndex]);
    eco.tick(365);
    const prey = eco.species.filter((s) => s.diet === 'herbivore')
      .sort((a, b) => eco.populations[b.id] - eco.populations[a.id])[0];
    const healthBefore = eco.health();
    eco.recordKill(prey.id, 999999);
    eco.tick(365 * 5);
    assert.ok(eco.health() < healthBefore, 'ecosystem health should drop after a species is wiped out');
  });
});

describe('Economy', () => {
  test('dumping goods on a market saturates the price, which recovers over time', () => {
    const m = new Market('test', 111, 'concord', { profile: 'industrial' });
    const before = m.buyPrice('food');
    m.trade('food', 300);
    const after = m.buyPrice('food');
    assert.ok(after < before, 'price should fall after a large sale');
    m.tick(60, {});
    const recovered = m.buyPrice('food');
    assert.ok(recovered > after, 'price should recover after time passes');
  });

  test('bestTrades only proposes genuinely profitable runs', () => {
    const a = new Market('a', 1, 'concord', { profile: 'mining' });
    const b = new Market('b', 2, 'koth', { profile: 'industrial' });
    for (const run of bestTrades(a, b, 200, 100000)) {
      assert.ok(run.marginPerUnit > 0);
      assert.ok(COMMODITIES[run.commodity]);
    }
  });
});

describe('Factions', () => {
  test('helping one faction affects allies and rivals (spillover, §20)', () => {
    const f = new FactionState(1);
    f.setRelation('concord', 'vessarid', 0.8);
    f.setRelation('concord', 'hollowmark', -0.8);
    f.addReputation('concord', 40);
    assert.ok(f.reputation.vessarid > 0, 'ally reputation should rise');
    assert.ok(f.reputation.hollowmark < 0, 'rival reputation should fall');
  });

  test('reputation tiers gate real access, not just a label (§67)', () => {
    const f = new FactionState(1);
    f.addReputation('hollowmark', -100, false);
    const access = f.access('hollowmark');
    assert.equal(access.dock, false);
    assert.equal(access.attackOnSight, true);
  });

  test('galactic politics produces wars, treaties and territory shifts over time', () => {
    const f = new FactionState(99);
    const events = f.tick(365 * 80);
    assert.ok(events.length > 0);
    for (const c of CIVILIZATIONS) assert.ok(f.territory[c.id] > 0);
  });
});

describe('Weather', () => {
  test('weather is deterministic and varies by region', () => {
    const { system, planetIndex } = findStartSystem();
    const planet = system.planets[planetIndex];
    const a = weatherAt(planet, { x: 1, y: 0, z: 0 }, 5000);
    const b = weatherAt(planet, { x: 1, y: 0, z: 0 }, 5000);
    assert.equal(a.type, b.type);
    const c = weatherAt(planet, { x: 0, y: 1, z: 0 }, 5000);
    // Not a strict requirement that they differ, but the field must vary somewhere.
    let anyDifferent = false;
    for (const dir of [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }]) {
      if (weatherAt(planet, dir, 5000).type !== a.type) anyDifferent = true;
    }
    assert.ok(anyDifferent, 'weather should differ somewhere across the globe');
  });

  test('airless worlds have no weather', () => {
    const stub = sectorSystems(0, 0, 0).find((s) => true);
    for (const p of generateSystem(stub).planets) {
      if (p.atmosphere < 0.08) {
        const w = weatherAt(p, { x: 1, y: 0, z: 0 }, 0);
        assert.equal(w.type, 'clear');
        assert.equal(w.hazard, 0);
      }
    }
  });
});

describe('World simulation (§50 offline progression)', () => {
  test('save/load round-trips world, market and ecosystem state exactly', () => {
    const { system, planetIndex } = findStartSystem();
    const planet = system.planets[planetIndex];
    const w = new World(7);
    w.ecosystem(planet);
    w.market('st1', 111, 'concord');
    w.markVisited(system.id);
    w.advance(86400 * 400);

    const blob = JSON.parse(JSON.stringify(w.save()));
    const w2 = new World(7, blob);
    assert.equal(w2.day, w.day);
    assert.equal(w2.visited.size, w.visited.size);
    assert.equal(w2.markets.get('st1').buyPrice('food'), w.markets.get('st1').buyPrice('food'));

    const restored = w2.restoreEcosystem(planet);
    assert.equal(restored.health(), w.ecosystems.get(planet.seed).health());
  });

  test('long time skips sample world events across the whole interval, not just one day', () => {
    const { system, planetIndex } = findStartSystem();
    const w = new World(7);
    w.ecosystem(system.planets[planetIndex]);
    w.advance(86400 * 700);
    const local = w.news.filter((n) => n.scope === 'local');
    assert.ok(local.length > 0, 'a 700-day absence should produce at least one local world event');
  });
});
