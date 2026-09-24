import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSystem, systemsNear, HOME_SYSTEM_ID, HOME_POSITION, summarizeSystem } from '../src/world/galaxy.js';
import { PlanetSurface, BIOMES } from '../src/world/planetGen.js';
import { generateFauna, generateFlora } from '../src/world/lifeGen.js';
import { CIVILIZATIONS, generateCitizens } from '../src/world/civGen.js';

test('Planet Generation: home system is deterministic and complete', () => {
  const a = generateSystem(HOME_SYSTEM_ID);
  const b = generateSystem(HOME_SYSTEM_ID);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
  const aurel = a.bodies.find((p) => p.id === 'home/aurel');
  assert.ok(aurel.rings && aurel.ocean && aurel.atmosphere && aurel.city && aurel.station);
  assert.ok(a.bodies.some((p) => p.kind === 'moon'));
});

test('Planet Generation: heights are finite, bounded and repeatable', () => {
  const sys = generateSystem(HOME_SYSTEM_ID);
  for (const def of sys.bodies) {
    const s1 = new PlanetSurface(def);
    const s2 = new PlanetSurface(def);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const y = (i / 1000) - 1;
      const a = i * 2.39996;
      const r = Math.sqrt(1 - y * y);
      const d = [Math.cos(a) * r, y, Math.sin(a) * r];
      const h = s1.heightAt(...d);
      assert.ok(Number.isFinite(h));
      assert.equal(h, s2.heightAt(...d));
      min = Math.min(min, h); max = Math.max(max, h);
      const biome = s1.biomeAt(...d, h, 0);
      assert.ok(BIOMES[biome], `unknown biome ${biome}`);
    }
    assert.ok(max - min > def.terrain.amplitude * 0.3, `${def.name} has relief`);
    assert.ok(max < def.terrain.amplitude * 3 && min > -def.terrain.amplitude * 3);
  }
});

test('Planet Generation: an ocean world has both land and sea', () => {
  const aurel = generateSystem(HOME_SYSTEM_ID).bodies[0];
  const s = new PlanetSurface(aurel);
  let land = 0, sea = 0;
  for (let i = 0; i < 3000; i++) {
    const y = (i / 1500) - 1;
    const a = i * 2.39996;
    const r = Math.sqrt(1 - y * y);
    (s.heightAt(Math.cos(a) * r, y, Math.sin(a) * r) > 0 ? land++ : sea++);
  }
  assert.ok(land > 300 && sea > 300, `land ${land} sea ${sea}`);
});

test('Planet Generation: flat zones flatten terrain for the city', () => {
  const aurel = generateSystem(HOME_SYSTEM_ID).bodies[0];
  const s = new PlanetSurface(aurel);
  const site = s.findSite('city');
  assert.ok(site, 'city site found');
  s.addFlatZone(site.dir, 300, site.height, 200);
  assert.ok(Math.abs(s.heightAt(...site.dir) - site.height) < 1e-6);
});

test('Galaxy: many systems around home, each generates valid planets', () => {
  const near = systemsNear(HOME_POSITION, 60);
  assert.ok(near.length >= 10, `found ${near.length}`);
  for (const s of near.slice(0, 12)) {
    const sys = generateSystem(s.id);
    assert.equal(sys.id, s.id);
    for (const p of sys.bodies) {
      assert.ok(p.radius > 1000 && p.gravity > 0);
      const surf = new PlanetSurface(p);
      assert.ok(Number.isFinite(surf.heightAt(0, 1, 0)));
    }
  }
  assert.equal(summarizeSystem('2:0:4:0').starType, 'black_hole');
});

test('Life: 10 creature species and 20 plant species with food chain', () => {
  const aurel = generateSystem(HOME_SYSTEM_ID).bodies[0];
  const fauna = generateFauna(aurel, 10);
  const flora = generateFlora(aurel, 20);
  assert.equal(fauna.length, 10);
  assert.equal(flora.length, 20);
  assert.ok(fauna.some((f) => f.diet === 'herbivore') && fauna.some((f) => f.diet === 'predator'));
  assert.equal(new Set(fauna.map((f) => f.name)).size >= 8, true);
});

test('Civilizations: ten defined, citizens have schedules and homes', () => {
  assert.equal(CIVILIZATIONS.length, 10);
  const buildings = Array.from({ length: 12 }, (_, i) => ({ index: i, kind: ['residential', 'market', 'lab', 'workshop', 'spaceport', 'hospital'][i % 6] }));
  const npcs = generateCitizens(0, 5, 20, buildings);
  assert.equal(npcs.length, 20);
  for (const n of npcs) {
    assert.ok(n.name && n.profession && n.personality && n.faction);
    assert.ok(n.schedule.wake < n.schedule.workStart && n.schedule.workEnd < n.schedule.sleep);
    assert.ok(Number.isInteger(n.home) && Number.isInteger(n.work));
  }
});
