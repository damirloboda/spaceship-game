import { angleWrap } from '../core/MathUtil';
import { FK } from '../food/FoodTypes';
import { N_FLOOR, N_FOLIAGE, N_SOLID, N_STRUCT, N_SURF, N_WEB } from '../nav/NavGrid';
import { P, PH_CELL } from '../pheromone/PheromoneField';
import { F_FORBID } from '../world/Terrain';
import type { Simulation } from '../sim/Simulation';
import { AF_DETAIL, AF_HURT, AF_ON_STRUCT, AF_SIDE, AF_WET, CG, S } from './AntStore';
import { AntBrain } from './AntBrain';
import { C, CASTES } from './Castes';
import { TERRITORY_R } from '../colony/Colony';

const OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0, 2.7, -2.7];
const TICK_INTERVAL = [1, 2, 4, 8];

/**
 * Система муравьёв: цикл симуляции агентов с LOD по расстоянию до камеры,
 * движение по поверхностям, падение, вода, толпа, бой и смерть.
 * Поведение (что делать) — в AntBrain; здесь — как это физически исполнить.
 *
 * LOD симуляции:
 *  0 — в кадре: каждый тик, полная анимация
 *  1 — рядом с кадром: раз в 2 тика
 *  2 — далеко: раз в 4 тика
 *  3 — очень далеко: раз в 8 тиков (шаг времени увеличивается — поведение то же)
 */
export class AntSystem {
  brain: AntBrain;
  /** сколько муравьёв обновлено в этом тике (для отладки/HUD) */
  updated = 0;
  private dir = [0, 0];
  private joinCount = new Map<number, number>();
  private routeCount = new Map<number, number>();
  private itemAssigned = new Map<number, number>();

  constructor(private sim: Simulation) {
    this.brain = new AntBrain(sim, this);
  }

  /** Создать агента колонии. */
  spawn(colony: number, caste: number, x: number, y: number): number {
    const sim = this.sim;
    const a = sim.ants;
    const id = a.spawn(colony, caste, x, y, sim.rng.int(256));
    sim.colonies[colony].initThresholds(a.thr, id * 5, caste);
    a.health[id] = 1;
    return id;
  }

  /** Пересчитать счётчики агентов колоний (после загрузки). */
  recount(): void {
    const sim = this.sim;
    const a = sim.ants;
    for (const col of sim.colonies) { col.agents = 0; col.agentsByTask.fill(0); col.agentsByCaste.fill(0); }
    for (let i = 0; i < a.n; i++) {
      if (!a.alive[i] || a.state[i] === S.DYING) continue;
      const col = sim.colonies[a.colony[i]];
      col.agents++;
      col.agentsByTask[a.task[i]]++;
      col.agentsByCaste[a.caste[i]]++;
    }
    for (const col of sim.colonies) {
      let st = 0;
      for (const r of sim.routes.routes.values()) if (r.colony === col.id) st += r.stream;
      col.streamAnts = st;
    }
  }

  update(dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const view = sim.view;
    const tick = sim.tick;
    const margin = 40;
    const vx0 = view.x0 - margin;
    const vy0 = view.y0 - margin;
    const vx1 = view.x1 + margin;
    const vy1 = view.y1 + margin;
    const reassignLod = tick % 10 === 0;
    this.updated = 0;
    // счётчики, пересчитываемые каждый тик
    for (const col of sim.colonies) {
      col.agents = 0;
      col.agentsByTask.fill(0);
      col.agentsByCaste.fill(0);
    }
    this.joinCount.clear();
    this.routeCount.clear();
    this.itemAssigned.clear();

    const n = a.n;
    for (let i = 0; i < n; i++) {
      if (!a.alive[i]) continue;
      const col = sim.colonies[a.colony[i]];
      if (a.state[i] !== S.DYING) {
        col.agents++;
        col.agentsByTask[a.task[i]]++;
        col.agentsByCaste[a.caste[i]]++;
      }
      const st = a.state[i];
      if (st === S.STRUCT_JOIN) this.joinCount.set(a.target[i], (this.joinCount.get(a.target[i]) ?? 0) + 1);
      else if (st === S.ROUTE) this.routeCount.set(a.target2[i], (this.routeCount.get(a.target2[i]) ?? 0) + 1);
      else if (st === S.GOTO_ITEM) this.itemAssigned.set(a.target[i], (this.itemAssigned.get(a.target[i]) ?? 0) + 1);

      if (reassignLod) {
        const x = a.x[i];
        const y = a.y[i];
        let lod: number;
        if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) lod = 0;
        else {
          const dx = Math.max(vx0 - x, 0, x - vx1);
          const dy = Math.max(vy0 - y, 0, y - vy1);
          const d = dx + dy;
          lod = d < 200 ? 1 : d < 700 ? 2 : 3;
        }
        // критичные состояния — всегда полная симуляция
        if (st === S.CARRY_TEAM || st === S.STRUCT_JOIN || st === S.FALL || st === S.ATTACK || st === S.DYING || st === S.BUILD) lod = Math.min(lod, 0);
        if (st === S.DIG) lod = Math.min(lod, 1);
        a.lod[i] = lod;
        if (lod === 0) a.flags[i] |= AF_DETAIL;
        else a.flags[i] &= ~AF_DETAIL;
      }
      const interval = TICK_INTERVAL[a.lod[i]];
      if ((tick + i) % interval !== 0) continue;
      a.px[i] = a.x[i];
      a.py[i] = a.y[i];
      this.updateAnt(i, dt * interval);
      this.updated++;
    }
    // обратная связь в конструкции / маршруты / еду
    for (const s of sim.structures.items.values()) s.joiners = this.joinCount.get(s.id) ?? 0;
    for (const r of sim.routes.routes.values()) r.assigned = this.routeCount.get(r.id) ?? 0;
    for (const it of sim.food.items) it.assigned = this.itemAssigned.get(it.id) ?? 0;
  }

  private updateAnt(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    const st = a.state[i];
    if (st === S.DYING) {
      a.timer[i] += dt;
      if (a.timer[i] > 1.8) a.kill(i);
      return;
    }
    a.age[i] += dt;
    a.anim[i] += dt;
    const caste = a.caste[i];
    // энергия: работа утомляет; в гнезде восстановится (станет жителем)
    const drain = st === S.CARRY_TEAM ? 0.004 : st === S.STRUCT_NODE ? 0.0006 : 0.0018;
    a.energy[i] = Math.max(0, a.energy[i] - drain * dt);
    if (a.health[i] < 1) a.health[i] = Math.min(1, a.health[i] + dt * 0.004);
    if (a.health[i] < 0.6) a.flags[i] |= AF_HURT;

    const x = a.x[i];
    const y = a.y[i];
    const cx = x | 0;
    const cy = y | 0;
    // стебель/ствол вырос прямо на муравье — просто выбирается, без вреда
    if (st !== S.STRUCT_NODE && (sim.nav.nav[cy * t.W + cx] & N_SOLID) && t.plant[cy * t.W + cx] !== 0) {
      for (let d = 1; d <= 4; d++) {
        if (!t.solid(cx, cy - d)) { a.y[i] = cy - d + 0.5; return; }
        if (!t.solid(cx + d, cy)) { a.x[i] = cx + d + 0.5; return; }
        if (!t.solid(cx - d, cy)) { a.x[i] = cx - d + 0.5; return; }
      }
    }
    // засыпало обвалом / застряли в стене
    if (st !== S.STRUCT_NODE && (sim.nav.nav[cy * t.W + cx] & N_SOLID)) {
      let freed = false;
      for (let d = 1; d <= 5; d++) {
        if (!t.solid(cx, cy - d)) { a.y[i] = cy - d + 0.5; freed = true; break; }
        if (!t.solid(cx + d, cy)) { a.x[i] = cx + d + 0.5; freed = true; break; }
        if (!t.solid(cx - d, cy)) { a.x[i] = cx - d + 0.5; freed = true; break; }
      }
      this.hurt(i, freed ? 0.05 : 0.5 * dt, 2);
      return;
    }
    const W = t.W;
    const ci = cy * W + cx;
    const nv = sim.nav.nav[ci];
    // вода
    if (t.water[ci] > 110) a.flags[i] |= AF_WET;
    else a.flags[i] &= ~AF_WET;
    // потеря опоры -> падение
    if (st !== S.STRUCT_NODE && st !== S.CARRY_TEAM && st !== S.FALL && st !== S.STRUCT_JOIN) {
      if ((nv & N_SOLID) === 0 && (nv & (N_SURF | N_FLOOR | N_STRUCT)) === 0 && t.water[ci] < 110) {
        a.prevState[i] = st;
        a.state[i] = S.FALL;
        a.vy[i] = 0;
        a.vx[i] = Math.cos(a.heading[i]) * 1.5;
      }
    }
    if (nv & N_STRUCT) {
      a.flags[i] |= AF_ON_STRUCT;
      if ((sim.tick & 15) === 0) {
        const s = sim.structures.structureAtCell(ci);
        if (s) sim.structures.markUsed(s, sim.time);
      }
    } else a.flags[i] &= ~AF_ON_STRUCT;

    this.brain.think(i, dt);

    // протоптанность и разведка
    if ((sim.tick + i) % 6 === 0 && a.state[i] !== S.STRUCT_NODE) {
      const col = sim.colonies[a.colony[i]];
      col.pher.addTraffic(a.x[i], a.y[i], 0.5, sim.time);
      const newly = col.memory.reveal(a.x[i], a.y[i], CASTES[caste].sense * (1 - sim.weather.fog * 0.5), sim.time);
      if (newly) col.evo.add(3);
    }
    // бой между колониями
    if ((sim.tick + i) % 4 === 0 && sim.colonies.length > 1) this.fightCheck(i, dt * 4);
  }

  /**
   * Движение с прилипанием к поверхностям: желаемое направление -> поворот с
   * ограниченной угловой скоростью -> если следующая клетка непроходима, пробуем
   * отклонения по очереди (так муравей обтекает препятствия и переходит с пола на стену).
   * Возвращает пройденное расстояние.
   */
  steer(i: number, dx: number, dy: number, speedMul: number, dt: number, wander = 0.6): number {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    const nav = sim.nav.nav;
    const W = t.W;
    const cdef = CASTES[a.caste[i]];
    let h = a.heading[i];
    if (dx !== 0 || dy !== 0) {
      const want = Math.atan2(dy, dx);
      const turn = 10 * dt;
      const d = angleWrap(want - h);
      h += d > turn ? turn : d < -turn ? -turn : d;
    }
    h += (sim.rng.next() - 0.5) * wander * 6 * dt;
    const cx = a.x[i] | 0;
    const cy = a.y[i] | 0;
    const ci = cy * W + cx;
    let speed = cdef.speed * speedMul;
    const col = sim.colonies[a.colony[i]];
    if (col.isPlayer && sim.colonies[0].evo.level >= 7 && a.caste[i] === C.SCOUT) speed *= 1.2;
    if (a.energy[i] < 0.25) speed *= 0.7;
    if (a.cargo[i] !== CG.NONE) speed *= a.cargo[i] === CG.SOIL ? 0.85 : 0.9;
    if (a.flags[i] & AF_WET) speed *= 0.35;
    if (nav[ci] & N_WEB) speed *= 0.12;
    if (nav[ci] & N_FOLIAGE) speed *= 0.75;
    // холод замедляет, жара у поверхности — тоже
    const temp = t.tempAt(cx, cy);
    if (temp < 10) speed *= Math.max(0.35, 1 - (10 - temp) * 0.06);
    else if (temp > 30) speed *= 0.85;
    // плотность толпы: поток замедляется, но не останавливается
    const dens = sim.antHash.countAt(a.x[i], a.y[i]);
    if (dens > 8) speed *= Math.max(0.35, 1 - (dens - 8) * 0.025);
    const step = speed * dt;
    const forbid = col.isPlayer;
    // постоянная сторона обхода (bug-алгоритм): муравей не дёргается у препятствия,
    // а обходит/перелезает его по контуру
    const side = a.flags[i] & AF_SIDE ? -1 : 1;
    for (let k = 0; k < OFFSETS.length; k++) {
      const o = OFFSETS[k] * side;
      const ang = h + o;
      const nx = a.x[i] + Math.cos(ang) * step;
      const ny = a.y[i] + Math.sin(ang) * step;
      const nxi = nx | 0;
      const nyi = ny | 0;
      if (nxi < 1 || nyi < 1 || nxi >= W - 1 || nyi >= t.H - 1) continue;
      const ni = nyi * W + nxi;
      const v = nav[ni];
      if (v & N_SOLID) continue;
      if ((v & (N_SURF | N_FLOOR | N_STRUCT)) === 0 && t.water[ni] < 110) continue;
      if (forbid && t.flags[ni] & F_FORBID && !(t.flags[ci] & F_FORBID)) continue;
      a.x[i] = nx;
      a.y[i] = ny;
      a.heading[i] = k <= 2 ? ang : h + o * 0.5;
      // при долгом свободном ходе сторона иногда меняется — разнообразие маршрутов
      if (k === 0 && sim.rng.next() < dt * 0.05) a.flags[i] ^= AF_SIDE;
      a.stuck[i] = Math.max(0, a.stuck[i] - dt);
      a.walk[i] += step;
      // пешая анимация: фаза пропорциональна пройденному пути
      a.anim[i] += step * 2.2;
      return step;
    }
    a.heading[i] = h + Math.PI * 0.6 * side;
    a.stuck[i] += dt;
    if (a.stuck[i] > 1.5) a.flags[i] ^= AF_SIDE;
    return 0;
  }

  /** Направление вдоль градиента феромона (8 соседних клеток поля) с предпочтением "вперёд". */
  pherDir(i: number, ch: number, out: number[], forwardBias = 0.6, colonyOverride = -1): number {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[colonyOverride >= 0 ? colonyOverride : a.colony[i]];
    const f = col.pher;
    const arr = f.ch[ch];
    const w = f.w;
    const x = a.x[i];
    const y = a.y[i];
    const pcx = (x / PH_CELL) | 0;
    const pcy = (y / PH_CELL) | 0;
    if (pcx < 1 || pcy < 1 || pcx >= w - 1 || pcy >= f.h - 1) return 0;
    const hx = Math.cos(a.heading[i]);
    const hy = Math.sin(a.heading[i]);
    let gx = 0;
    let gy = 0;
    let max = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = arr[(pcy + dy) * w + pcx + dx];
        if (v <= 0.01) continue;
        const inv = dx !== 0 && dy !== 0 ? 0.7071 : 1;
        const ux = dx * inv;
        const uy = dy * inv;
        const fwd = 1 + forwardBias * (ux * hx + uy * hy);
        const s = v * Math.max(0.05, fwd);
        gx += ux * s;
        gy += uy * s;
        if (v > max) max = v;
      }
    }
    const l = Math.hypot(gx, gy);
    if (l < 1e-5) return 0;
    out[0] = gx / l;
    out[1] = gy / l;
    return max;
  }

  /** Падение под действием гравитации. */
  fall(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const t = sim.terrain;
    const wet = t.water[(a.y[i] | 0) * t.W + (a.x[i] | 0)] > 110;
    a.vy[i] = wet ? Math.max(-2, a.vy[i] - 6 * dt) : Math.min(28, a.vy[i] + 45 * dt);
    a.vx[i] *= 0.98;
    const nx = a.x[i] + a.vx[i] * dt;
    const ny = a.y[i] + a.vy[i] * dt;
    a.heading[i] += dt * 6;
    if (t.solid(nx | 0, a.y[i] | 0)) a.vx[i] = 0;
    else a.x[i] = Math.max(1, Math.min(t.W - 2, nx));
    if (t.solid(a.x[i] | 0, ny | 0) || ny >= t.H - 2) {
      const impact = a.vy[i];
      a.vy[i] = 0;
      a.y[i] = Math.floor(ny) - 0.01;
      if (t.solid(a.x[i] | 0, a.y[i] | 0)) a.y[i] -= 1;
      if (impact > 26) this.hurt(i, 0.1, 3);
      this.land(i);
      return;
    }
    a.y[i] = ny;
    if (sim.nav.walkable(a.x[i] | 0, a.y[i] | 0) && a.vy[i] > 2) {
      this.land(i);
    } else if (wet && sim.nav.walkable(a.x[i] | 0, a.y[i] | 0)) this.land(i);
  }

  private land(i: number): void {
    const a = this.sim.ants;
    let prev = a.prevState[i];
    if (prev === S.FALL || prev === S.STRUCT_NODE || prev === S.STRUCT_JOIN || prev === S.CARRY_TEAM) prev = S.IDLE;
    a.state[i] = prev;
    a.vy[i] = 0;
    a.heading[i] = a.vx[i] >= 0 ? 0 : Math.PI;
  }

  hurt(i: number, amount: number, cause: number): void {
    const sim = this.sim;
    const a = sim.ants;
    if (!a.alive[i] || a.state[i] === S.DYING) return;
    a.health[i] -= amount;
    a.flags[i] |= AF_HURT;
    if (a.health[i] <= 0) this.die(i, cause);
  }

  /** Смерть — муравей тихо "выходит из симуляции": замирает и растворяется. Без насилия. */
  die(i: number, cause: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const col = sim.colonies[a.colony[i]];
    this.brain.leave(i);
    if (a.cargo[i] === CG.FOOD && a.cargoAmt[i] > 0.1) {
      sim.food.spawn(a.cargoKind[i] as number, a.x[i], a.y[i], a.cargoAmt[i]);
    }
    a.cargo[i] = CG.NONE;
    a.state[i] = S.DYING;
    a.timer[i] = 0;
    col.stats.died++;
    col.memory.addDanger(a.x[i], a.y[i], 1);
    col.pher.splash(P.DANGER, a.x[i], a.y[i], 5, 4, sim.time);
    sim.bus.emit({ type: 'antDied', x: a.x[i], y: a.y[i], colony: a.colony[i], cause });
    for (const r of sim.routes.routes.values()) {
      if (r.colony !== a.colony[i]) continue;
      if (Math.hypot(r.endX - a.x[i], r.endY - a.y[i]) < 60) r.danger += 1;
    }
  }

  /** Встреча с муравьём другой колонии: солдаты дерутся, рабочие у своего гнезда тоже, остальные бегут. */
  private fightCheck(i: number, dt: number): void {
    const sim = this.sim;
    const a = sim.ants;
    const my = a.colony[i];
    const st = a.state[i];
    if (st === S.STRUCT_NODE || st === S.DYING || st === S.FALL) return;
    let enemy = -1;
    let bd = 2.2;
    sim.antHash.query(a.x[i], a.y[i], 1.6, (j) => {
      if (a.colony[j] === my || a.state[j] === S.DYING) return;
      const d = Math.abs(a.x[j] - a.x[i]) + Math.abs(a.y[j] - a.y[i]);
      if (d < bd) { bd = d; enemy = j; }
    });
    if (enemy < 0) return;
    const col = sim.colonies[my];
    const homeD = Math.hypot(a.x[i] - col.nest.entranceX, a.y[i] - col.nest.entranceY);
    const nearHome = homeD < 40;
    const fighter = a.caste[i] === C.SOLDIER || st === S.ATTACK || st === S.PATROL || nearHome;
    // чужой на своей территории — угроза; на чужой — просто встреча
    if (homeD < TERRITORY_R) col.addThreat('ant', enemy, a.x[enemy], a.y[enemy], 0.3, sim.time);
    if (fighter) {
      const ec = CASTES[a.caste[enemy]];
      this.hurt(enemy, (CASTES[a.caste[i]].attack * dt) / ec.hp, 4);
      col.pher.deposit(P.ATTACK, a.x[i], a.y[i], 3, sim.time);
    } else if (st !== S.CARRY_TEAM) {
      col.pher.deposit(P.DANGER, a.x[i], a.y[i], 2, sim.time);
      this.brain.flee(i);
    }
  }

  /** Бросить груз (крошку) на землю. */
  dropCargo(i: number): void {
    const sim = this.sim;
    const a = sim.ants;
    if (a.cargo[i] === CG.FOOD || a.cargo[i] === CG.RESOURCE) {
      if (a.cargoAmt[i] > 0.05) sim.food.spawn(a.cargo[i] === CG.RESOURCE ? FK.LEAF : a.cargoKind[i], a.x[i], a.y[i], a.cargoAmt[i]);
    }
    a.cargo[i] = CG.NONE;
    a.cargoAmt[i] = 0;
  }

  get dirTmp(): number[] {
    return this.dir;
  }
}
