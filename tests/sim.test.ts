import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/procgen/WorldGenerator';
import { Simulation } from '../src/sim/Simulation';
import { modeByKey } from '../src/sim/Modes';
import { S } from '../src/ants/AntStore';

const log = (...a: unknown[]) => (globalThis as any).process.stderr.write(a.join(' ') + '\n');

function makeSim(seed = 7, mode = 'sandbox') {
  const m = modeByKey(mode);
  const world = generateWorld({ seed, width: m.worldW, height: m.worldH, urban: !m.chasm, chasmChallenge: m.chasm });
  return new Simulation(world, m);
}

describe('Simulation (headless)', () => {
  it('runs 2 minutes of game time without errors and ants bring food home', () => {
    const sim = makeSim();
    const col = sim.player;
    const t0 = performance.now();
    for (let k = 0; k < 30 * 120; k++) sim.step();
    const ms = performance.now() - t0;
    const states = new Array(21).fill(0);
    for (let i = 0; i < sim.ants.n; i++) if (sim.ants.alive[i]) states[sim.ants.state[i]]++;
    log('ms/tick', (ms / 3600).toFixed(2), 'pop', col.population(), 'agents', col.agents, 'food', col.food.toFixed(1), 'delivered', col.stats.delivered.toFixed(1), 'brood', col.brood.total(), 'lvl', col.evo.level, 'xp', col.evo.xp.toFixed(0));
    log('states', states.map((v, i) => `${i}:${v}`).filter((s) => !s.endsWith(':0')).join(' '));
    log('rival pop', sim.colonies[1]?.population(), 'rival delivered', sim.colonies[1]?.stats.delivered.toFixed(1));
    expect(col.stats.delivered).toBeGreaterThan(0);
    expect(col.population()).toBeGreaterThan(5);
  }, 120000);
});
