import { EventBus } from '../core/EventBus';
import { lineCells } from '../core/MathUtil';
import { NavGrid } from '../nav/NavGrid';
import { Terrain } from '../world/Terrain';

export const SK = { BRIDGE: 0, LADDER: 1, TOWER: 2 } as const;
export const SK_NAMES = ['Живой мост', 'Живая лестница', 'Живая башня'];
export const SS = { FORMING: 0, ACTIVE: 1, DISSOLVING: 2 } as const;

export const NODE_SPACING = 0.8;

export interface LivingStructure {
  id: number;
  colony: number;
  kind: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nodes: number;
  /** итоговые позиции узлов */
  nx: Float32Array;
  ny: Float32Array;
  /** текущие отображаемые позиции (цепь провисает, пока не дотянулась) */
  cx: Float32Array;
  cy: Float32Array;
  nodeAnt: Int32Array;
  filled: number;
  state: number;
  joiners: number;
  /** толщина: дополнительные (абстрактные) муравьи, уплотняющие мост при большом трафике */
  thickness: number;
  targetThickness: number;
  lastUsed: number;
  crossings: number;
  routeId: number;
  cells: number[];
  created: number;
  dissolveT: number;
  permanent: boolean;
}

/**
 * Живые конструкции из тел муравьёв. Первый муравей фиксируется на якоре,
 * следующие проходят по цепи до её конца и цепляются к нему. Пока цепь не
 * дотянулась до противоположной опоры, она свисает как консоль — и выпрямляется,
 * когда замыкается. Готовая конструкция становится проходимой для всех.
 * Если звено гибнет — цепь рвётся, часть муравьёв срывается, и колония её достраивает.
 */
export class LivingStructures {
  items = new Map<number, LivingStructure>();
  /** клетка -> id конструкции (для быстрого "по чему я иду") */
  cellOwner = new Map<number, number>();
  private nextId = 1;
  /** колбэк: отпустить муравья из конструкции (он снова свободный агент) */
  onRelease: ((antId: number, fall: boolean) => void) | null = null;

  constructor(private t: Terrain, private nav: NavGrid, private bus: EventBus) {}

  create(colony: number, kind: number, ax: number, ay: number, bx: number, by: number, time: number, routeId = -1): LivingStructure {
    const span = Math.hypot(bx - ax, by - ay);
    const nodes = Math.max(2, Math.ceil(span / NODE_SPACING) + 1);
    const s: LivingStructure = {
      id: this.nextId++, colony, kind, ax, ay, bx, by, nodes,
      nx: new Float32Array(nodes), ny: new Float32Array(nodes), cx: new Float32Array(nodes), cy: new Float32Array(nodes),
      nodeAnt: new Int32Array(nodes).fill(-1), filled: 0, state: SS.FORMING, joiners: 0, thickness: 0, targetThickness: 0,
      lastUsed: time, crossings: 0, routeId, cells: [], created: time, dissolveT: 0, permanent: routeId >= 0,
    };
    const sag = kind === SK.BRIDGE ? Math.min(5, span * 0.07) : 0;
    for (let k = 0; k < nodes; k++) {
      const u = k / (nodes - 1);
      s.nx[k] = ax + (bx - ax) * u;
      s.ny[k] = ay + (by - ay) * u + Math.sin(u * Math.PI) * sag;
      s.cx[k] = s.nx[k];
      s.cy[k] = s.ny[k];
    }
    this.items.set(s.id, s);
    return s;
  }

  get(id: number): LivingStructure | undefined {
    return this.items.get(id);
  }

  /** Сколько ещё муравьёв нужно конструкции. */
  demand(s: LivingStructure): number {
    if (s.state !== SS.FORMING) return 0;
    return Math.max(0, s.nodes - s.filled - s.joiners);
  }

  /** Позиция, куда должен встать следующий муравей (конец цепи). */
  tipPos(s: LivingStructure, out: number[]): void {
    const k = Math.max(0, s.filled - 1);
    out[0] = s.filled === 0 ? s.ax : s.cx[k];
    out[1] = s.filled === 0 ? s.ay : s.cy[k];
  }

  /** Муравей добрался до конца цепи — цепляется. */
  lock(s: LivingStructure, antId: number, time: number): number {
    if (s.state !== SS.FORMING || s.filled >= s.nodes) return -1;
    const k = s.filled++;
    s.nodeAnt[k] = antId;
    s.lastUsed = time;
    if (s.filled >= s.nodes) this.activate(s, time);
    return k;
  }

  private activate(s: LivingStructure, time: number): void {
    s.state = SS.ACTIVE;
    s.lastUsed = time;
    // растеризуем путь в клетки "живой конструкции" — теперь по ней можно ходить
    const cells: number[][] = [];
    for (let k = 0; k < s.nodes - 1; k++) lineCells(Math.floor(s.nx[k]), Math.floor(s.ny[k]), Math.floor(s.nx[k + 1]), Math.floor(s.ny[k + 1]), cells);
    const seen = new Set<number>();
    for (const [x, y] of cells) {
      for (const dy of s.kind === SK.BRIDGE ? [0, -1] : [0]) {
        for (const dx of s.kind === SK.BRIDGE ? [0] : [0, 1, -1]) {
          const xx = x + dx;
          const yy = y + dy;
          if (!this.t.inBounds(xx, yy)) continue;
          const i = yy * this.t.W + xx;
          if (seen.has(i) || this.t.solidI(i)) continue;
          seen.add(i);
          this.nav.addStruct(xx, yy, 1);
          s.cells.push(i);
          this.cellOwner.set(i, s.id);
        }
      }
    }
    for (let k = 0; k < s.nodes; k++) { s.cx[k] = s.nx[k]; s.cy[k] = s.ny[k]; }
    this.bus.emit({ type: 'structureComplete', id: s.id, kind: s.kind, ants: s.nodes, x: (s.ax + s.bx) / 2, y: (s.ay + s.by) / 2 });
  }

  private deactivateCells(s: LivingStructure): void {
    for (const i of s.cells) {
      this.nav.addStruct(i % this.t.W, (i / this.t.W) | 0, -1);
      if (this.cellOwner.get(i) === s.id) this.cellOwner.delete(i);
    }
    s.cells = [];
  }

  /** Звено погибло или ушло — разрыв. */
  onNodeLost(s: LivingStructure, antId: number): void {
    let k = -1;
    for (let j = 0; j < s.filled; j++) if (s.nodeAnt[j] === antId) { k = j; break; }
    if (k < 0) return;
    s.nodeAnt[k] = -1;
    if (s.state === SS.DISSOLVING) return;
    // всё, что дальше разрыва, срывается
    for (let j = k + 1; j < s.filled; j++) {
      const a = s.nodeAnt[j];
      s.nodeAnt[j] = -1;
      if (a >= 0) this.onRelease?.(a, true);
    }
    s.filled = k;
    if (s.state === SS.ACTIVE) {
      this.deactivateCells(s);
      s.state = SS.FORMING;
    }
  }

  dissolve(s: LivingStructure, time: number): void {
    if (s.state === SS.DISSOLVING) return;
    s.state = SS.DISSOLVING;
    s.dissolveT = time;
  }

  remove(s: LivingStructure): void {
    for (let k = 0; k < s.filled; k++) {
      const a = s.nodeAnt[k];
      if (a >= 0) this.onRelease?.(a, false);
    }
    this.deactivateCells(s);
    this.items.delete(s.id);
    this.bus.emit({ type: 'structureDissolved', id: s.id });
  }

  update(dt: number, time: number, abstractPool: (colony: number, want: number) => number): void {
    for (const s of this.items.values()) {
      if (s.state === SS.FORMING) {
        // консоль провисает тем сильнее, чем длиннее и чем дальше от замыкания
        const tip = Math.max(1, s.filled);
        const frac = s.filled / s.nodes;
        const span = Math.hypot(s.bx - s.ax, s.by - s.ay);
        const droop = s.kind === SK.BRIDGE ? span * 0.35 * (1 - frac) * Math.min(1, frac * 3) : 0;
        for (let k = 0; k < s.nodes; k++) {
          const u = Math.min(1, k / tip);
          const tx = s.nx[k];
          const ty = s.ny[k] + droop * u * u;
          s.cx[k] += (tx - s.cx[k]) * Math.min(1, dt * 4);
          s.cy[k] += (ty - s.cy[k]) * Math.min(1, dt * 4);
        }
        // без трафика и без строителей долго — бросаем
        if (!s.permanent && time - s.lastUsed > 120 && s.joiners === 0) this.dissolve(s, time);
      } else if (s.state === SS.ACTIVE) {
        // уплотнение моста массой колонии при большом трафике
        const want = Math.min(s.nodes * 6, Math.floor(s.crossings * 0.6));
        s.targetThickness = want;
        if (s.thickness < want) s.thickness += abstractPool(s.colony, Math.min(want - s.thickness, Math.ceil(dt * 30)));
        else if (s.thickness > want + 5) {
          const d = Math.ceil(dt * 20);
          s.thickness -= d;
          abstractPool(s.colony, -d);
        }
        s.crossings *= Math.exp(-dt / 40);
        if (!s.permanent && time - s.lastUsed > 90) this.dissolve(s, time);
      } else {
        // распад: отпускаем звенья с дальнего конца
        if (s.thickness > 0) {
          const d = Math.min(s.thickness, Math.ceil(dt * 60));
          s.thickness -= d;
          abstractPool(s.colony, -d);
        }
        if (time - s.dissolveT > 0.12) {
          s.dissolveT = time;
          let released = false;
          for (let k = s.filled - 1; k >= 0; k--) {
            if (s.nodeAnt[k] >= 0) {
              this.onRelease?.(s.nodeAnt[k], false);
              s.nodeAnt[k] = -1;
              s.filled = k;
              released = true;
              break;
            }
          }
          if (!released || s.filled <= 0) this.remove(s);
        }
      }
    }
  }

  /** Муравей прошёл по конструкции — она "нужна". */
  markUsed(s: LivingStructure, time: number): void {
    s.lastUsed = time;
    s.crossings += 1;
  }

  /** Индекс конструкции в клетке. */
  structureAtCell(i: number): LivingStructure | undefined {
    const id = this.cellOwner.get(i);
    return id === undefined ? undefined : this.items.get(id);
  }

  totalAnts(colony: number): number {
    let n = 0;
    for (const s of this.items.values()) if (s.colony === colony) n += s.filled + s.thickness;
    return n;
  }
}
