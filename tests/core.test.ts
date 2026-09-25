import { describe, expect, it } from 'vitest';
import { Noise } from '../src/core/Noise';
import { Rng } from '../src/core/Rng';
import { PheromoneField, P } from '../src/pheromone/PheromoneField';

describe('Rng / Noise', () => {
  it('один seed — одна последовательность', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
    const c = new Rng(43);
    expect(new Rng(42).next()).not.toBe(c.next());
  });
  it('fork независим, но воспроизводим', () => {
    const a = new Rng(1).fork('water');
    const b = new Rng(1).fork('water');
    const c = new Rng(1).fork('food');
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });
  it('шум детерминирован и в диапазоне', () => {
    const n = new Noise(5);
    for (let i = 0; i < 200; i++) {
      const v = n.fbm2(i * 0.37, i * 0.11);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(v).toBe(new Noise(5).fbm2(i * 0.37, i * 0.11));
    }
  });
});

describe('Феромоны', () => {
  it('испаряются с заданным полураспадом и не выходят за предел', () => {
    const f = new PheromoneField(256, 128);
    f.deposit(P.HOME, 100, 60, 4, 0);
    const v0 = f.sample(P.HOME, 100, 60);
    expect(v0).toBeCloseTo(4, 5);
    // период полураспада HOME = 110 с; за 110 с с диффузией значение в клетке падает больше чем вдвое, но не до нуля
    for (let t = 1; t <= 110; t++) f.update(t, 1000);
    const v1 = f.sample(P.HOME, 100, 60);
    expect(v1).toBeLessThan(2.1);
    expect(v1).toBeGreaterThan(0.2);
    for (let k = 0; k < 100; k++) f.deposit(P.FOOD, 10, 10, 5, 0);
    expect(f.sample(P.FOOD, 10, 10)).toBeLessThanOrEqual(12);
  });
  it('тревога распространяется (диффузия), следы — почти нет', () => {
    const f = new PheromoneField(256, 128);
    f.deposit(P.DANGER, 100, 60, 8, 0);
    f.deposit(P.FOOD, 180, 60, 8, 0);
    for (let t = 1; t <= 5; t++) f.update(t, 1000);
    expect(f.sample(P.DANGER, 104, 60)).toBeGreaterThan(0.01);
    expect(f.sample(P.FOOD, 184, 60)).toBeLessThan(f.sample(P.DANGER, 104, 60));
  });
});
