import { generateWorld, WorldParams } from './WorldGenerator';

/** Генерация мира в отдельном потоке: интерфейс не зависает, массивы передаются без копирования. */
self.onmessage = (e: MessageEvent<WorldParams>) => {
  const w = generateWorld(e.data);
  const t = w.terrain;
  const arrays = { mat: t.mat, hp: t.hp, moist: t.moist, water: t.water, flags: t.flags, plant: t.plant, temp: t.temp };
  const msg = { ...w, terrain: { W: t.W, H: t.H, arrays } };
  (self as unknown as Worker).postMessage(msg, [t.mat.buffer, t.hp.buffer, t.moist.buffer, t.water.buffer, t.flags.buffer, t.plant.buffer, t.temp.buffer]);
};
