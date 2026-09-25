import { generateWorld } from '../src/procgen/WorldGenerator';
import { modeByKey } from '../src/sim/Modes';
import { Simulation } from '../src/sim/Simulation';

export function makeSim(seed = 7, mode = 'sandbox'): Simulation {
  const m = modeByKey(mode);
  return new Simulation(generateWorld({ seed, width: m.worldW, height: m.worldH, urban: !m.chasm, chasmChallenge: m.chasm, theme: m.theme }), m);
}

export function run(sim: Simulation, seconds: number): void {
  const n = Math.round(seconds * 30);
  for (let k = 0; k < n; k++) sim.step();
}

/** FNV-хеш массива байт — для сравнения состояний. */
export function hashBytes(a: ArrayBufferView): number {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
