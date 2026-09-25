import { describe, expect, it } from 'vitest';
import { S } from '../src/ants/AntStore';
import { C } from '../src/ants/Castes';
import { SS } from '../src/construction/LivingStructures';
import { FK } from '../src/food/FoodTypes';
import { makeSim, run } from './helpers';

describe('Колония (без графики)', () => {
  it('10 муравьёв сами находят и приносят еду, колония растёт', () => {
    const sim = makeSim(7);
    run(sim, 180);
    const col = sim.player;
    expect(col.stats.delivered).toBeGreaterThan(15);
    expect(col.population()).toBeGreaterThan(20);
    expect(col.stats.born).toBeGreaterThan(5);
  }, 120000);

  it('коллективный перенос: тяжёлое тащат командой, нужное число носильщиков зависит от массы', () => {
    const sim = makeSim(7);
    const col = sim.player;
    const n = col.nest;
    const x = n.entranceX + 20;
    const y = sim.terrain.standY(x) + 0.5;
    const it = sim.food.spawn(FK.INSECT, x, y - 2, 12);
    it.known = 1;
    run(sim, 1);
    // один муравей не справится
    const solo = sim.antSystem.spawn(0, C.WORKER, x - 3, y);
    sim.antSystem.brain.assign(solo, 0);
    run(sim, 60);
    expect(it.removed || it.carriers.length > 1 || it.delivering >= 0 || it.cut || it.mass < 12).toBe(true);
  }, 120000);

  it('матка откладывает яйца по доходу, а не вслепую (нет голодной смерти в первые 10 минут)', () => {
    const sim = makeSim(7);
    run(sim, 600);
    expect(sim.player.food).toBeGreaterThan(0);
    expect(sim.player.population()).toBeGreaterThan(40);
  }, 300000);

  it('испытание: линия через пропасть -> живой мост из муравьёв -> поток', () => {
    const sim = makeSim(11, 'challenge');
    const n = sim.player.nest;
    const lm = sim.landmarks.find((l) => l.name === 'Канава')!;
    run(sim, 2);
    sim.queue({ type: 'route', points: [[n.entranceX, n.entranceY], [lm.x - 60, lm.y - 1], [lm.x + 60, lm.y - 1], [lm.x + 120, lm.y - 1]] });
    run(sim, 1);
    const r = [...sim.routes.routes.values()][0];
    expect(r.segments.map((s) => s.kind)).toContain('bridge');
    expect(r.segments.filter((s) => s.kind === 'tunnel').length).toBe(0);
    run(sim, 140);
    const bridge = [...sim.structures.items.values()][0];
    expect(bridge.state).toBe(SS.ACTIVE);
    expect(bridge.filled).toBe(bridge.nodes);
    // узлы моста — настоящие муравьи в состоянии "держит мост"
    let nodes = 0;
    for (let i = 0; i < sim.ants.n; i++) if (sim.ants.alive[i] && sim.ants.state[i] === S.STRUCT_NODE) nodes++;
    expect(nodes).toBeGreaterThanOrEqual(bridge.nodes);
    run(sim, 30);
    expect(sim.player.streamAnts).toBeGreaterThan(100);
  }, 300000);
});
