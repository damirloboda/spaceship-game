import { lineCells } from '../core/MathUtil';
import { BPK, JK } from '../construction/ConstructionSystem';
import { SK, SS } from '../construction/LivingStructures';
import { IS_CLIMBABLE, IS_DIGGABLE, IS_SOLID } from '../world/Materials';
import type { Simulation } from '../sim/Simulation';

export const RP = { FOOD: 0, EXPLORE: 1, ATTACK: 2, RESOURCE: 3 } as const;
export const RP_NAMES = ['еда', 'разведка', 'атака', 'ресурсы'];

export interface RouteSegment {
  kind: 'walk' | 'bridge' | 'ladder' | 'tower' | 'tunnel' | 'water';
  from: number; // индекс точки
  to: number;
  ref: number; // id конструкции или чертежа
}

export interface Route {
  id: number;
  colony: number;
  /** точки маршрута x0,y0,x1,y1,... от гнезда к цели */
  pts: number[];
  segments: RouteSegment[];
  purpose: number;
  endX: number;
  endY: number;
  demand: number;
  assigned: number;
  deliveries: number;
  danger: number;
  traffic: number;
  score: number;
  created: number;
  lastUsed: number;
  player: boolean;
  /** абстрактные муравьи потока на этом маршруте (иерархия: уровень "потоков") */
  stream: number;
  streamPhase: number;
  blocked: boolean;
  label: string;
}

interface Cell { x: number; y: number; c: number }
const WALK = 0, DIG = 1, HARD = 2, AIR = 3, WATER = 4;

/**
 * Маршруты — это "дороги", которые рисует игрок или которые колония выучила сама.
 * Планировщик разбирает линию по клеткам: где можно идти — идём; где пропасть —
 * заказываем живой мост; где гладкая стена — живую лестницу; где цель в воздухе —
 * живую башню; где мягкий грунт — тоннель; где вода — мост над водой.
 */
export class RouteManager {
  routes = new Map<number, Route>();
  private nextId = 1;

  constructor(private sim: Simulation) {}

  get(id: number): Route | undefined {
    return this.routes.get(id);
  }

  remove(id: number): void {
    const r = this.routes.get(id);
    if (!r) return;
    for (const s of r.segments) {
      if (s.kind === 'bridge' || s.kind === 'ladder' || s.kind === 'tower' || s.kind === 'water') {
        const st = this.sim.structures.get(s.ref);
        if (st) { st.permanent = false; st.routeId = -1; this.sim.structures.dissolve(st, this.sim.time); }
      }
    }
    const col = this.sim.colonies[r.colony];
    if (col && r.stream > 0) col.residentsReturn(r.stream);
    this.routes.delete(id);
  }

  /** Построить маршрут по нарисованной линии. */
  planFromLine(colonyId: number, raw: number[][]): Route | null {
    const sim = this.sim;
    const t = sim.terrain;
    const nav = sim.nav;
    const col = sim.colonies[colonyId];
    if (!col || raw.length < 2) return null;
    // ориентируем от гнезда
    const a = raw[0];
    const b = raw[raw.length - 1];
    const da = col.nest.field.dist(a[0], a[1]);
    const db = col.nest.field.dist(b[0], b[1]);
    const ea = Math.hypot(a[0] - col.nest.entranceX, a[1] - col.nest.entranceY);
    const eb = Math.hypot(b[0] - col.nest.entranceX, b[1] - col.nest.entranceY);
    if ((da < 65535 && db < 65535 && db < da) || ((da === 65535 || db === 65535) && eb < ea)) raw = raw.slice().reverse();

    // растеризуем с привязкой к поверхностям
    const cells: Cell[] = [];
    const push = (x: number, y: number) => {
      const last = cells[cells.length - 1];
      if (last && last.x === x && last.y === y) return;
      cells.push({ x, y, c: this.classify(x, y) });
    };
    for (let k = 0; k < raw.length - 1; k++) {
      const seg = lineCells(raw[k][0], raw[k][1], raw[k + 1][0], raw[k + 1][1]);
      for (const [x, y] of seg) {
        if (!t.inBounds(x, y)) continue;
        const [sx, sy] = this.snap(x, y);
        push(sx, sy);
      }
    }
    if (cells.length < 2) return null;

    const route: Route = {
      id: this.nextId++, colony: colonyId, pts: [], segments: [], purpose: RP.EXPLORE,
      endX: cells[cells.length - 1].x, endY: cells[cells.length - 1].y, demand: 0, assigned: 0, deliveries: 0,
      danger: 0, traffic: 0, score: 1, created: sim.time, lastUsed: sim.time, player: true, stream: 0, streamPhase: sim.rng.next() * 1000,
      blocked: false, label: '',
    };

    // разбиение на участки
    let i = 0;
    const pushPt = (x: number, y: number) => {
      const n = route.pts.length;
      if (n >= 2 && Math.hypot(route.pts[n - 2] - x, route.pts[n - 1] - y) < 3) return;
      route.pts.push(x + 0.5, y + 0.5);
    };
    const notes: string[] = [];
    while (i < cells.length) {
      const c = cells[i];
      if (c.c === WALK) {
        const from = route.pts.length / 2;
        while (i < cells.length && cells[i].c === WALK) {
          if (i % 4 === 0) pushPt(cells[i].x, cells[i].y);
          i++;
        }
        pushPt(cells[i - 1].x, cells[i - 1].y);
        route.segments.push({ kind: 'walk', from, to: route.pts.length / 2 - 1, ref: -1 });
        continue;
      }
      // участок-препятствие
      const start = i;
      const cls = c.c;
      while (i < cells.length && cells[i].c === cls) i++;
      const prev = start > 0 ? cells[start - 1] : null;
      const next = i < cells.length ? cells[i] : null;
      if (cls === DIG) {
        // тоннель: 2 клетки в высоту
        const jobs: [number, number, number][] = [];
        for (let k = start; k < i; k++) {
          jobs.push([cells[k].x, cells[k].y, JK.DIG]);
          jobs.push([cells[k].x, cells[k].y - 1, JK.DIG]);
        }
        const bp = sim.construction.addBlueprint(colonyId, BPK.TUNNEL, jobs, { player: true, priority: 2, label: 'Тоннель маршрута' });
        const from = route.pts.length / 2;
        for (let k = start; k < i; k += 4) pushPt(cells[k].x, cells[k].y);
        route.segments.push({ kind: 'tunnel', from, to: route.pts.length / 2 - 1, ref: bp ? bp.id : -1 });
        notes.push('тоннель');
        continue;
      }
      if (cls === HARD) {
        // гладкая стена — лестница вверх по грани; шершавая — обойдут сами
        if (prev) {
          const top = this.findTopOfObstacle(prev.x, prev.y, next ? next.x : cells[i - 1].x);
          if (top && !this.climbableFace(prev.x, prev.y, top[1])) {
            const h = prev.y - top[1];
            if (h > 0 && h <= col.evo.towerHeight()) {
              const st = sim.structures.create(colonyId, SK.LADDER, prev.x + 0.5, prev.y + 0.5, top[0] + 0.5, top[1] + 0.5, sim.time, route.id);
              const from = route.pts.length / 2;
              pushPt(prev.x, prev.y);
              pushPt(top[0], top[1]);
              route.segments.push({ kind: 'ladder', from, to: route.pts.length / 2 - 1, ref: st.id });
              notes.push(`лестница ${h}`);
            } else notes.push('стена слишком высокая');
          }
        }
        continue;
      }
      // воздух или вода — мост / башня
      if (prev && next) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        const span = Math.hypot(dx, dy);
        if (Math.abs(dy) > Math.abs(dx) * 1.5 && dy < 0) {
          const kind = this.wallNear(prev.x, prev.y, next.y) ? SK.LADDER : SK.TOWER;
          if (-dy <= col.evo.towerHeight()) {
            const st = sim.structures.create(colonyId, kind, prev.x + 0.5, prev.y + 0.5, next.x + 0.5, next.y + 0.5, sim.time, route.id);
            const from = route.pts.length / 2;
            pushPt(prev.x, prev.y);
            pushPt(next.x, next.y);
            route.segments.push({ kind: kind === SK.LADDER ? 'ladder' : 'tower', from, to: route.pts.length / 2 - 1, ref: st.id });
            notes.push(kind === SK.LADDER ? 'живая лестница' : 'живая башня');
          } else notes.push('слишком высоко для башни');
        } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && dy > 0) {
          // вниз — просто спрыгнут/спустятся
          const from = route.pts.length / 2;
          pushPt(next.x, next.y);
          route.segments.push({ kind: 'walk', from, to: route.pts.length / 2 - 1, ref: -1 });
        } else if (span <= col.evo.bridgeSpan()) {
          const st = sim.structures.create(colonyId, SK.BRIDGE, prev.x + 0.5, prev.y + 0.5, next.x + 0.5, next.y + 0.5, sim.time, route.id);
          const from = route.pts.length / 2;
          pushPt(prev.x, prev.y);
          pushPt(next.x, next.y);
          route.segments.push({ kind: cls === WATER ? 'water' : 'bridge', from, to: route.pts.length / 2 - 1, ref: st.id });
          notes.push(`мост ${Math.round(span)} кл.`);
        } else {
          notes.push(`пропасть ${Math.round(span)} кл. — нужен уровень выше`);
        }
      } else if (prev && !next) {
        // линия уходит в воздух — башня к цели
        const end = cells[cells.length - 1];
        if (end.y < prev.y - 3 && prev.y - end.y <= col.evo.towerHeight()) {
          const st = sim.structures.create(colonyId, SK.TOWER, prev.x + 0.5, prev.y + 0.5, prev.x + 0.5, end.y + 0.5, sim.time, route.id);
          const from = route.pts.length / 2;
          pushPt(prev.x, prev.y);
          pushPt(prev.x, end.y);
          route.segments.push({ kind: 'tower', from, to: route.pts.length / 2 - 1, ref: st.id });
          notes.push('живая башня');
        }
      }
    }
    if (route.pts.length < 4) return null;
    route.endX = route.pts[route.pts.length - 2];
    route.endY = route.pts[route.pts.length - 1];
    this.classifyPurpose(route);
    route.label = `${['К еде', 'Разведка', 'Атака', 'К ресурсам'][route.purpose]}${notes.length ? ': ' + notes.join(', ') : ''}`;
    this.routes.set(route.id, route);
    return route;
  }

  classifyPurpose(r: Route): void {
    const sim = this.sim;
    const c = sim.creatures.nearest(r.endX, r.endY, 25, (cr) => cr.def.role === 'predator' || cr.def.role === 'thief');
    if (c) { r.purpose = RP.ATTACK; return; }
    let food = 0;
    let res = 0;
    sim.food.query(r.endX, r.endY, 30, (it) => {
      if (it.attached) return;
      if (it.kind === 10 || it.kind === 13) res += it.mass;
      else food += it.mass;
    });
    if (food > 0) r.purpose = RP.FOOD;
    else if (res > 0) r.purpose = RP.RESOURCE;
    else r.purpose = RP.EXPLORE;
  }

  private classify(x: number, y: number): number {
    const t = this.sim.terrain;
    const nav = this.sim.nav;
    const i = y * t.W + x;
    const m = t.mat[i];
    // растения проходимы для муравьёв — это не стена
    if (nav.nav[i] & 1) return IS_DIGGABLE[m] ? DIG : HARD;
    if (t.water[i] > 120 && !IS_SOLID[m]) return WATER;
    if (nav.walkableI(i)) return WALK;
    return AIR;
  }

  /**
   * Привязка точки линии к поверхности: рука игрока неточна, а линия "над землёй"
   * означает "идти по земле". Пропастью считается только настоящий обрыв (глубже
   * SNAP клеток), стеной — только настоящая стена (выше SNAP клеток).
   */
  private snap(x: number, y: number): [number, number] {
    const nav = this.sim.nav;
    const SNAP = 12;
    if (nav.walkable(x, y)) return [x, y];
    if (!(nav.nav[y * this.sim.terrain.W + x] & 1)) {
      for (let d = 1; d <= SNAP; d++) {
        if (nav.walkable(x, y + d)) return [x, y + d];
        if (nav.nav[(y + d) * this.sim.terrain.W + x] & 1) break; // уткнулись в твёрдое без поверхности
      }
    } else {
      for (let d = 1; d <= SNAP; d++) if (nav.walkable(x, y - d)) return [x, y - d];
    }
    return [x, y];
  }

  private findTopOfObstacle(x: number, y: number, towardX: number): [number, number] | null {
    const t = this.sim.terrain;
    const dir = towardX >= x ? 1 : -1;
    const wx = x + dir;
    let yy = y;
    while (yy > 0 && t.solid(wx, yy)) yy--;
    if (yy <= 0) return null;
    return [x, yy];
  }

  private climbableFace(x: number, y0: number, y1: number): boolean {
    const t = this.sim.terrain;
    for (let y = y1; y <= y0; y++) {
      if (IS_CLIMBABLE[t.get(x + 1, y)] || IS_CLIMBABLE[t.get(x - 1, y)]) continue;
      return false;
    }
    return true;
  }

  private wallNear(x: number, y0: number, y1: number): boolean {
    const t = this.sim.terrain;
    let n = 0;
    for (let y = y1; y <= y0; y++) if (t.solid(x - 1, y) || t.solid(x + 1, y)) n++;
    return n > (y0 - y1) * 0.6;
  }

  /** Все ли конструкции маршрута готовы (можно ходить). */
  ready(r: Route): boolean {
    for (const s of r.segments) {
      if (s.kind === 'bridge' || s.kind === 'ladder' || s.kind === 'tower' || s.kind === 'water') {
        const st = this.sim.structures.get(s.ref);
        if (!st || st.state !== SS.ACTIVE) return false;
      } else if (s.kind === 'tunnel' && s.ref >= 0 && this.sim.construction.blueprints.has(s.ref)) return false;
    }
    return true;
  }

  /** Первая неготовая конструкция на пути (к ней надо идти строить). */
  pendingSegment(r: Route): RouteSegment | null {
    for (const s of r.segments) {
      if (s.kind === 'bridge' || s.kind === 'ladder' || s.kind === 'tower' || s.kind === 'water') {
        const st = this.sim.structures.get(s.ref);
        if (st && st.state !== SS.ACTIVE) return s;
      } else if (s.kind === 'tunnel' && s.ref >= 0 && this.sim.construction.blueprints.has(s.ref)) return s;
    }
    return null;
  }

  /** Длина маршрута. */
  length(r: Route): number {
    let L = 0;
    for (let k = 2; k < r.pts.length; k += 2) L += Math.hypot(r.pts[k] - r.pts[k - 2], r.pts[k + 1] - r.pts[k - 1]);
    return L;
  }

  /** Точка на маршруте по параметру s (в клетках от начала). */
  pointAt(r: Route, s: number, out: number[]): void {
    let acc = 0;
    for (let k = 2; k < r.pts.length; k += 2) {
      const x0 = r.pts[k - 2];
      const y0 = r.pts[k - 1];
      const x1 = r.pts[k];
      const y1 = r.pts[k + 1];
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (acc + l >= s) {
        const u = l > 0 ? (s - acc) / l : 0;
        out[0] = x0 + (x1 - x0) * u;
        out[1] = y0 + (y1 - y0) * u;
        out[2] = Math.atan2(y1 - y0, x1 - x0);
        return;
      }
      acc += l;
    }
    out[0] = r.pts[r.pts.length - 2];
    out[1] = r.pts[r.pts.length - 1];
    out[2] = 0;
  }

  /**
   * Обучение: маршрут оценивается по доставкам и опасности.
   * Хорошие маршруты получают больше муравьёв, опасные — меньше.
   */
  learn(dt: number): void {
    for (const r of this.routes.values()) {
      r.deliveries *= Math.exp(-dt / 300);
      r.danger *= Math.exp(-dt / 180);
      r.traffic *= Math.exp(-dt / 60);
      const len = Math.max(20, this.length(r));
      r.score = (1 + r.deliveries * 40 / len) / (1 + r.danger * 0.5);
    }
  }

  /** Создать выученный маршрут от гнезда к источнику еды по полю пути домой. */
  learnFromField(colonyId: number, fx: number, fy: number): Route | null {
    const sim = this.sim;
    const col = sim.colonies[colonyId];
    for (const r of this.routes.values()) if (r.colony === colonyId && Math.hypot(r.endX - fx, r.endY - fy) < 20) return r;
    const f = col.nest.field;
    if (f.dist(fx, fy) === 65535) return null;
    const pts: number[] = [];
    let x = Math.floor(fx) + 0.5;
    let y = Math.floor(fy) + 0.5;
    const dir = [0, 0];
    for (let k = 0; k < 4000; k++) {
      if (k % 4 === 0) pts.push(x, y);
      if (!f.descend(x, y, dir)) break;
      x += dir[0];
      y += dir[1];
      if (f.dist(x, y) <= 2) break;
    }
    pts.push(col.nest.entranceX + 0.5, col.nest.entranceY + 0.5);
    if (pts.length < 8) return null;
    // разворачиваем: от гнезда к еде
    const rev: number[] = [];
    for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]);
    const r: Route = {
      id: this.nextId++, colony: colonyId, pts: rev, segments: [{ kind: 'walk', from: 0, to: rev.length / 2 - 1, ref: -1 }],
      purpose: RP.FOOD, endX: fx, endY: fy, demand: 0, assigned: 0, deliveries: 0, danger: 0, traffic: 0, score: 1,
      created: sim.time, lastUsed: sim.time, player: false, stream: 0, streamPhase: sim.rng.next() * 1000, blocked: false,
      label: 'Выученный маршрут к еде',
    };
    this.routes.set(r.id, r);
    return r;
  }
}
