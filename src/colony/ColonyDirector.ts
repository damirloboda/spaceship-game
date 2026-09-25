import { S } from '../ants/AntStore';
import { C, T } from '../ants/Castes';
import { BPK, JK } from '../construction/ConstructionSystem';
import { SS } from '../construction/LivingStructures';
import { FOOD_KINDS } from '../food/FoodTypes';
import { P } from '../pheromone/PheromoneField';
import { ROOM } from '../procgen/WorldGenerator';
import { IS_SOLID, M } from '../world/Materials';
import { F_NEST } from '../world/Terrain';
import { RP } from '../swarm/Routes';
import type { Simulation } from '../sim/Simulation';
import { Colony } from './Colony';
import { ROOM_NAMES } from './Nest';

/**
 * Директор колонии связывает "мысль" колонии с миром: собирает стимулы из
 * реального состояния (еда, стройки, угрозы, конструкции, маршруты), выпускает
 * жителей гнезда наружу агентами, кормит выводок, следит за затоплением и
 * обвалами, планирует новые комнаты и укрепления.
 */
export class ColonyDirector {
  private mindT = 0;
  private planT = 0;
  private floodT = 0;
  private fieldT = 0;
  private carryT = 99;
  private lastCrackNote = -1e9;
  private rivalT = 0;
  private stressedQueue: [number, number][] = [];
  private debrisQueue: [number, number][] = [];
  pendingRoomBp = -1;
  pendingRoomType = -1;
  sealBp = -1;
  sealCells: [number, number][] = [];

  constructor(private sim: Simulation, readonly col: Colony) {}

  onStressed(x: number, y: number): void {
    const t = this.sim.terrain;
    const n = this.col.nest;
    // только своё гнездо: флаг F_NEST общий для всех колоний
    if (Math.hypot(x - n.entranceX, y - n.entranceY) > 140) return;
    // только рядом с гнездом/ходами колонии
    let nearNest = false;
    for (let dy = -3; dy <= 3 && !nearNest; dy++) for (let dx = -3; dx <= 3 && !nearNest; dx++) if (t.inBounds(x + dx, y + dy) && t.flags[(y + dy) * t.W + x + dx] & F_NEST) nearNest = true;
    if (nearNest) this.stressedQueue.push([x, y]);
  }

  onCollapse(x: number, y: number): void {
    const col = this.col;
    const sim = this.sim;
    col.pher.splash(P.DANGER, x, y, 12, 8, sim.time);
    col.memory.addDanger(x, y, 2);
    if (Math.hypot(x - col.nest.entranceX, y - col.nest.entranceY) < 120) this.debrisQueue.push([Math.round(x), Math.round(y)]);
    // выводок в заваленной комнате
    for (const r of col.nest.rooms) {
      if (x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.y0 - 3 && y <= r.y1 + 2) {
        const lost = col.brood.lose(r.id, 0.15);
        if (lost > 0 && col.isPlayer) sim.bus.emit({ type: 'notice', text: `Обвал в комнате «${ROOM_NAMES[r.type]}»: потеряно ${lost} личинок`, x, y, tone: 'bad' });
      }
    }
  }

  update(dt: number): void {
    const sim = this.sim;
    const col = this.col;
    // поле пути домой: перестраивается, когда мир изменился
    this.fieldT += dt;
    const f = col.nest.field;
    if (f.isBuilding) f.step(90000);
    else if (f.builtVersion !== sim.nav.version && this.fieldT > 2.5) {
      this.fieldT = 0;
      f.begin(col.nest.homeSources());
      f.step(90000);
    }

    // поле переноски груза
    const cf = col.nest.carry;
    if (cf.isBuilding) cf.step(60000);
    else if (cf.builtVersion !== sim.nav.version && this.carryT > 3) {
      this.carryT = 0;
      cf.begin(col.nest.carrySources());
      cf.step(60000);
    }
    this.carryT += dt;

    this.mindT += dt;
    if (this.mindT >= 0.5) {
      this.think(this.mindT);
      this.dispatch();
      this.mindT = 0;
    }
    this.lifeCycle(dt);
    this.floodT += dt;
    if (this.floodT > 1) { this.floodCheck(); col.sampleIncome(this.floodT); this.floodT = 0; }
    this.planT += dt;
    if (this.planT > 3) { this.plan(); this.planT = 0; }
    if (!col.isPlayer) {
      this.rivalT += dt;
      if (this.rivalT > 10) { this.rivalAI(); this.rivalT = 0; }
    }
  }

  private think(dt: number): void {
    const sim = this.sim;
    const col = this.col;
    let structDemand = 0;
    for (const s of sim.structures.items.values()) if (s.colony === col.id && s.state === SS.FORMING) structDemand += sim.structures.demand(s) + s.joiners;
    let haul = 0;
    let known = 0;
    const bit = 1 << col.id;
    for (const it of sim.food.items) {
      if (it.removed || !(it.known & bit) || it.attached) continue;
      if (FOOD_KINDS[it.kind].resource) continue;
      known += it.mass;
      if (it.hauler < 0 || it.hauler === col.id) haul += Math.max(0, it.need - it.carriers.length);
    }
    let routeFood = 0;
    let routeExplore = 0;
    for (const r of sim.routes.routes.values()) {
      if (r.colony !== col.id) continue;
      // спрос маршрута: базовый + по оценке (обучение)
      const base = r.player ? 8 + col.evo.level * 4 : 4;
      r.demand = Math.round(base * Math.min(3, r.score) * (r.purpose === RP.ATTACK ? 1.5 : 1));
      if (r.purpose === RP.FOOD) routeFood += Math.max(0, r.demand - r.assigned);
      else if (r.purpose === RP.EXPLORE) routeExplore += Math.max(0, r.demand - r.assigned);
      else if (r.purpose === RP.ATTACK) col.addThreat('creature', -r.id, r.endX, r.endY, 1, sim.time);
    }
    for (const b of col.beacons) {
      if (b.kind === 1) col.addThreat('creature', -1000 - b.id, b.x, b.y, 2, sim.time, true);
    }
    col.beacons = col.beacons.filter((b) => sim.time < b.until);
    const farms = col.nest.roomsOf(ROOM.FARM).length;
    const cap = Math.min(sim.mode.agentCap ?? 1e9, sim.mode.creative ? 1e9 : sim.settings.agentCap);
    col.agentBudget = col.isPlayer ? Math.min(cap, (2500 + col.evo.level * 1200) * (col.evo.has('streams') ? 2 : 1)) : Math.min(cap / 4, 900);
    col.think({
      time: sim.time,
      openBuild: sim.construction.workableCount(col.id),
      structDemand,
      stressed: this.stressedQueue.length,
      haulDemand: haul,
      routeFoodDemand: routeFood,
      routeExploreDemand: routeExplore + col.beacons.filter((b) => b.kind === 0).length * 6,
      knownFoodMass: known,
      farmNeed: farms > 0 ? Math.max(0, 1 - col.leaves / 120) : 0,
      maxAgents: col.agentBudget,
    });
    void dt;
  }

  /** Выпустить жителей гнезда наружу под текущие потребности. */
  private dispatch(): void {
    const sim = this.sim;
    const col = this.col;
    if (col.nest.sealed && sim.weather.rain > 0.4) return;
    const pop = col.population();
    let room = col.agentBudget - col.agents;
    const rate = Math.max(2, Math.round(pop * 0.015));
    const order = [T.DEFENSE, T.BUILD, T.FOOD, T.EXPLORE, T.RESOURCE];
    for (const task of order) {
      if (room <= 0) break;
      let deficit = col.desired[task] - col.agentsByTask[task];
      if (deficit <= 0) continue;
      deficit = Math.min(deficit, rate, room);
      for (let k = 0; k < deficit; k++) {
        const caste = this.casteFor(task);
        if (caste < 0) break;
        col.residents[caste]--;
        const [ex, ey] = this.exitPoint();
        const id = sim.antSystem.spawn(col.id, caste, ex, ey);
        sim.ants.energy[id] = 1;
        sim.antSystem.brain.assign(id, task);
        room--;
      }
    }
  }

  private casteFor(task: number): number {
    const r = this.col.residents;
    const pref: number[] =
      task === T.DEFENSE ? [C.SOLDIER, C.WORKER, C.CARRIER] :
      task === T.BUILD ? [C.BUILDER, C.WORKER, C.CARRIER] :
      task === T.FOOD ? [C.CARRIER, C.WORKER, C.SCOUT, C.BUILDER] :
      task === T.EXPLORE ? [C.SCOUT, C.WORKER] :
      [C.WORKER, C.BUILDER, C.CARRIER];
    for (const c of pref) if (r[c] > 0) return c;
    for (let c = 0; c < 5; c++) if (r[c] > 0 && (task !== T.DEFENSE || c !== C.SCOUT)) return c;
    return -1;
  }

  private exitPoint(): [number, number] {
    const n = this.col.nest;
    const sim = this.sim;
    for (let k = 0; k < 8; k++) {
      const x = n.entranceX + sim.rng.irange(-1, 1);
      const y = n.entranceY + sim.rng.irange(-1, 2);
      if (sim.nav.walkable(x, y)) return [x + 0.5, y + 0.5];
    }
    return [n.entranceX + 0.5, n.entranceY + 0.5];
  }

  /** Матка, выводок, питание, голод. */
  private lifeCycle(dt: number): void {
    const sim = this.sim;
    const col = this.col;
    const mode = sim.mode;
    const pop = col.population();
    // содержание взрослых
    const upkeep = pop * 0.0003 * dt;
    if (mode.creative) col.food = Math.max(col.food, col.foodCapacity());
    const got = col.eat(upkeep);
    if (got < upkeep * 0.9 && pop > 0) {
      // голод: слабейшие жители гибнут
      const deaths = (1 - got / upkeep) * pop * 0.0015 * dt * (mode.survival ? 2 : 1);
      col.starveAcc = (col.starveAcc ?? 0) + deaths;
      while (col.starveAcc >= 1) {
        col.starveAcc -= 1;
        for (const c of [C.WORKER, C.SCOUT, C.CARRIER, C.BUILDER, C.SOLDIER]) if (col.residents[c] > 0) { col.residents[c]--; col.stats.died++; break; }
      }
    }
    // матка откладывает яйца
    if (col.queen.alive) {
      const nurseCap = Math.max(30, col.nest.capacity(ROOM.NURSERY) * 5 + 30);
      const broodTotal = col.brood.total();
      const room = broodTotal < nurseCap ? 1 : 0.15;
      // матка откладывает столько, сколько колония может прокормить:
      // ~половина дохода еды идёт на выводок (яйцо + личинка ≈ 0.65 ед.), плюс запас
      const maxRate = 0.3 * (1 + 0.35 * (col.evo.level - 1)) * col.evo.queens() * mode.eggRate;
      const reserve = pop * 0.35 + 20;
      const affordable = (col.income * 0.55) / 0.65 + Math.max(0, col.food - reserve) * 0.01;
      const foodF = col.food > 8 ? 1 : col.food / 8;
      const rate = Math.min(maxRate, Math.max(0.02, affordable)) * foodF * room * (col.isPlayer ? 1 : 0.55) * (mode.creative ? 4 : 1);
      col.brood.eggAcc += rate * dt;
      if (col.brood.eggAcc >= 1) {
        const n = Math.floor(col.brood.eggAcc);
        col.brood.eggAcc -= n;
        const cost = n * 0.35;
        if (col.food >= cost) {
          col.food -= cost;
          const nurseries = col.nest.roomsOf(ROOM.NURSERY);
          const r = nurseries.length ? nurseries[sim.rng.int(nurseries.length)] : col.nest.roomsOf(ROOM.QUEEN)[0];
          col.brood.lay(n, r ? r.id : -1);
        }
      }
    }
    const hatched = col.brood.update(dt, (need) => col.eat(need), () => col.chooseCaste(), 1);
    let born = 0;
    for (let c = 0; c < hatched.length; c++) { col.residents[c] += hatched[c]; born += hatched[c]; }
    if (born > 0) {
      col.stats.born += born;
      col.evo.add(born * 0.5);
      if (col.isPlayer) sim.bus.emit({ type: 'hatch', count: born });
    }
    // грибная ферма: листья -> еда
    const farm = col.nest.capacity(ROOM.FARM);
    if (farm > 0 && col.leaves > 0) {
      const conv = Math.min(col.leaves, farm * 0.004 * dt);
      col.leaves -= conv;
      col.store(conv * 2.5);
      for (const r of col.nest.roomsOf(ROOM.FARM)) r.stock = Math.min(1, col.leaves / 60 + 0.2);
    }
    // лаборатория: исследования
    if (col.nest.roomsOf(ROOM.LAB).length > 0) col.evo.add(dt * 0.4);
  }

  /** Затопление комнат → тревога, эвакуация выводка жителями прямо изнутри. */
  private floodCheck(): void {
    const sim = this.sim;
    const col = this.col;
    for (const r of col.nest.rooms) {
      if (!r.built) continue;
      r.water = sim.water.volumeIn(r.x0, r.y0, r.x1, r.y1);
      const flooded = r.water > r.area * 45;
      if (flooded && !r.flooded) {
        r.flooded = true;
        col.pher.splash(P.DANGER, r.cx, r.cy, 10, 6, sim.time);
        sim.bus.emit({ type: 'flood', x: r.cx, y: r.cy, roomId: r.id });
        if (col.isPlayer) sim.bus.emit({ type: 'notice', text: `Вода в комнате «${ROOM_NAMES[r.type]}» — эвакуация!`, x: r.cx, y: r.cy, tone: 'bad' });
      } else if (!flooded && r.flooded && r.water < r.area * 15) r.flooded = false;
      if (r.flooded) {
        const brood = col.brood.inRoom(r.id);
        if (brood > 0) {
          col.brood.lose(r.id, 0.01);
          const safe = col.nest.safestRoom(r.id);
          let active = 0;
          for (let i = 0; i < sim.ants.n; i++) if (sim.ants.alive[i] && sim.ants.state[i] === S.EVACUATE && sim.ants.target[i] === r.id) active++;
          const want = Math.min(12, Math.ceil(brood / 4)) - active;
          if (safe) for (let k = 0; k < want && col.residents[C.WORKER] > 0; k++) {
            col.residents[C.WORKER]--;
            const id = sim.antSystem.spawn(col.id, C.WORKER, r.cx + sim.rng.range(-2, 2), r.cy + sim.rng.range(-1, 1));
            sim.ants.state[id] = S.EVACUATE;
            sim.ants.target[id] = r.id;
            sim.ants.target2[id] = safe.id;
            sim.ants.timer[id] = 60;
            sim.ants.task[id] = T.BUILD;
          }
        }
      }
    }
  }

  /** Планировщик: комнаты, укрепления, расчистка завалов, заслон от ливня. */
  private plan(): void {
    const sim = this.sim;
    const col = this.col;
    const cons = sim.construction;
    const lvl = col.evo.level;
    if (col.priorities[T.BUILD] === 0) return;
    // 1. укрепление треснувших сводов
    if (this.stressedQueue.length > 0) {
      const cells: [number, number, number][] = [];
      const seen = new Set<number>();
      for (const [x, y] of this.stressedQueue.splice(0, 60)) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = y * sim.terrain.W + x + dx;
          if (seen.has(k)) continue;
          seen.add(k);
          cells.push([x + dx, y, JK.REINFORCE]);
        }
      }
      const bp = cons.addBlueprint(col.id, BPK.REINFORCE, cells, { priority: 3, label: 'Укрепить свод' });
      if (bp && col.isPlayer && sim.time - this.lastCrackNote > 60) {
        this.lastCrackNote = sim.time;
        sim.bus.emit({ type: 'notice', text: 'Трещины в своде — строители укрепляют', x: bp.x, y: bp.y, tone: 'info' });
      }
    }
    // 2. расчистка завалов в ходах гнезда
    if (this.debrisQueue.length > 0) {
      const cells: [number, number, number][] = [];
      const t = sim.terrain;
      for (const [cx, cy] of this.debrisQueue.splice(0, 4)) {
        for (let dy = -10; dy <= 12; dy++)
          for (let dx = -12; dx <= 12; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (!t.inBounds(x, y)) continue;
            const i = y * t.W + x;
            if (t.flags[i] & F_NEST && IS_SOLID[t.mat[i]] && t.mat[i] !== M.NESTWALL) cells.push([x, y, JK.DIG]);
          }
      }
      if (cells.length) cons.addBlueprint(col.id, BPK.DIG_AREA, cells, { priority: 3, label: 'Расчистка завала' });
    }
    // 3. заслон входа от ливня
    const n = col.nest;
    const t = sim.terrain;
    if (lvl >= 2 && sim.weather.rain > 0.6 && !n.sealed && this.sealBp < 0) {
      let wet = 0;
      for (let dy = 0; dy < 8; dy++) for (let dx = -3; dx <= 3; dx++) wet += t.water[(n.entranceY + dy) * t.W + n.entranceX + dx] || 0;
      if (wet > 200) {
        const cells: [number, number, number][] = [];
        this.sealCells = [];
        for (let dx = -1; dx <= 1; dx++) {
          const x = n.entranceX + dx;
          let y = n.entranceY + 2;
          if (!IS_SOLID[t.get(x, y)]) { cells.push([x, y, JK.BUILD]); this.sealCells.push([x, y]); }
        }
        const bp = cons.addBlueprint(col.id, BPK.PLUG, cells, { priority: 4, label: 'Заслон от воды' });
        if (bp) {
          this.sealBp = bp.id;
          if (col.isPlayer) sim.bus.emit({ type: 'notice', text: 'Ливень заливает вход — муравьи строят заслон', x: n.entranceX, y: n.entranceY, tone: 'info' });
        }
      }
    }
    if (this.sealBp >= 0 && !cons.blueprints.has(this.sealBp)) { n.sealed = true; this.sealBp = -1; }
    if (n.sealed && sim.weather.rain < 0.15) {
      const cells: [number, number, number][] = this.sealCells.map(([x, y]) => [x, y, JK.DIG]);
      cons.addBlueprint(col.id, BPK.DIG_AREA, cells, { priority: 4, label: 'Открыть вход' });
      n.sealed = false;
      this.sealCells = [];
    }
    // 4. новые комнаты — колония сама решает, что и где
    if (this.pendingRoomBp >= 0 && !cons.blueprints.has(this.pendingRoomBp)) this.pendingRoomBp = -1;
    if (this.pendingRoomBp < 0) {
      const pop = col.population();
      let type = -1;
      const rooms = col.nest.rooms.filter((r) => r.built).length;
      if (col.food > col.foodCapacity() * 0.7) type = ROOM.FOOD;
      else if (col.brood.total() > col.nest.capacity(ROOM.NURSERY) * 0.9 + 10) type = ROOM.NURSERY;
      else if (lvl >= 4 && col.nest.roomsOf(ROOM.BARRACKS).length === 0) type = ROOM.BARRACKS;
      else if (lvl >= 5 && col.nest.roomsOf(ROOM.FARM).length === 0) type = ROOM.FARM;
      else if (lvl >= 7 && col.nest.roomsOf(ROOM.LAB).length === 0) type = ROOM.LAB;
      else if (lvl >= 8 && col.nest.roomsOf(ROOM.QUEEN).length < 2) type = ROOM.QUEEN;
      else if (pop > col.nest.livingCapacity() || rooms < 3 + Math.floor(pop / 45)) type = ROOM.SHELTER;
      if (type >= 0 && col.population() > 15) {
        const pr = col.roomPriority[type] ?? 1;
        if (pr > 0) {
          const plan = n.planRoom(type, sim.rng, col.evo.maxRoomWidth(), lvl);
          if (plan) {
            const cells: [number, number, number][] = plan.cells.map(([x, y]) => [x, y, JK.DIG]);
            const bp = cons.addBlueprint(col.id, BPK.ROOM, cells, { roomType: type, priority: 1 + pr * 0.5, rx: plan.rx, ry: plan.ry, label: ROOM_NAMES[type] });
            if (bp) {
              bp.x = plan.cx;
              bp.y = plan.cy;
              this.pendingRoomBp = bp.id;
              this.pendingRoomType = type;
              sim.bus.emit({ type: 'roomPlanned', roomType: type, x: plan.cx, y: plan.cy });
              if (col.isPlayer) sim.bus.emit({ type: 'notice', text: `Колония решила копать: ${ROOM_NAMES[type]}`, x: plan.cx, y: plan.cy, tone: 'info' });
            }
          }
        }
      }
    }
  }

  /** Чертёж комнаты выполнен — комната появляется в гнезде. */
  onRoomDug(bp: { roomType: number; x: number; y: number; rx: number; ry: number; id: number }): void {
    const sim = this.sim;
    const col = this.col;
    const r = col.nest.addRoom(bp.roomType, Math.round(bp.x - bp.rx), Math.round(bp.y - bp.ry), Math.round(bp.x + bp.rx), Math.round(bp.y + bp.ry), true, bp.id);
    col.evo.add(30);
    sim.bus.emit({ type: 'roomComplete', roomType: r.type, x: r.cx, y: r.cy });
    if (col.isPlayer) sim.bus.emit({ type: 'notice', text: `Готова комната: ${ROOM_NAMES[r.type]}`, x: r.cx, y: r.cy, tone: 'good' });
    // широкий свод — сразу укрепить (строители L3+)
    if (bp.rx * 2 > 9 && col.evo.has('builder')) {
      const cells: [number, number, number][] = [];
      for (let dx = -Math.floor(bp.rx); dx <= Math.floor(bp.rx); dx++) {
        const x = Math.round(bp.x + dx);
        const top = Math.round(bp.y - bp.ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (bp.rx * bp.rx)))) - 1;
        cells.push([x, top, JK.REINFORCE]);
      }
      sim.construction.addBlueprint(col.id, BPK.REINFORCE, cells, { priority: 2, label: 'Укрепить свод' });
    }
  }

  /** ИИ соперника: приоритеты и набеги. */
  private rivalAI(): void {
    const sim = this.sim;
    const col = this.col;
    col.priorities[T.FOOD] = col.hunger > 0.5 ? 3 : 2;
    col.priorities[T.DEFENSE] = col.threats.length > 0 ? 3 : 1;
    col.priorities[T.EXPLORE] = 2;
    col.priorities[T.BUILD] = 2;
    const player = sim.colonies[0];
    if (!player) return;
    const pop = col.population();
    // набег: ночью, если соседи заметно сильнее, не чаще раза в ~2 суток и не на совсем слабую колонию
    const ppop = player.population();
    const cooldown = sim.clock.dayLength * 1.8;
    if (pop > 80 && pop > ppop * 1.3 && ppop > 40 && player.evo.level >= 2 && sim.clock.isNight() && sim.time - col.lastRaid > cooldown && sim.rng.chance(0.3)) {
      col.lastRaid = sim.time;
      col.addThreat('ant', -1, player.nest.entranceX, player.nest.entranceY - 1, 2, sim.time, true);
      if (player.isPlayer) sim.bus.emit({ type: 'notice', text: 'Набег! Чужая колония идёт к гнезду', x: player.nest.entranceX, y: player.nest.entranceY, tone: 'bad' });
    }
  }
}
