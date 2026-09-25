import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { Rng } from '../src/core/Rng';
import { Granular } from '../src/physics/Granular';
import { Stability } from '../src/physics/Stability';
import { Water } from '../src/physics/Water';
import { M } from '../src/world/Materials';
import { Terrain } from '../src/world/Terrain';

function block(t: Terrain, x0: number, y0: number, x1: number, y1: number, m: number) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) t.setRaw(x, y, m);
}

describe('Устойчивость и обвалы', () => {
  it('слишком широкий свод без опоры трескается и обваливается', () => {
    const t = new Terrain(120, 80);
    block(t, 0, 20, 119, 79, M.SOIL);
    const bus = new EventBus();
    const st = new Stability(t, bus, new Rng(1));
    let collapses = 0;
    bus.on((e) => { if (e.type === 'collapse') collapses++; });
    // выкапываем комнату шириной 30 (пролёт земли — 4)
    for (let x = 40; x < 70; x++) for (let y = 40; y < 45; y++) t.set(x, y, M.AIR);
    for (let k = 0; k < 30 * 40; k++) { st.update(1 / 30, 5000); bus.flush(); }
    expect(collapses).toBeGreaterThan(0);
  });
  it('узкий ход устойчив', () => {
    const t = new Terrain(120, 80);
    block(t, 0, 20, 119, 79, M.SOIL);
    const bus = new EventBus();
    const st = new Stability(t, bus, new Rng(1));
    let collapses = 0;
    bus.on((e) => { if (e.type === 'collapse') collapses++; });
    for (let x = 40; x < 44; x++) for (let y = 40; y < 43; y++) t.set(x, y, M.AIR);
    for (let k = 0; k < 30 * 40; k++) { st.update(1 / 30, 5000); bus.flush(); }
    expect(collapses).toBe(0);
  });
  it('укреплённый свод держит широкую комнату', () => {
    const t = new Terrain(120, 80);
    block(t, 0, 20, 119, 79, M.SOIL);
    for (let x = 36; x < 60; x++) t.setRaw(x, 39, M.NESTWALL);
    const bus = new EventBus();
    const st = new Stability(t, bus, new Rng(1));
    let collapses = 0;
    bus.on((e) => { if (e.type === 'collapse') collapses++; });
    for (let x = 40; x < 56; x++) for (let y = 40; y < 44; y++) t.set(x, y, M.AIR);
    for (let k = 0; k < 30 * 40; k++) { st.update(1 / 30, 5000); bus.flush(); }
    expect(collapses).toBe(0);
  });
});

describe('Сыпучие материалы и вода', () => {
  it('песок падает, если под ним пусто', () => {
    const t = new Terrain(40, 40);
    block(t, 0, 30, 39, 39, M.STONE);
    t.setRaw(20, 5, M.SAND);
    const g = new Granular(t, new Rng(2));
    g.wake(20, 5);
    for (let k = 0; k < 60; k++) g.update(100);
    expect(t.get(20, 29)).toBe(M.SAND);
    expect(t.get(20, 5)).toBe(M.AIR);
  });
  it('вода стекает вниз и растекается по дну', () => {
    const t = new Terrain(40, 40);
    block(t, 0, 30, 39, 39, M.STONE);
    const w = new Water(t, new Rng(3));
    w.evaporation = 0;
    w.add(20, 10, 255);
    for (let k = 0; k < 400; k++) w.update(100, 1 / 30);
    let bottom = 0;
    for (let x = 0; x < 40; x++) bottom += t.water[29 * 40 + x];
    expect(t.water[10 * 40 + 20]).toBe(0);
    expect(bottom).toBeGreaterThan(200);
  });
  it('мокрая земля становится грязью', () => {
    const t = new Terrain(20, 20);
    block(t, 0, 10, 19, 19, M.SOIL);
    const w = new Water(t, new Rng(4));
    // насыщенный влагой столб грунта (после ливня)
    for (let y = 10; y < 20; y++) t.moist[y * 20 + 5] = 250;
    for (let k = 0; k < 40; k++) w.soilPass(20, 0);
    expect(t.get(5, 12)).toBe(M.MUD);
  });
});
