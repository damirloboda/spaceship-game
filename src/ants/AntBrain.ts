import { JK } from '../construction/ConstructionSystem';
import { NODE_SPACING, SK, SS } from '../construction/LivingStructures';
import { FoodItem } from '../food/FoodSystem';
import { FOOD_KINDS, FK } from '../food/FoodTypes';
import { P } from '../pheromone/PheromoneField';
import { ROOM } from '../procgen/WorldGenerator';
import { IS_SOLID, M } from '../world/Materials';
import { F_FORBID, F_NEST } from '../world/Terrain';
import { RP } from '../swarm/Routes';
import type { Simulation } from '../sim/Simulation';
import { AF_RECRUIT, CG, S } from './AntStore';
import { TERRITORY_R } from '../colony/Colony';
import type { AntSystem } from './AntSystem';
import { C, CASTES, T } from './Castes';

/**
 * Поведение отдельного муравья (уровень 1 иерархии). Каждый муравей видит только
 * своё окружение: феромоны под ногами, запах еды рядом, поле пути домой, свою задачу.
 * "Разумность" колонии складывается из тысяч таких локальных решений.
 */
export class AntBrain {
  private d = [0, 0];
  private d2 = [0, 0];
  private tmp = [0, 0, 0];

  constructor(private sim: Simulation, private sys: AntSystem) {}

  think(i: number, dt: number): void {
    const a = this.sim.ants;
    switch (a.state[i]) {
      case S.IDLE: this.idle(i, dt); break;
      case S.EXPLORE: this.explore(i, dt); break;
      case S.FORAGE: this.forage(i, dt); break;
      case S.RETURN: this.returnHome(i, dt); break;
      case S.GOTO_ITEM: this.gotoItem(i, dt); break;
      case S.CARRY_TEAM: this.carryTeam(i, dt); break;
      case S.GOTO_JOB: this.gotoJob(i, dt); break;
      case S.DIG: this.dig(i, dt); break;
      case S.HAUL: this.haul(i, dt); break;
      case S.BUILD: this.build(i, dt); break;
      case S.STRUCT_JOIN: this.structJoin(i, dt); break;
      case S.STRUCT_NODE: this.structNode(i, dt); break;
      case S.ATTACK: this.attack(i, dt); break;
      case S.FLEE: this.fleeing(i, dt); break;
      case S.EVACUATE: this.evacuate(i, dt); break;
      case S.FALL: this.sys.fall(i, dt); break;
      case S.HOME: this.home(i, dt); break;
      case S.ROUTE: this.route(i, dt); break;
      case S.GATHER: this.gather(i, dt); break;
      case S.PATROL: this.patrol(i, dt); break;
    }
  }

  // ---------------------------------------------------------------- выбор работы

  private idle(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    // усталость — домой (станет жителем гнезда и восстановится)
    if (a.energy[i] < 0.2) { this.goHome(i); return; }
    if (a.timer[i] > 0) {
      this.sys.steer(i, 0, 0, 0.4, dt, 1.2);
      return;
    }
    a.timer[i] = 0.4 + sim.rng.next() * 0.6;
    const task = col.chooseTask(a.thr, i * 5, a.caste[i]);
    if (task < 0) {
      // работы нет: снаружи делать нечего — в гнездо
      if (sim.rng.chance(0.35)) this.goHome(i);
      return;
    }
    this.assign(i, task);
  }

  /** Назначить категорию работы и конкретную цель. */
  assign(i: number, task: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    const cid = a.colony[i];
    a.task[i] = task;
    a.stuck[i] = 0;
    a.flags[i] &= ~AF_RECRUIT;
    switch (task) {
      case T.FOOD: {
        // 1) маршрут игрока/выученный, где не хватает муравьёв
        const r = this.pickRoute(cid, a.x[i], a.y[i], (rt) => rt.purpose === RP.FOOD);
        if (r) { this.startRoute(i, r.id); return; }
        // 2) крупная еда, которой нужны носильщики
        const it = this.pickHaulItem(cid, a.x[i], a.y[i]);
        if (it) { a.state[i] = S.GOTO_ITEM; a.target[i] = it.id; a.timer[i] = 20 + Math.hypot(it.x - a.x[i], it.y - a.y[i]) / 3; a.walk[i] = 0; return; }
        // 3) по памяти / следу
        a.state[i] = S.FORAGE;
        a.target2[i] = -1;
        a.timer[i] = 45 + sim.rng.next() * 30;
        a.walk[i] = 0;
        return;
      }
      case T.BUILD: {
        const s = this.pickStructure(cid, a.x[i], a.y[i]);
        if (s) { a.state[i] = S.STRUCT_JOIN; a.target[i] = s.id; a.tx[i] = -1; a.timer[i] = 120; return; }
        const kinds = a.cargo[i] === CG.SOIL ? (1 << JK.BUILD) | (1 << JK.REINFORCE) : (1 << JK.DIG) | (1 << JK.BUILD) | (1 << JK.REINFORCE);
        const job = sim.construction.claim(cid, i, a.x[i], a.y[i], kinds, sim.time, undefined, (c) => col.nest.field.field[c] !== 65535);
        if (job) { a.state[i] = S.GOTO_JOB; a.target[i] = job.id; a.timer[i] = 90; return; }
        a.state[i] = S.IDLE;
        a.timer[i] = 1.5;
        return;
      }
      case T.DEFENSE: {
        const th = this.pickThreat(cid, a.x[i], a.y[i]);
        if (th) {
          a.state[i] = S.ATTACK;
          a.target[i] = th.kind === 'creature' ? th.ref : -1;
          a.target2[i] = th.kind === 'ant' ? th.ref : -1;
          a.tx[i] = th.x;
          a.ty[i] = th.y;
          a.timer[i] = 40;
          a.memX[i] = th.unleashed ? 1 : 0; // 1 — без поводка
          th.assigned++;
          return;
        }
        const r = this.pickRoute(cid, a.x[i], a.y[i], (rt) => rt.purpose === RP.ATTACK);
        if (r) { this.startRoute(i, r.id); return; }
        a.state[i] = S.PATROL;
        a.timer[i] = 25;
        a.tx[i] = col.nest.entranceX + sim.rng.range(-25, 25);
        a.ty[i] = col.nest.entranceY - 2;
        return;
      }
      case T.EXPLORE: {
        const r = this.pickRoute(cid, a.x[i], a.y[i], (rt) => rt.purpose === RP.EXPLORE);
        if (r) { this.startRoute(i, r.id); return; }
        this.startExplore(i);
        return;
      }
      case T.RESOURCE: {
        const r = this.pickRoute(cid, a.x[i], a.y[i], (rt) => rt.purpose === RP.RESOURCE);
        if (r) { this.startRoute(i, r.id); return; }
        a.state[i] = S.GATHER;
        a.target[i] = -1;
        a.tx[i] = -1;
        a.timer[i] = 60;
        return;
      }
    }
  }

  private startExplore(i: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    const beacon = col.beacons.find((b) => b.kind === 0);
    if (beacon && sim.rng.chance(0.7)) {
      a.state[i] = S.EXPLORE;
      a.tx[i] = beacon.x + sim.rng.range(-25, 25);
      a.ty[i] = Math.abs(beacon.y - sim.terrain.standY(a.tx[i] | 0)) < 20 ? sim.terrain.standY(a.tx[i] | 0) + 0.5 : beacon.y;
      this.setGoal(i);
      a.timer[i] = 90;
      a.walk[i] = 0;
      return;
    }
    const f = col.memory.pickFrontier(a.x[i], a.y[i], () => sim.rng.next(), (x) => sim.terrain.groundY(x | 0));
    a.state[i] = S.EXPLORE;
    a.tx[i] = f ? f[0] : a.x[i] + sim.rng.range(-120, 120);
    a.tx[i] = Math.max(4, Math.min(sim.terrain.W - 5, a.tx[i]));
    // сквозь грунт не пройти: исследуем поверхность (пещеры — по пути)
    a.ty[i] = sim.terrain.standY(a.tx[i] | 0) + 0.5;
    this.setGoal(i);
    a.timer[i] = 50 + sim.rng.next() * 40;
    a.walk[i] = 0;
  }

  private startRoute(i: number, routeId: number): void {
    const a = this.sim.ants;
    a.state[i] = S.ROUTE;
    a.target2[i] = routeId;
    // ближайшая точка маршрута
    const r = this.sim.routes.get(routeId)!;
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < r.pts.length; k += 2) {
      const d = Math.hypot(r.pts[k] - a.x[i], r.pts[k + 1] - a.y[i]);
      if (d < bd) { bd = d; best = k / 2; }
    }
    a.target[i] = best;
    a.timer[i] = 200;
    a.walk[i] = 0;
  }

  private pickRoute(colony: number, x: number, y: number, filter: (r: import('../swarm/Routes').Route) => boolean) {
    let best = null;
    let bs = -Infinity;
    for (const r of this.sim.routes.routes.values()) {
      if (r.colony !== colony || !filter(r)) continue;
      if (r.assigned >= r.demand) continue;
      const d = Math.hypot(r.pts[0] - x, r.pts[1] - y);
      const s = r.score * 10 - d * 0.02 + (r.player ? 4 : 0);
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }

  private pickHaulItem(colony: number, x: number, y: number): FoodItem | null {
    const bit = 1 << colony;
    let best: FoodItem | null = null;
    let bd = Infinity;
    for (const it of this.sim.food.items) {
      if (it.removed || !(it.known & bit) || it.attached || it.airborne || it.fails > 3) continue;
      if (it.hauler >= 0 && it.hauler !== colony) continue;
      if (FOOD_KINDS[it.kind].resource) continue;
      const have = it.carriers.length + it.assigned;
      if (have >= it.need) continue;
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  private pickStructure(colony: number, x: number, y: number) {
    let best = null;
    let bd = Infinity;
    for (const s of this.sim.structures.items.values()) {
      if (s.colony !== colony || s.state !== SS.FORMING) continue;
      if (this.sim.structures.demand(s) <= 0) continue;
      const d = Math.hypot(s.ax - x, s.ay - y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private pickThreat(colony: number, x: number, y: number) {
    const col = this.sim.colonies[colony];
    let best = null;
    let bs = Infinity;
    for (const th of col.threats) {
      const d = Math.hypot(th.x - x, th.y - y);
      const s = d + th.assigned * 8 - th.level * 20;
      if (s < bs) { bs = s; best = th; }
    }
    return best;
  }

  // ---------------------------------------------------------------- навигация

  /** Шаг к дому: поле расстояний гнезда -> след HOME -> прямо к входу. */
  private homeStep(i: number, dt: number, speed = 1): number {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    const d = this.d;
    if (col.nest.field.descend(a.x[i], a.y[i], d)) return this.sys.steer(i, d[0], d[1], speed, dt, 0.25);
    if (this.sys.pherDir(i, P.HOME, d, 0.4) > 0.05) return this.sys.steer(i, d[0], d[1], speed, dt, 0.4);
    return this.sys.steer(i, col.nest.entranceX - a.x[i], col.nest.entranceY - a.y[i], speed, dt, 0.5);
  }

  /** Движение к точке с полем потока, если оно есть (общее для всех, кто идёт туда же). */
  private navTo(i: number, key: string, tx: number, ty: number, sources: () => number[], dt: number, speed = 1): number {
    const sim = this.sim;
    const a = sim.ants;
    const d = this.d;
    const f = sim.flow.get(key, tx, ty, sources);
    if (f && f.contains(a.x[i], a.y[i]) && f.descend(a.x[i], a.y[i], d)) return this.sys.steer(i, d[0], d[1], speed, dt, 0.2);
    // вне окна поля: сначала выбраться наружу/вглубь по полю гнезда
    const col = sim.colonies[a.colony[i]];
    const inside = sim.terrain.flags[(a.y[i] | 0) * sim.terrain.W + (a.x[i] | 0)] & F_NEST;
    const targetInside = sim.terrain.flags[(ty | 0) * sim.terrain.W + (tx | 0)] & F_NEST || ty > sim.terrain.groundY(tx | 0) + 2;
    if (inside && !targetInside && col.nest.field.descend(a.x[i], a.y[i], d)) return this.sys.steer(i, d[0], d[1], speed, dt, 0.25);
    return this.sys.steer(i, tx - a.x[i], ty - a.y[i], speed, dt, 0.35);
  }

  /**
   * Подход к близкой цели по локальному полю (64x64). Если муравей вне окна
   * или клетка недостижима — прямое наведение.
   */
  private approach(i: number, key: string, tx: number, ty: number, sources: () => number[], dt: number, speed = 1): number {
    const sim = this.sim;
    const a = sim.ants;
    const d = this.d;
    const f = sim.flow.getLocal(key, tx, ty, sources, sim.time);
    if (f.contains(a.x[i], a.y[i]) && f.descend(a.x[i], a.y[i], d)) return this.sys.steer(i, d[0], d[1], speed, dt, 0.15);
    return this.sys.steer(i, tx - a.x[i], ty - a.y[i], speed, dt, 0.3);
  }

  /** Клетки вокруг точки, где можно стоять (источники локального поля). */
  private standAround(x: number, y: number, r: number): number[] {
    const sim = this.sim;
    const W = sim.terrain.W;
    const out: number[] = [];
    const R = Math.ceil(r);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > r * r + 1) continue;
        const cx = Math.floor(x) + dx;
        const cy = Math.floor(y) + dy;
        if (sim.nav.walkable(cx, cy)) out.push(cy * W + cx);
      }
    if (out.length === 0 && r < 5) return this.standAround(x, y, r + 1.5);
    if (out.length === 0) out.push(Math.floor(y) * W + Math.floor(x));
    return out;
  }

  /**
   * Муравей внутри гнезда, а цель снаружи: сначала выйти по полю "домой"
   * (оно ведёт к входу), и только потом идти к цели.
   */
  private exitNest(i: number, dt: number, tx: number, ty: number): boolean {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    const ci = (a.y[i] | 0) * t.W + (a.x[i] | 0);
    if (!(t.flags[ci] & F_NEST)) return false;
    const txi = Math.max(0, Math.min(t.W - 1, tx | 0));
    const tyi = Math.max(0, Math.min(t.H - 1, ty | 0));
    if (t.flags[tyi * t.W + txi] & F_NEST) return false;
    const col = sim.colonies[a.colony[i]];
    const d = this.d;
    if (col.nest.field.dist(a.x[i], a.y[i]) > 0 && col.nest.field.descend(a.x[i], a.y[i], d)) {
      this.sys.steer(i, d[0], d[1], 1, dt, 0.2);
      return true;
    }
    // устье хода: наружу — вверх
    this.sys.steer(i, 0, -1, 1, dt, 0.2);
    return true;
  }

  private setGoal(i: number): void {
    const a = this.sim.ants;
    a.goalD[i] = Math.hypot(a.tx[i] - a.x[i], a.ty[i] - a.y[i]);
    a.goalT[i] = 0;
    a.stuck[i] = 0;
  }

  /** Есть ли прогресс к цели (tx,ty)? Кружение на месте тоже считается застреванием. */
  private noProgress(i: number, dt: number, window = 6): boolean {
    const a = this.sim.ants;
    const d = Math.hypot(a.tx[i] - a.x[i], a.ty[i] - a.y[i]);
    a.goalT[i] += dt;
    if (d < a.goalD[i] - 3) { a.goalD[i] = d; a.goalT[i] = 0; }
    return a.goalT[i] > window;
  }

  private depositOutbound(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    const amt = Math.exp(-a.walk[i] / 140) * dt * 6;
    if (amt > 0.002) col.pher.deposit(P.HOME, a.x[i], a.y[i], amt, sim.time);
  }

  private dangerAvoid(i: number, d: number[]): boolean {
    const v = this.sys.pherDir(i, P.DANGER, this.d2, 0);
    if (v > 1.2) {
      d[0] = -this.d2[0];
      d[1] = -this.d2[1];
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- состояния

  private explore(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    if (a.timer[i] <= 0 || a.energy[i] < 0.25) { this.goHome(i); return; }
    const d = this.d;
    let dx = a.tx[i] - a.x[i];
    let dy = a.ty[i] - a.y[i];
    const l = Math.hypot(dx, dy);
    if (l < 6 || a.stuck[i] > 3 || this.noProgress(i, dt, 8)) { this.startExplore(i); return; }
    if (this.exitNest(i, dt, a.tx[i], a.ty[i])) return;
    dx /= l;
    dy /= l;
    // отталкивание от уже исследованного + от опасности
    if (this.sys.pherDir(i, P.EXPLORATION, this.d2, 0) > 1) { dx -= this.d2[0] * 0.4; dy -= this.d2[1] * 0.4; }
    if (this.dangerAvoid(i, d)) { dx = d[0]; dy = d[1]; }
    this.sys.steer(i, dx, dy, 1, dt, 0.9);
    this.depositOutbound(i, dt);
    if ((sim.tick + i) % 3 === 0) col.pher.deposit(P.EXPLORATION, a.x[i], a.y[i], dt * 3, sim.time);
    if ((sim.tick + i) % 4 === 0) this.lookForFood(i, true);
    // разведчик замечает хищников
    if ((sim.tick + i) % 20 === 0) {
      const c = sim.creatures.nearest(a.x[i], a.y[i], CASTES[a.caste[i]].sense * 2, (cr) => cr.def.role === 'predator' || cr.def.role === 'thief');
      if (c) {
        col.addThreat('creature', c.id, c.x, c.y, c.def.role === 'predator' ? 2 : 1, sim.time);
        col.memory.addDanger(c.x, c.y, 0.5);
        col.pher.deposit(P.DANGER, a.x[i], a.y[i], 3, sim.time);
      }
    }
  }

  /** Нашли еду? Маленькую — берём, большую — метим и зовём остальных. */
  private lookForFood(i: number, scouting: boolean): boolean {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    const col = sim.colonies[cid];
    const sense = CASTES[a.caste[i]].sense * (1 - sim.weather.fog * 0.4);
    const it = sim.food.sense(a.x[i], a.y[i], sense, (f) => !FOOD_KINDS[f.kind].resource && (f.hauler < 0 || f.hauler === cid) && f.delivering < 0);
    if (!it) return false;
    const bit = 1 << cid;
    if (!(it.known & bit)) {
      it.known |= bit;
      col.memory.addFood(it.x, it.y, it.mass);
      if (it.mass > 4) sim.bus.emit({ type: 'foodFound', x: it.x, y: it.y, kind: it.kind, mass: it.mass, colony: cid });
    }
    this.estimateNeed(it, cid);
    a.memX[i] = it.x;
    a.memY[i] = it.y;
    const strength = this.strength(i);
    const d = Math.hypot(it.x - a.x[i], it.y - a.y[i]);
    // маленькое, но тяжеловатое для этого муравья — откусить кусок по силам
    const smallish = it.mass < 4 && it.carriers.length === 0;
    if ((it.mass <= strength * 1.6 || smallish) && it.carriers.length === 0) {
      if (d > it.r + 1.9) {
        // подойти
        a.state[i] = S.GOTO_ITEM;
        a.target[i] = it.id;
        a.timer[i] = 30;
        return true;
      }
      const got = sim.food.take(it, strength * 1.6);
      this.pickUp(i, it.kind, got);
      return true;
    }
    // большая еда
    if (scouting && a.caste[i] === C.SCOUT) {
      // разведчик несёт образец и зовёт — по дороге домой кладёт усиленный след
      if (d <= it.r + 1.9) {
        const got = sim.food.take(it, Math.min(strength, 0.5));
        this.pickUp(i, it.kind, got);
        a.flags[i] |= AF_RECRUIT;
        return true;
      }
      a.state[i] = S.GOTO_ITEM;
      a.target[i] = it.id;
      a.timer[i] = 30;
      return true;
    }
    a.state[i] = S.GOTO_ITEM;
    a.target[i] = it.id;
    a.timer[i] = 60;
    return true;
  }

  /** Сколько муравьёв нужно предмету: команда носильщиков или резчики. */
  private estimateNeed(it: FoodItem, colony: number): void {
    const col = this.sim.colonies[colony];
    const maxC = this.sim.food.maxCarriers(it);
    const avg = col.evo.carryBonus() * (col.unlockedCaste(C.CARRIER) ? 1.6 : 1);
    const needLift = it.mass * 1.1;
    if (it.mass < 4) it.need = Math.max(1, Math.ceil(it.mass / 1.6));
    else if (needLift / avg <= maxC && !it.cut) it.need = Math.min(maxC, Math.ceil(needLift / avg) + 2);
    else {
      it.cut = true;
      it.need = Math.min(80, Math.ceil(it.mass / 1.5));
    }
  }

  strength(i: number): number {
    const a = this.sim.ants;
    const col = this.sim.colonies[a.colony[i]];
    return CASTES[a.caste[i]].strength * col.evo.carryBonus() * (0.5 + 0.5 * Math.min(1, a.energy[i] * 2));
  }

  private pickUp(i: number, kind: number, amount: number): void {
    const a = this.sim.ants;
    a.cargo[i] = FOOD_KINDS[kind].resource ? CG.RESOURCE : CG.FOOD;
    a.cargoKind[i] = kind;
    a.cargoAmt[i] = amount;
    a.state[i] = S.RETURN;
    a.walk[i] = 0;
    a.timer[i] = 120;
  }

  /**
   * Поиск еды: по следу FOOD к источнику. Если след привёл в пустое место
   * (еду унесли) — это локальный максимум без еды: муравей не подкрепляет его
   * (след гаснет — отрицательная обратная связь) и переходит к поиску по
   * расширяющимся случайным точкам вокруг.
   */
  private forage(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    if (a.timer[i] <= 0 || a.energy[i] < 0.2) { this.goHome(i); return; }
    if ((sim.tick + i) % 3 === 0 && this.lookForFood(i, false)) return;
    const d = this.d;
    if (this.exitNest(i, dt, a.memX[i] >= 0 ? a.memX[i] : col.nest.entranceX, a.memX[i] >= 0 ? a.memY[i] : col.nest.entranceY - 3)) return;
    const searching = a.target2[i] === -99;
    if (!searching) {
      const s = this.sys.pherDir(i, P.FOOD, d, 0.8);
      if (s > 0.04) {
        const here = col.pher.sample(P.FOOD, a.x[i], a.y[i]);
        // пик следа без еды — источник исчез
        if (here >= s * 0.98 && here > 0.1) {
          const ci = col.pher.cellIndex(a.x[i], a.y[i]);
          col.pher.ch[P.FOOD][ci] *= 0.4;
          this.startSearch(i, 30);
          return;
        }
        this.sys.steer(i, d[0], d[1], 1, dt, 0.35);
        this.depositOutbound(i, dt);
        return;
      }
      if (a.memX[i] >= 0) {
        const dx = a.memX[i] - a.x[i];
        const dy = a.memY[i] - a.y[i];
        if (dx * dx + dy * dy < 16) { a.memX[i] = -1; this.startSearch(i, 25); return; }
        this.approach(i, `mem${(a.memX[i] / 8) | 0}_${(a.memY[i] / 8) | 0}`, a.memX[i], a.memY[i], () => this.standAround(a.memX[i], a.memY[i], 2), dt);
        this.depositOutbound(i, dt);
        return;
      }
      this.startSearch(i, 40);
      return;
    }
    // режим поиска: к случайной точке на поверхности, радиус растёт со временем
    const dx = a.tx[i] - a.x[i];
    const dy = a.ty[i] - a.y[i];
    if (dx * dx + dy * dy < 9 || a.stuck[i] > 2.5 || this.noProgress(i, dt, 5)) {
      this.startSearch(i, Math.min(160, Math.hypot(a.x[i] - col.nest.entranceX, a.y[i] - col.nest.entranceY) + 30));
      return;
    }
    // найденный след снова важнее поиска
    if ((sim.tick + i) % 6 === 0 && this.sys.pherDir(i, P.FOOD, d, 0.8) > 0.3) { a.target2[i] = -1; return; }
    if (this.dangerAvoid(i, d)) this.sys.steer(i, d[0], d[1], 1, dt, 0.3);
    else this.sys.steer(i, dx, dy, 1, dt, 0.7);
    this.depositOutbound(i, dt);
  }

  private startSearch(i: number, radius: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    a.target2[i] = -99;
    // коррелированное блуждание: чаще продолжаем удаляться в ту же сторону (так ищут настоящие фуражиры)
    const col = sim.colonies[a.colony[i]];
    let dir = Math.sign(a.x[i] - col.nest.entranceX) || (sim.rng.next() < 0.5 ? -1 : 1);
    if (sim.rng.next() < 0.25) dir = -dir;
    const x = Math.max(3, Math.min(t.W - 4, a.x[i] + dir * sim.rng.range(radius * 0.3, radius)));
    a.tx[i] = x;
    a.ty[i] = t.standY(x) + 0.5;
    this.setGoal(i);
  }

  private returnHome(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    const col = sim.colonies[cid];
    a.timer[i] -= dt;
    this.homeStep(i, dt, 1);
    // след к еде: сильнее у источника, слабее к дому — градиент ведёт к еде
    const recruit = a.flags[i] & AF_RECRUIT ? 3.5 : 1;
    const ch = a.cargo[i] === CG.RESOURCE ? P.RESOURCE : P.FOOD;
    const amt = Math.exp(-a.walk[i] / 120) * dt * 7 * recruit;
    if (amt > 0.002) col.pher.deposit(ch, a.x[i], a.y[i], amt, sim.time);
    if (col.nest.atEntrance(a.x[i], a.y[i], 3.5) || (col.nest.field.dist(a.x[i], a.y[i]) <= 3)) {
      // доставка
      if (a.cargo[i] === CG.FOOD || a.cargo[i] === CG.RESOURCE) {
        col.addFood(a.cargoKind[i], a.cargoAmt[i]);
        sim.bus.emit({ type: 'foodDelivered', amount: a.cargoAmt[i], colony: cid });
        this.learnDelivery(i);
      }
      a.cargo[i] = CG.NONE;
      a.cargoAmt[i] = 0;
      a.flags[i] &= ~AF_RECRUIT;
      a.exp[i] += 1;
      col.learnThresholds(a.thr, i * 5, T.FOOD, 2);
      a.walk[i] = 0;
      if (a.energy[i] < 0.3) { this.goHome(i); return; }
      if (a.memX[i] >= 0) { a.state[i] = S.FORAGE; a.target2[i] = -1; a.timer[i] = 60; }
      else { a.state[i] = S.IDLE; a.timer[i] = 0; }
      return;
    }
    if (a.timer[i] < 0 && a.stuck[i] > 8) {
      // совсем заблудился: бросает крошку и отдыхает
      this.sys.dropCargo(i);
      a.state[i] = S.IDLE;
    }
  }

  /** Обучение маршрутам: частые доставки из одного места превращаются в дорогу. */
  private learnDelivery(i: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    if (a.memX[i] < 0) return;
    for (const r of sim.routes.routes.values()) {
      if (r.colony === cid && Math.hypot(r.endX - a.memX[i], r.endY - a.memY[i]) < 30) { r.deliveries++; r.lastUsed = sim.time; return; }
    }
    const col = sim.colonies[cid];
    const sec = col.memory.sector(a.memX[i], a.memY[i]);
    col.memory.food[sec] += 1;
    if (col.memory.food[sec] > 25 && Math.hypot(a.memX[i] - col.nest.entranceX, a.memY[i] - col.nest.entranceY) > 40) {
      const r = sim.routes.learnFromField(cid, a.memX[i], a.memY[i]);
      if (r) {
        r.demand = 6;
        if (col.isPlayer) sim.bus.emit({ type: 'notice', text: 'Колония выучила новую дорогу к еде', x: r.endX, y: r.endY, tone: 'good' });
      }
    }
  }

  private gotoItem(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    const it = sim.food.get(a.target[i]);
    a.timer[i] -= dt;
    if (it && !it.removed && (a.timer[i] <= 0 || a.stuck[i] > 6)) {
      it.fails += 1;
      a.memX[i] = -1;
    }
    if (!it || it.removed || a.timer[i] <= 0 || a.stuck[i] > 6 || (it.hauler >= 0 && it.hauler !== cid)) { a.state[i] = S.IDLE; a.timer[i] = 0; return; }
    const dx = it.x - a.x[i];
    const dy = it.y - a.y[i];
    const dist = Math.hypot(dx, dy);
    if (dist <= it.r + 1.9) {
      const strength = this.strength(i);
      if ((it.mass <= strength * 1.6 || it.mass < 4) && it.carriers.length === 0) {
        const got = sim.food.take(it, strength * 1.6);
        this.pickUp(i, it.kind, got);
        return;
      }
      if (it.delivering >= 0) { a.state[i] = S.IDLE; return; }
      // команда уже достаточна — не толпимся, ищем другую работу
      if (!it.cut && it.carriers.length > 0 && it.carriers.length >= it.need && it.lift >= it.mass * 1.1) { a.state[i] = S.FORAGE; a.target2[i] = -1; a.timer[i] = 30; a.memX[i] = -1; return; }
      if (it.cut || it.carriers.length >= sim.food.maxCarriers(it)) {
        // режем: откусываем кусок по силам
        const got = sim.food.take(it, strength);
        this.pickUp(i, it.kind, got);
        return;
      }
      it.carriers.push(i);
      it.hauler = cid;
      a.state[i] = S.CARRY_TEAM;
      a.target[i] = it.id;
      a.timer[i] = 0;
      return;
    }
    if (this.exitNest(i, dt, it.x, it.y)) return;
    if (dist < 28) this.approach(i, `li${it.id}_${(it.x / 4) | 0}_${(it.y / 4) | 0}`, it.x, it.y, () => this.standAround(it.x, it.y, it.r + 1.6), dt);
    else {
      const d = this.d;
      if (this.sys.pherDir(i, P.FOOD, d, 0.7) > 0.05) this.sys.steer(i, d[0] + dx / dist * 0.5, d[1] + dy / dist * 0.5, 1, dt, 0.3);
      else this.navTo(i, `it${it.id}_${(it.x / 16) | 0}_${(it.y / 16) | 0}`, it.x, it.y + it.r, () => {
        const W = sim.terrain.W;
        const out: number[] = [];
        for (let k = -Math.ceil(it.r) - 1; k <= Math.ceil(it.r) + 1; k++) {
          const x = Math.floor(it.x + k);
          const y = Math.floor(it.y + it.r * 0.5);
          for (let dy2 = -2; dy2 <= 2; dy2++) if (sim.nav.walkable(x, y + dy2)) out.push((y + dy2) * W + x);
        }
        return out;
      }, dt);
    }
    this.depositOutbound(i, dt);
  }

  private carryTeam(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const it = sim.food.get(a.target[i]);
    if (!it || it.removed) { a.state[i] = S.IDLE; a.timer[i] = 0; return; }
    const slot = it.carriers.indexOf(i);
    if (slot < 0) { a.state[i] = S.IDLE; return; }
    const p = this.tmp;
    sim.food.slotPos(it, slot, p);
    a.x[i] += (p[0] - a.x[i]) * Math.min(1, dt * 12);
    a.y[i] += (p[1] - a.y[i]) * Math.min(1, dt * 12);
    // носильщики смотрят в сторону движения, лапки работают, только если предмет едет
    if (it.moving) {
      a.heading[i] = Math.atan2(it.dirY, it.dirX);
      a.anim[i] += dt * 7;
    } else {
      a.heading[i] = Math.atan2(it.y - a.y[i], it.x - a.x[i]);
      a.anim[i] += dt * 2;
    }
    const col = sim.colonies[a.colony[i]];
    if ((sim.tick + i) % 4 === 0) col.pher.deposit(P.FOOD, a.x[i], a.y[i], dt * 12, sim.time);
    if (it.cut || a.energy[i] < 0.1) {
      this.leave(i);
      if (it.cut && !it.removed) {
        const got = sim.food.take(it, this.strength(i));
        this.pickUp(i, it.kind, got);
      } else this.goHome(i);
    }
  }

  private gotoJob(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const job = sim.construction.jobs.get(a.target[i]);
    a.timer[i] -= dt;
    if (!job || job.done || job.claimed !== i || a.timer[i] <= 0 || a.stuck[i] > 6) {
      if (job && job.claimed === i) sim.construction.release(job.id);
      a.state[i] = a.cargo[i] === CG.SOIL ? S.HAUL : S.IDLE;
      a.target[i] = -1;
      a.target2[i] = -1;
      a.timer[i] = 0;
      return;
    }
    const dx = job.x + 0.5 - a.x[i];
    const dy = job.y + 0.5 - a.y[i];
    const dist = Math.hypot(dx, dy);
    if (dist < 1.7) {
      if (job.kind === JK.DIG) { a.state[i] = S.DIG; a.timer[i] = 30; return; }
      if (a.cargo[i] === CG.SOIL) { a.state[i] = S.BUILD; a.timer[i] = 0.7; return; }
      // нужен материал: найти рядом и накопать
      const m = sim.construction.findMaterial(job.x, job.y, 14);
      if (!m) { sim.construction.release(job.id); a.state[i] = S.IDLE; return; }
      a.target2[i] = job.id;
      a.tx[i] = m[0];
      a.ty[i] = m[1];
      a.target[i] = -1;
      a.state[i] = S.DIG;
      a.timer[i] = 30;
      return;
    }
    const bp = sim.construction.blueprints.get(job.bp);
    // поле потока ведёт до самой точки работы (в обход укреплённых стен), прямо — только вплотную
    if (bp && dist > 2.5) this.navTo(i, `bp${bp.id}`, bp.x, bp.y, () => sim.construction.frontierCells(bp.id), dt);
    else this.sys.steer(i, dx, dy, 1, dt, 0.25);
    const col = sim.colonies[a.colony[i]];
    if (dist < 12 && (sim.tick + i) % 8 === 0) col.pher.deposit(P.BUILD, job.x, job.y, 1, sim.time);
  }

  private dig(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    const col = sim.colonies[cid];
    a.timer[i] -= dt;
    const power = CASTES[a.caste[i]].dig * (0.6 + 0.4 * a.energy[i]);
    a.dirt[i] = Math.min(255, a.dirt[i] + dt * 4);
    a.anim[i] += dt * 9;
    if (a.target[i] >= 0) {
      const job = sim.construction.jobs.get(a.target[i]);
      if (!job || job.done || a.timer[i] <= 0) { a.state[i] = S.IDLE; a.target[i] = -1; return; }
      a.heading[i] = Math.atan2(job.y + 0.5 - a.y[i], job.x + 0.5 - a.x[i]);
      const r = sim.construction.dig(job, power, dt);
      if (r >= 0) {
        col.stats.dug++;
        col.evo.add(0.3);
        col.learnThresholds(a.thr, i * 5, T.BUILD, 2);
        a.cargo[i] = CG.SOIL;
        a.cargoKind[i] = r;
        a.cargoAmt[i] = 1;
        a.state[i] = S.HAUL;
        a.target[i] = -1;
        a.target2[i] = -1;
        a.timer[i] = 90;
        sim.particles?.dig(job.x + 0.5, job.y + 0.5, r);
      } else if (r === -2) { a.state[i] = S.IDLE; a.target[i] = -1; }
      return;
    }
    // добыча материала для стройки (не по чертежу)
    const x = a.tx[i] | 0;
    const y = a.ty[i] | 0;
    const t = sim.terrain;
    const m = t.get(x, y);
    if (!IS_SOLID[m] || a.timer[i] <= 0) { a.state[i] = S.IDLE; a.target2[i] = -1; return; }
    const dist = Math.hypot(x + 0.5 - a.x[i], y + 0.5 - a.y[i]);
    if (dist > 1.8) { this.sys.steer(i, x + 0.5 - a.x[i], y + 0.5 - a.y[i], 1, dt, 0.3); a.anim[i] -= dt * 9; return; }
    a.heading[i] = Math.atan2(y + 0.5 - a.y[i], x + 0.5 - a.x[i]);
    const idx = y * t.W + x;
    const hard = m === M.LOOSE ? 0.3 : 1.2;
    const hp = t.hp[idx] - (power * dt * 255) / hard;
    if (hp <= 0) {
      t.set(x, y, M.AIR);
      a.cargo[i] = CG.SOIL;
      a.cargoKind[i] = m === M.CLAY ? M.CLAY : M.LOOSE;
      a.cargoAmt[i] = 1;
      a.state[i] = S.HAUL;
      a.timer[i] = 90;
      sim.particles?.dig(x + 0.5, y + 0.5, m);
    } else {
      t.hp[idx] = hp;
      t.renderDirty.markCell(x, y);
    }
  }

  private haul(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const cid = a.colony[i];
    const col = sim.colonies[cid];
    a.timer[i] -= dt;
    // 1) несём к конкретной стройке, для которой добывали
    if (a.target2[i] >= 0) {
      const job = sim.construction.jobs.get(a.target2[i]);
      if (job && !job.done) {
        job.claimed = i;
        a.target[i] = job.id;
        a.target2[i] = -1;
        a.state[i] = S.GOTO_JOB;
        a.timer[i] = 60;
        return;
      }
      a.target2[i] = -1;
    }
    // 2) ближайшая стройка, которой нужен материал
    if (a.tx[i] !== -7 && (sim.tick + i) % 5 === 0) {
      const job = sim.construction.claim(cid, i, a.x[i], a.y[i], (1 << JK.BUILD) | (1 << JK.REINFORCE), sim.time, undefined, (c) => col.nest.field.field[c] !== 65535);
      if (job && Math.hypot(job.x - a.x[i], job.y - a.y[i]) < 90) {
        a.target[i] = job.id;
        a.state[i] = S.GOTO_JOB;
        a.timer[i] = 60;
        return;
      }
      if (job) sim.construction.release(job.id);
      a.tx[i] = -7; // метка: ищем отвал
      const spot = col.nest.dumpSpot(sim.rng);
      a.memX[i] = spot[0];
      a.memY[i] = spot[1];
    }
    if (a.tx[i] !== -7) { this.homeStep(i, dt); return; }
    // 3) вынести наружу, в отвал у входа
    const inNest = col.nest.field.dist(a.x[i], a.y[i]);
    const underground = a.y[i] > sim.terrain.groundY(a.x[i] | 0) + 1;
    if (underground && inNest > 3 && inNest !== 65535) { this.homeStep(i, dt); return; }
    const dx = a.memX[i] + 0.5 - a.x[i];
    const dy = a.memY[i] + 0.5 - a.y[i];
    if (Math.hypot(dx, dy) < 2.2 || a.timer[i] <= 0) {
      this.dropSoil(i, a.memX[i], a.memY[i]);
      a.tx[i] = 0;
      a.state[i] = S.IDLE;
      a.timer[i] = 0;
      col.evo.add(0.1);
      return;
    }
    this.sys.steer(i, dx, dy, 1, dt, 0.3);
  }

  private dropSoil(i: number, x: number, y: number): void {
    const sim = this.sim;
    const t = sim.terrain;
    const a = sim.ants;
    let yy = Math.min(y, t.H - 2);
    while (yy > 1 && IS_SOLID[t.get(x, yy)]) yy--;
    while (yy < t.H - 2 && !IS_SOLID[t.get(x, yy + 1)]) yy++;
    if (!IS_SOLID[t.get(x, yy)] && !(t.flags[yy * t.W + x] & F_NEST) && Math.abs(yy - a.y[i]) < 8) t.set(x, yy, M.LOOSE);
    a.cargo[i] = CG.NONE;
    a.cargoAmt[i] = 0;
  }

  private build(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    const job = sim.construction.jobs.get(a.target[i]);
    a.timer[i] -= dt * CASTES[a.caste[i]].build;
    a.anim[i] += dt * 6;
    if (!job || job.done) { a.state[i] = a.cargo[i] === CG.SOIL ? S.HAUL : S.IDLE; a.target[i] = -1; return; }
    a.heading[i] = Math.atan2(job.y + 0.5 - a.y[i], job.x + 0.5 - a.x[i]);
    if (a.timer[i] > 0) return;
    // не замуровать себя и других
    if (job.kind === JK.BUILD) {
      let blocked = false;
      sim.antHash.query(job.x + 0.5, job.y + 0.5, 0.8, (j) => { if ((sim.ants.x[j] | 0) === job.x && (sim.ants.y[j] | 0) === job.y) blocked = true; });
      if (blocked) { a.timer[i] = 0.3; return; }
    }
    if (sim.construction.place(job, a.cargoKind[i])) {
      col.stats.built++;
      col.evo.add(0.5);
      col.learnThresholds(a.thr, i * 5, T.BUILD, 2);
    }
    a.cargo[i] = CG.NONE;
    a.cargoAmt[i] = 0;
    a.state[i] = S.IDLE;
    a.target[i] = -1;
    a.timer[i] = 0;
  }

  private structJoin(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const s = sim.structures.get(a.target[i]);
    a.timer[i] -= dt;
    if (!s || s.state !== SS.FORMING || a.timer[i] <= 0) { a.state[i] = S.IDLE; a.timer[i] = 0; return; }
    if (a.tx[i] < 0) {
      // фаза 1: дойти до якоря
      const dx = s.ax - a.x[i];
      const dy = s.ay - a.y[i];
      if (dx * dx + dy * dy < 2.2) { a.tx[i] = 0; return; }
      if (dx * dx + dy * dy > 36) this.navTo(i, `st${s.id}`, s.ax, s.ay, () => {
        const W = sim.terrain.W;
        const out: number[] = [];
        for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) if (sim.nav.walkable((s.ax | 0) + xx, (s.ay | 0) + yy)) out.push(((s.ay | 0) + yy) * W + (s.ax | 0) + xx);
        return out;
      }, dt);
      else this.sys.steer(i, dx, dy, 1, dt, 0.15);
      if (a.stuck[i] > 5) { a.state[i] = S.IDLE; a.timer[i] = 2; }
      return;
    }
    // фаза 2: идти по телам уже сцепившихся к концу цепи
    const tip = s.filled - 1;
    if (tip < 0) {
      const k = sim.structures.lock(s, i, sim.time);
      if (k >= 0) this.becomeNode(i, s.id, k);
      return;
    }
    const speed = CASTES[a.caste[i]].speed * 0.7;
    a.tx[i] = Math.min(tip, a.tx[i] + (speed * dt) / NODE_SPACING);
    const k0 = Math.floor(a.tx[i]);
    const k1 = Math.min(tip, k0 + 1);
    const u = a.tx[i] - k0;
    const nx = s.cx[k0] + (s.cx[k1] - s.cx[k0]) * u;
    const ny = s.cy[k0] + (s.cy[k1] - s.cy[k0]) * u - 0.35;
    a.heading[i] = Math.atan2(ny - a.y[i], nx - a.x[i]);
    a.x[i] = nx;
    a.y[i] = ny;
    a.anim[i] += speed * dt * 2.2;
    if (a.tx[i] >= tip - 0.01) {
      const k = sim.structures.lock(s, i, sim.time);
      if (k >= 0) this.becomeNode(i, s.id, k);
      else a.state[i] = S.IDLE;
    }
  }

  private becomeNode(i: number, sid: number, k: number): void {
    const sim = this.sim;
    const a = sim.ants;
    a.state[i] = S.STRUCT_NODE;
    a.target[i] = sid;
    a.target2[i] = k;
    const col = sim.colonies[a.colony[i]];
    col.evo.add(0.4);
    col.learnThresholds(a.thr, i * 5, T.BUILD, 3);
  }

  private structNode(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const s = sim.structures.get(a.target[i]);
    const k = a.target2[i];
    if (!s || k < 0 || k >= s.nodes || s.nodeAnt[k] !== i) {
      a.state[i] = S.FALL;
      a.prevState[i] = S.IDLE;
      a.vy[i] = 0;
      return;
    }
    a.x[i] = s.cx[k];
    a.y[i] = s.cy[k];
    const k2 = Math.min(s.nodes - 1, k + 1);
    const k1 = Math.max(0, k - 1);
    a.heading[i] = Math.atan2(s.cy[k2] - s.cy[k1], s.cx[k2] - s.cx[k1]) + (s.kind === SK.BRIDGE ? 0 : 0);
    a.anim[i] += dt * 0.5;
  }

  private attack(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    if (a.timer[i] <= 0 || a.health[i] < 0.25) { this.flee(i); return; }
    let tx = a.tx[i];
    let ty = a.ty[i];
    let r = 1.2;
    let alive = false;
    if (a.target[i] >= 0) {
      const c = sim.creatures.get(a.target[i]);
      if (c && c.alive && c.dying === 0) { tx = c.x; ty = c.y; r = c.def.radius + 1.3; alive = true; }
    } else if (a.target2[i] >= 0) {
      const e = a.target2[i];
      if (a.alive[e] && a.state[e] !== S.DYING && a.colony[e] !== a.colony[i]) { tx = a.x[e]; ty = a.y[e]; alive = true; }
    }
    if (!alive) {
      // цели нет или это точка (метка/набег): идём туда и ищем врага на месте
      const dxp = a.tx[i] - a.x[i];
      const dyp = a.ty[i] - a.y[i];
      if (dxp * dxp + dyp * dyp > 64) {
        this.sys.steer(i, dxp, dyp, 1.1, dt, 0.3);
        return;
      }
      const c = sim.creatures.nearest(a.x[i], a.y[i], 14, (cr) => cr.kind !== 4);
      if (c) { a.target[i] = c.id; a.target2[i] = -1; return; }
      let enemy = -1;
      sim.antHash.query(a.x[i], a.y[i], 12, (j) => { if (enemy < 0 && a.colony[j] !== a.colony[i] && a.state[j] !== S.DYING) enemy = j; });
      if (enemy >= 0) { a.target2[i] = enemy; a.target[i] = -1; return; }
      const d = this.d;
      if (this.sys.pherDir(i, P.ATTACK, d, 0.3) > 0.5) { this.sys.steer(i, d[0], d[1], 1.1, dt, 0.3); return; }
      a.state[i] = S.PATROL;
      a.timer[i] = 15;
      return;
    }
    a.tx[i] = tx;
    a.ty[i] = ty;
    // поводок: оборона не уходит в погоню за пределы своей территории
    if (a.memX[i] !== 1 && Math.hypot(tx - col.nest.entranceX, ty - col.nest.entranceY) > TERRITORY_R) {
      a.state[i] = S.PATROL;
      a.timer[i] = 10;
      a.tx[i] = col.nest.entranceX;
      a.ty[i] = col.nest.entranceY - 1;
      return;
    }
    const dx = tx - a.x[i];
    const dy = ty - a.y[i];
    const dist = Math.hypot(dx, dy);
    if (dist <= r) {
      const dmg = CASTES[a.caste[i]].attack * dt * (a.caste[i] === C.SOLDIER ? 1.4 : 1);
      if (a.target[i] >= 0) {
        const c = sim.creatures.get(a.target[i])!;
        sim.creatures.damage(c, dmg, i);
      }
      a.heading[i] = Math.atan2(dy, dx);
      a.anim[i] += dt * 10;
      col.pher.deposit(P.ATTACK, a.x[i], a.y[i], dt * 12, sim.time);
      return;
    }
    if (dist > 40) this.navTo(i, `atk${(tx / 24) | 0}_${(ty / 24) | 0}`, tx, ty, () => {
      const W = sim.terrain.W;
      const out: number[] = [];
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) if (sim.nav.walkable((tx | 0) + xx, (ty | 0) + yy)) out.push(((ty | 0) + yy) * W + (tx | 0) + xx);
      return out;
    }, dt, 1.15);
    else this.sys.steer(i, dx, dy, 1.15, dt, 0.2);
  }

  flee(i: number): void {
    const a = this.sim.ants;
    if (a.state[i] === S.STRUCT_NODE || a.state[i] === S.CARRY_TEAM) return;
    this.leave(i);
    a.state[i] = S.FLEE;
    a.timer[i] = 4;
  }

  private fleeing(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    a.timer[i] -= dt;
    const d = this.d;
    if (this.sys.pherDir(i, P.DANGER, d, 0) > 0.2) this.sys.steer(i, -d[0], -d[1], 1.2, dt, 0.4);
    else this.homeStep(i, dt, 1.2);
    const col = sim.colonies[a.colony[i]];
    col.pher.deposit(P.RETREAT, a.x[i], a.y[i], dt * 3, sim.time);
    if (a.timer[i] <= 0) { a.state[i] = a.cargo[i] === CG.FOOD ? S.RETURN : S.IDLE; a.timer[i] = 30; }
  }

  private evacuate(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    const from = col.nest.room(a.target[i]);
    const to = col.nest.room(a.target2[i]);
    if (!from || !to || a.timer[i] <= 0) { a.state[i] = S.IDLE; a.cargo[i] = CG.NONE; return; }
    const goal = a.cargo[i] === CG.LARVA ? to : from;
    const dx = goal.cx - a.x[i];
    const dy = goal.cy - a.y[i];
    if (dx * dx + dy * dy < 6) {
      if (a.cargo[i] === CG.LARVA) {
        col.brood.moveRoom(from.id, to.id, Math.round(a.cargoAmt[i]));
        a.cargo[i] = CG.NONE;
        a.cargoAmt[i] = 0;
        col.evo.add(1);
        if (col.brood.inRoom(from.id) <= 0) { a.state[i] = S.IDLE; return; }
      } else {
        const n = Math.min(4, col.brood.inRoom(from.id));
        if (n <= 0) { a.state[i] = S.IDLE; return; }
        a.cargo[i] = CG.LARVA;
        a.cargoAmt[i] = n;
      }
      return;
    }
    this.navTo(i, `room${goal.id}`, goal.cx, goal.cy, () => {
      const W = sim.terrain.W;
      const out: number[] = [];
      for (let y = goal.y0; y <= goal.y1; y++) for (let x = goal.x0; x <= goal.x1; x++) if (sim.nav.walkable(x, y)) out.push(y * W + x);
      return out;
    }, dt, 1.1);
  }

  goHome(i: number): void {
    const a = this.sim.ants;
    this.leave(i);
    a.state[i] = S.HOME;
    a.timer[i] = 120;
  }

  private home(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    this.homeStep(i, dt, 1);
    if (col.nest.atEntrance(a.x[i], a.y[i], 3.5) || col.nest.field.dist(a.x[i], a.y[i]) <= 3 || a.timer[i] <= 0) {
      if (a.cargo[i] === CG.FOOD || a.cargo[i] === CG.RESOURCE) col.addFood(a.cargoKind[i], a.cargoAmt[i]);
      // становится жителем гнезда (уровень "секций": дешёвая абстракция)
      col.residents[a.caste[i]]++;
      a.kill(i);
    }
  }

  private route(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const r = sim.routes.get(a.target2[i]);
    a.timer[i] -= dt;
    if (!r || a.timer[i] <= 0 || a.energy[i] < 0.2) { a.state[i] = S.IDLE; a.timer[i] = 0; if (a.energy[i] < 0.2) this.goHome(i); return; }
    r.lastUsed = sim.time;
    const npts = r.pts.length / 2;
    let k = a.target[i];
    if (k >= npts) {
      // дошли до цели — выполняем назначение маршрута
      a.memX[i] = r.endX;
      a.memY[i] = r.endY;
      switch (r.purpose) {
        case RP.FOOD: a.state[i] = S.FORAGE; a.target2[i] = -1; a.timer[i] = 40; a.task[i] = T.FOOD; break;
        case RP.ATTACK: {
          const c = sim.creatures.nearest(r.endX, r.endY, 40);
          if (c) { a.state[i] = S.ATTACK; a.target[i] = c.id; a.target2[i] = -1; a.timer[i] = 30; a.task[i] = T.DEFENSE; }
          else { a.state[i] = S.PATROL; a.timer[i] = 20; a.tx[i] = r.endX; a.ty[i] = r.endY; }
          break;
        }
        case RP.RESOURCE: a.state[i] = S.GATHER; a.target[i] = -1; a.tx[i] = -1; a.timer[i] = 40; a.task[i] = T.RESOURCE; break;
        default: a.state[i] = S.EXPLORE; a.tx[i] = r.endX + sim.rng.range(-40, 40); a.ty[i] = r.endY; a.timer[i] = 40; a.task[i] = T.EXPLORE;
      }
      return;
    }
    // неготовый участок впереди — помочь достроить
    const seg = r.segments.find((s) => k >= s.from - 1 && k <= s.to);
    if (seg && seg.kind !== 'walk') {
      if (seg.kind === 'tunnel' && seg.ref >= 0 && sim.construction.blueprints.has(seg.ref)) {
        const col2 = sim.colonies[a.colony[i]];
        const job = sim.construction.claim(a.colony[i], i, a.x[i], a.y[i], 1 << JK.DIG, sim.time, undefined, (c) => col2.nest.field.field[c] !== 65535);
        if (job) { a.state[i] = S.GOTO_JOB; a.target[i] = job.id; a.timer[i] = 60; a.task[i] = T.BUILD; return; }
      } else if (seg.kind !== 'tunnel') {
        const s = sim.structures.get(seg.ref);
        if (s && s.state === SS.FORMING) {
          a.state[i] = S.STRUCT_JOIN;
          a.target[i] = s.id;
          a.tx[i] = -1;
          a.timer[i] = 120;
          a.task[i] = T.BUILD;
          return;
        }
      }
    }
    const px = r.pts[k * 2];
    const py = r.pts[k * 2 + 1];
    if (this.exitNest(i, dt, px, py)) return;
    const dx = px - a.x[i];
    const dy = py - a.y[i];
    if (dx * dx + dy * dy < 5 || a.stuck[i] > 3) { a.target[i] = k + 1; a.stuck[i] = 0; return; }
    this.sys.steer(i, dx, dy, 1, dt, 0.2);
    this.depositOutbound(i, dt);
    if ((sim.tick + i) % 4 === 0) this.lookForFood(i, false);
  }

  /** Сбор ресурсов: листья с земли или срезание листьев с растений (муравьи-листорезы). */
  private gather(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    a.timer[i] -= dt;
    if (a.timer[i] <= 0) { this.goHome(i); return; }
    // лист на земле
    if ((sim.tick + i) % 5 === 0) {
      const it = sim.food.sense(a.x[i], a.y[i], CASTES[a.caste[i]].sense * 1.5, (f) => FOOD_KINDS[f.kind].resource);
      if (it) {
        const d = Math.hypot(it.x - a.x[i], it.y - a.y[i]);
        if (d < it.r + 1.3) {
          const got = sim.food.take(it, this.strength(i));
          this.pickUp(i, it.kind, got);
          return;
        }
        a.tx[i] = -2;
        this.sys.steer(i, it.x - a.x[i], it.y - a.y[i], 1, dt, 0.3);
        return;
      }
    }
    if (a.tx[i] < 0) {
      // выбрать лист на растении
      const col = sim.colonies[a.colony[i]];
      for (let k = 0; k < 30; k++) {
        const x = Math.round(col.nest.entranceX + sim.rng.range(-160, 160));
        const gy = t.groundY(x);
        const y = Math.round(gy - sim.rng.range(1, 70));
        if (!t.inBounds(x, y)) continue;
        const m = t.get(x, y);
        if ((m === M.LEAF || m === M.GRASS) && t.plant[y * t.W + x]) {
          if (sim.nav.walkable(x, y - 1) || sim.nav.walkable(x - 1, y) || sim.nav.walkable(x + 1, y) || sim.nav.walkable(x, y + 1)) {
            a.tx[i] = x;
            a.ty[i] = y;
            break;
          }
        }
      }
      if (a.tx[i] < 0) { this.sys.steer(i, Math.cos(a.heading[i]), 0, 1, dt, 1.2); return; }
    }
    const x = a.tx[i] | 0;
    const y = a.ty[i] | 0;
    const m = t.get(x, y);
    if (m !== M.LEAF && m !== M.GRASS) { a.tx[i] = -1; return; }
    const dx = x + 0.5 - a.x[i];
    const dy = y + 0.5 - a.y[i];
    if (dx * dx + dy * dy > 3.2) {
      this.sys.steer(i, dx, dy, 1, dt, 0.3);
      if (a.stuck[i] > 4) a.tx[i] = -1;
      return;
    }
    // срезать
    a.heading[i] = Math.atan2(dy, dx);
    a.anim[i] += dt * 8;
    const idx = y * t.W + x;
    const hp = t.hp[idx] - dt * 255 * 1.4;
    if (hp <= 0) {
      t.set(x, y, M.AIR);
      this.pickUp(i, FK.LEAF, 1);
      a.tx[i] = -1;
    } else { t.hp[idx] = hp; t.renderDirty.markCell(x, y); }
  }

  private patrol(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    a.timer[i] -= dt;
    if (a.timer[i] <= 0) { a.state[i] = S.IDLE; return; }
    if ((sim.tick + i) % 10 === 0 && col.threats.length > 0) { this.assign(i, T.DEFENSE); return; }
    const dx = a.tx[i] - a.x[i];
    const dy = a.ty[i] - a.y[i];
    if (dx * dx + dy * dy < 9) { a.tx[i] = col.nest.entranceX + sim.rng.range(-30, 30); a.ty[i] = col.nest.entranceY - 1; }
    this.sys.steer(i, dx, dy, 0.7, dt, 0.8);
  }

  /** Выход из текущего состояния: освободить задачи, слоты, узлы конструкций. */
  leave(i: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const st = a.state[i];
    if (st === S.STRUCT_NODE) {
      const s = sim.structures.get(a.target[i]);
      if (s) sim.structures.onNodeLost(s, i);
    } else if (st === S.CARRY_TEAM) {
      const it = sim.food.get(a.target[i]);
      if (it) {
        const k = it.carriers.indexOf(i);
        if (k >= 0) it.carriers.splice(k, 1);
        if (it.carriers.length === 0) it.hauler = -1;
      }
    } else if (st === S.GOTO_JOB || st === S.DIG || st === S.BUILD) {
      if (a.target[i] >= 0) sim.construction.release(a.target[i]);
    }
  }
}

export const NEST_ROOM_TYPES = ROOM;
export const FORBID = F_FORBID;
