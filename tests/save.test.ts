import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/save/SaveSystem';
import { hashBytes, makeSim, run } from './helpers';

describe('Сохранение', () => {
  it('сохраняет и восстанавливает мир, колонию, муравьёв и продолжает симуляцию', async () => {
    const sim = makeSim(9);
    run(sim, 60);
    sim.queue({ type: 'dig', cells: [[sim.player.nest.entranceX + 8, sim.player.nest.entranceY + 6]] });
    run(sim, 5);
    const data = await serialize(sim);
    expect(data.length).toBeGreaterThan(1000);
    const re = await deserialize(data);
    expect(hashBytes(re.terrain.mat)).toBe(hashBytes(sim.terrain.mat));
    expect(re.ants.count).toBe(sim.ants.count);
    expect(re.player.population()).toBe(sim.player.population());
    expect(Math.round(re.player.food)).toBe(Math.round(sim.player.food));
    expect(re.food.items.length).toBe(sim.food.items.filter((i) => !i.removed).length);
    expect(re.plants.plants.length).toBe(sim.plants.plants.length);
    expect(re.construction.blueprints.size).toBe(sim.construction.blueprints.size);
    expect(re.time).toBeCloseTo(sim.time, 5);
    run(re, 30);
    expect(re.player.population()).toBeGreaterThan(0);
  }, 120000);
});

describe('Детерминизм', () => {
  it('одинаковые seed и команды — одинаковый мир через минуту', () => {
    const a = makeSim(5);
    const b = makeSim(5);
    for (const s of [a, b]) {
      run(s, 10);
      s.queue({ type: 'explore', x: 900, y: 300 });
      run(s, 50);
    }
    expect(hashBytes(a.terrain.mat)).toBe(hashBytes(b.terrain.mat));
    expect(hashBytes(a.ants.x.subarray(0, a.ants.n))).toBe(hashBytes(b.ants.x.subarray(0, b.ants.n)));
    expect(a.player.food).toBe(b.player.food);
  }, 120000);
});
