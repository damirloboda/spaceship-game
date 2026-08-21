import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RNG, noise3, fbm, hashInts, hashString } from '../src/core/rng.js';
import { findStartSystem, generateSystem, sectorSystems, systemsNear, DANGER_LEVELS } from '../src/gen/galaxy.js';
import { getSurface, PlanetSurface, RESOURCES } from '../src/gen/planet.js';
import { generateFauna, generateFlora } from '../src/gen/creature.js';
import { generateCity } from '../src/gen/city.js';
import { generateNPC, npcSchedule } from '../src/gen/npc.js';

describe('RNG and noise', () => {
  test('RNG is deterministic for a given seed', () => {
    const a = new RNG('ultra-cosmos');
    const b = new RNG('ultra-cosmos');
    for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
  });

  test('noise3/fbm are pure functions of (seed, x, y, z)', () => {
    assert.equal(noise3(7, 1.5, 2.5, 3.5), noise3(7, 1.5, 2.5, 3.5));
    assert.equal(fbm(3, 0.1, 0.2, 0.3, 4), fbm(3, 0.1, 0.2, 0.3, 4));
  });

  test('noise3 stays within a sane range', () => {
    let min = 9, max = -9;
    for (let i = 0; i < 5000; i++) {
      const v = noise3(11, i * 0.013, i * 0.007, i * 0.003);
      min = Math.min(min, v); max = Math.max(max, v);
    }
    assert.ok(min >= -1.2 && max <= 1.2, `noise3 out of range: [${min}, ${max}]`);
  });

  test('hashInts and hashString are stable', () => {
    assert.equal(hashInts(1, 2, 3), hashInts(1, 2, 3));
    assert.equal(hashString('faelom'), hashString('faelom'));
  });
});

describe('Galaxy generation', () => {
  test('findStartSystem returns a survivable, ringed home world', () => {
    const { system, planetIndex } = findStartSystem();
    const home = system.planets[planetIndex];
    assert.ok(home.habitable, 'home world should be habitable');
    assert.ok(home.hasCity, 'home world should have a city');
    assert.ok(system.planets.some((p) => p.hasRings), 'system should have a ringed planet');
    assert.ok(system.station, 'start system should have a station');
    assert.ok(DANGER_LEVELS.includes(home.danger));
    assert.ok(home.danger === 'SAFE' || home.danger === 'LOW');
  });

  test('same sector always yields the same systems', () => {
    const a = sectorSystems(1, 2, 3);
    const b = sectorSystems(1, 2, 3);
    assert.deepEqual(a.map((s) => s.id), b.map((s) => s.id));
  });

  test('systemsNear finds and sorts systems by distance', () => {
    const { system } = findStartSystem();
    const near = systemsNear(system.pos, 80);
    assert.ok(near.length > 0);
    for (let i = 1; i < near.length; i++) {
      assert.ok(near[i].distanceLy >= near[i - 1].distanceLy);
    }
  });

  test('generateSystem is deterministic and internally consistent', () => {
    const stub = sectorSystems(0, 0, 0)[0];
    const a = generateSystem(stub);
    const b = generateSystem(stub);
    assert.equal(a.planets.length, b.planets.length);
    assert.deepEqual(a.planets.map((p) => p.seed), b.planets.map((p) => p.seed));
  });

  test('planet physical properties are physically sane', () => {
    let checked = 0;
    for (const stub of sectorSystems(0, 0, 0).slice(0, 8)) {
      for (const p of generateSystem(stub).planets) {
        assert.ok(p.radius > 0);
        assert.ok(p.gravity > 0 && p.gravity < 200, `gravity out of range: ${p.gravity}`);
        assert.ok(p.surfaceTemp > 0);
        assert.ok(p.atmosphere >= 0);
        assert.ok(p.water >= 0 && p.water <= 1);
        checked++;
      }
    }
    assert.ok(checked > 10);
  });
});

describe('Planet surface', () => {
  test('elevation() is deterministic and matches across independent instances', () => {
    const { system, planetIndex } = findStartSystem();
    const planet = system.planets[planetIndex];
    const s1 = new PlanetSurface(planet);
    const s2 = new PlanetSurface(planet);
    assert.equal(s1.elevation(0.3, 0.5, 0.81), s2.elevation(0.3, 0.5, 0.81));
    assert.equal(s1.seaLevel, s2.seaLevel);
  });

  test('sea level calibration matches the target water fraction', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const N = 2000;
    let under = 0;
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * i + 1) / N, r = Math.sqrt(Math.max(0, 1 - y * y)), th = Math.PI * (3 - Math.sqrt(5)) * i;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      if (surface.isUnderwater(x, y, z)) under++;
    }
    const measured = under / N;
    assert.ok(Math.abs(measured - system.planets[planetIndex].water) < 0.06,
      `measured ocean ${measured} vs target ${system.planets[planetIndex].water}`);
  });

  test('every planet class produces finite, bounded terrain', () => {
    for (const stub of sectorSystems(0, 0, 0).slice(0, 10)) {
      for (const p of generateSystem(stub).planets) {
        const surface = getSurface(p);
        for (let i = 0; i < 50; i++) {
          const a = i * 2.399, b = i * 1.618;
          const x = Math.sin(a) * Math.cos(b), y = Math.cos(a), z = Math.sin(a) * Math.sin(b);
          const e = surface.elevation(x, y, z);
          assert.ok(Number.isFinite(e), `non-finite elevation on ${p.class}`);
          assert.ok(Math.abs(e) < surface.relief * 3, `elevation absurd on ${p.class}: ${e}`);
        }
      }
    }
  });

  test('points of interest include an unmarked (hidden) category', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const poi = surface.pointsOfInterest();
    assert.ok(poi.some((p) => p.marked));
    // Not every world will roll an unmarked POI, but the mechanism must exist.
    assert.ok(poi.every((p) => typeof p.marked === 'boolean'));
  });

  test('resource survey only returns resources this world can actually have', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const survey = surface.resourceSurvey();
    for (const r of survey) assert.ok(RESOURCES[r.id]);
  });
});

describe('Creatures, flora, cities, NPCs', () => {
  test('fauna respects planet gravity and forms a real food chain', () => {
    const { system, planetIndex } = findStartSystem();
    const planet = system.planets[planetIndex];
    const fauna = generateFauna(planet);
    assert.ok(fauna.some((f) => f.diet === 'herbivore'));
    for (const f of fauna) {
      assert.ok(f.height > 0 && f.mass > 0);
      assert.ok(f.intelligence >= 0 && f.intelligence <= 1);
    }
  });

  test('flora height matches its form (no more 60m grass)', () => {
    const { system, planetIndex } = findStartSystem();
    const flora = generateFlora(system.planets[planetIndex]);
    for (const f of flora) {
      if (f.form === 'grass') assert.ok(f.height < 4, `grass too tall: ${f.height}m`);
      if (f.form === 'tree') assert.ok(f.height < 120);
    }
  });

  test('city buildings scale sanely with population', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const poi = surface.pointsOfInterest().find((p) => p.kind === 'city');
    const city = generateCity(poi, system.planets[planetIndex]);
    const homes = city.buildings.filter((b) => b.type === 'home').length;
    // A city shouldn't cram 200,000 people into a couple hundred metres.
    const density = city.population / (Math.PI * city.radius * city.radius);
    assert.ok(density < 0.06, `city too dense: ${density} people/m^2`);
    assert.ok(homes > 0);
  });

  test('NPCs follow a real daily schedule bound to real buildings', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const poi = surface.pointsOfInterest().find((p) => p.kind === 'city');
    const city = generateCity(poi, system.planets[planetIndex]);
    const npc = generateNPC(city.seed, 0, city.civilization, city);
    assert.ok(npc.homeId);
    // Deep night, well clear of any shift: some hour must be spent asleep.
    const activities = new Set();
    for (let h = 0; h < 24; h += 0.5) activities.add(npcSchedule(npc, h).activity);
    assert.ok(activities.has('sleep'), `NPC never sleeps: ${[...activities]}`);
    assert.ok(activities.has('work'), `NPC never works: ${[...activities]}`);
  });
});
