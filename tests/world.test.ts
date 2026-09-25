import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/procgen/WorldGenerator';
import { M } from '../src/world/Materials';
import { hashBytes } from './helpers';

describe('Процедурная генерация', () => {
  it('один seed полностью воспроизводит мир', () => {
    const a = generateWorld({ seed: 123, width: 1024, height: 512, urban: false });
    const b = generateWorld({ seed: 123, width: 1024, height: 512, urban: false });
    expect(hashBytes(a.terrain.mat)).toBe(hashBytes(b.terrain.mat));
    expect(hashBytes(a.terrain.water)).toBe(hashBytes(b.terrain.water));
    expect(a.plants.length).toBe(b.plants.length);
    expect(JSON.stringify(a.foods)).toBe(JSON.stringify(b.foods));
    expect(JSON.stringify(a.creatures)).toBe(JSON.stringify(b.creatures));
  });
  it('разные seed — разные миры', () => {
    const a = generateWorld({ seed: 1, width: 1024, height: 512, urban: false });
    const b = generateWorld({ seed: 2, width: 1024, height: 512, urban: false });
    expect(hashBytes(a.terrain.mat)).not.toBe(hashBytes(b.terrain.mat));
  });
  it('в мире есть гнездо, канава, дом, улица, растения, еда и существа', () => {
    const w = generateWorld({ seed: 7, width: 2048, height: 768, urban: true });
    expect(w.nests.length).toBe(2);
    expect(w.zones.map((z) => z.kind)).toEqual([0, 1, 2, 3, 4]);
    expect(w.plants.length).toBeGreaterThan(50);
    expect(w.foods.length).toBeGreaterThan(100);
    expect(w.creatures.length).toBeGreaterThan(10);
    let plastic = 0;
    let metal = 0;
    let brick = 0;
    for (let i = 0; i < w.terrain.size; i++) {
      const m = w.terrain.mat[i];
      if (m === M.PLASTIC) plastic++;
      if (m === M.METAL) metal++;
      if (m === M.BRICK) brick++;
    }
    expect(plastic).toBeGreaterThan(100); // гладкая канава
    expect(metal).toBeGreaterThan(100); // ножки стола, холодильник
    expect(brick).toBeGreaterThan(1000); // стены дома
    // вход гнезда — пустая клетка
    const n = w.nests[0];
    expect(w.terrain.get(n.entranceX, n.entranceY)).toBe(M.AIR);
  });
});
