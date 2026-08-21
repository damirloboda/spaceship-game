import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findStartSystem, systemsNear, sectorSystems, generateSystem } from '../src/gen/galaxy.js';
import { getSurface } from '../src/gen/planet.js';
import { fbm } from '../src/core/rng.js';

/*
 * Performance budgets (§106, §119).
 *
 * These aren't exact FPS targets (this runs on whatever CPU happens to host
 * CI) — they're regression guards: if someone reintroduces the arithmetic-hash
 * noise or an unbounded sector query, one of these fails loudly instead of the
 * game just quietly stuttering later.
 */

describe('Performance budgets', () => {
  test('noise throughput stays well above real-time terrain-streaming needs', () => {
    const t0 = Date.now();
    let acc = 0;
    const N = 500_000;
    for (let i = 0; i < N; i++) acc += fbm(11, i * 1e-5, 0.3, 0.7, 4);
    const perSec = N / ((Date.now() - t0) / 1000);
    assert.ok(perSec > 1_000_000, `fbm throughput too low: ${(perSec / 1e6).toFixed(2)}M/s`);
    assert.ok(Number.isFinite(acc));
  });

  test('a full terrain patch worth of elevation samples builds in well under one frame', () => {
    const { system, planetIndex } = findStartSystem();
    const surface = getSurface(system.planets[planetIndex]);
    const res = 96;
    const t0 = Date.now();
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        surface.elevation(i / res, j / res, 0.7);
      }
    }
    const ms = Date.now() - t0;
    assert.ok(ms < 80, `terrain patch (${(res + 1) ** 2} verts) took ${ms}ms — too slow to stream while walking`);
  });

  test('a 60ly system query resolves fast enough for an interactive galaxy map', () => {
    const { system } = findStartSystem();
    const t0 = Date.now();
    const near = systemsNear(system.pos, 60);
    const ms = Date.now() - t0;
    assert.ok(ms < 200, `systemsNear(60ly) took ${ms}ms`);
    assert.ok(near.length > 0);
  });

  test('sector queries are cached — repeat lookups are effectively free', () => {
    sectorSystems(5, 5, 5);       // warm the cache
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) sectorSystems(5, 5, 5);
    const ms = Date.now() - t0;
    assert.ok(ms < 50, `1000 cached sector lookups took ${ms}ms`);
  });

  test('generating a full star system is cheap enough to do on approach, not just at boot', () => {
    const stub = sectorSystems(2, -1, 3)[0];
    if (!stub) return;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) generateSystem(stub);
    const ms = (Date.now() - t0) / 20;
    assert.ok(ms < 10, `generateSystem averaged ${ms.toFixed(2)}ms`);
  });
});
