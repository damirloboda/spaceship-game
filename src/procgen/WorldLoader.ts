import { Terrain } from '../world/Terrain';
import { generateWorld, WorldData, WorldParams } from './WorldGenerator';
import GenWorker from './gen.worker.ts?worker&inline';

/** Сгенерировать мир в воркере (fallback — в главном потоке). */
export function loadWorld(params: WorldParams): Promise<WorldData> {
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new GenWorker();
    } catch {
      resolve(generateWorld(params));
      return;
    }
    const w = worker;
    w.onmessage = (e) => {
      const d = e.data;
      const t = new Terrain(d.terrain.W, d.terrain.H);
      for (const k of Object.keys(d.terrain.arrays)) (t as unknown as Record<string, ArrayBufferView>)[k] && new Uint8Array((t as unknown as Record<string, ArrayBufferView>)[k].buffer).set(new Uint8Array(d.terrain.arrays[k].buffer));
      t.rebuildSkyline();
      w.terminate();
      resolve({ ...d, terrain: t });
    };
    w.onerror = () => {
      w.terminate();
      resolve(generateWorld(params));
    };
    w.postMessage(params);
  });
}
