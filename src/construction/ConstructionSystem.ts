import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { NavGrid } from '../nav/NavGrid';
import { IS_DIGGABLE, IS_SOLID, M, MATERIALS } from '../world/Materials';
import { F_FORBID, F_NEST, F_PLAN, F_TUNNEL, Terrain } from '../world/Terrain';

export const JK = { DIG: 0, BUILD: 1, REINFORCE: 2 } as const;
export const BPK = {
  DIG_AREA: 0,
  TUNNEL: 1,
  ROOM: 2,
  WALL: 3,
  REINFORCE: 4,
  PLUG: 5,
  RAMP: 6,
} as const;
export const BP_NAMES = ['Раскопка', 'Тоннель', 'Комната', 'Стена', 'Укрепление', 'Заслон', 'Пандус'];

export interface Job {
  id: number;
  kind: number;
  x: number;
  y: number;
  bp: number;
  claimed: number;
  claimT: number;
  progress: number;
  done: boolean;
}

export interface Blueprint {
  id: number;
  colony: number;
  kind: number;
  roomType: number;
  jobs: number[];
  remaining: number;
  x: number;
  y: number;
  player: boolean;
  priority: number;
  created: number;
  complete: boolean;
  /** для комнат — эллипс */
  rx: number;
  ry: number;
  label: string;
}

/**
 * Строительство — физический процесс. Игрок (или сама колония) задаёт план,
 * план разбивается на клеточные задачи (копать/уложить/укрепить); муравьи
 * берут ближайшую доступную задачу, добывают материал, приносят и укладывают.
 * Выкопанная земля физически выносится наружу — растёт холмик у входа.
 */
export class ConstructionSystem {
  jobs = new Map<number, Job>();
  blueprints = new Map<number, Blueprint>();
  private open: number[][] = [[], []];
  private nextJob = 1;
  private nextBp = 1;
  private jobAt = new Map<number, number>();
  onBlueprintComplete: ((bp: Blueprint) => void) | null = null;

  constructor(private t: Terrain, private nav: NavGrid, private bus: EventBus, private rng: Rng) {}

  addBlueprint(colony: number, kind: number, cells: [number, number, number][], opts: Partial<Blueprint> = {}): Blueprint | null {
    const bp: Blueprint = {
      id: this.nextBp++, colony, kind, roomType: -1, jobs: [], remaining: 0, x: 0, y: 0, player: false,
      priority: 1, created: 0, complete: false, rx: 0, ry: 0, label: '', ...opts,
    };
    let sx = 0;
    let sy = 0;
    for (const [x, y, jk] of cells) {
      if (!this.t.inBounds(x, y)) continue;
      const i = y * this.t.W + x;
      if (this.jobAt.has(i)) continue;
      const m = this.t.mat[i];
      if (jk === JK.DIG && !IS_DIGGABLE[m]) continue;
      if (jk === JK.DIG && m === M.AIR) continue;
      if (jk === JK.BUILD && IS_SOLID[m]) continue;
      if (jk === JK.REINFORCE && (!IS_SOLID[m] || !MATERIALS[m].buildable && m !== M.NESTWALL)) continue;
      if (jk === JK.REINFORCE && m === M.NESTWALL) continue;
      const job: Job = { id: this.nextJob++, kind: jk, x, y, bp: bp.id, claimed: -1, claimT: 0, progress: 0, done: false };
      this.jobs.set(job.id, job);
      this.jobAt.set(i, job.id);
      bp.jobs.push(job.id);
      this.openList(colony).push(job.id);
      this.t.flags[i] |= F_PLAN;
      this.t.renderDirty.markCell(x, y);
      sx += x;
      sy += y;
    }
    if (bp.jobs.length === 0) return null;
    bp.remaining = bp.jobs.length;
    if (!opts.x) { bp.x = sx / bp.jobs.length; bp.y = sy / bp.jobs.length; }
    this.blueprints.set(bp.id, bp);
    return bp;
  }

  private openList(colony: number): number[] {
    while (this.open.length <= colony) this.open.push([]);
    return this.open[colony];
  }

  cancelBlueprint(id: number): void {
    const bp = this.blueprints.get(id);
    if (!bp) return;
    for (const jid of bp.jobs) {
      const j = this.jobs.get(jid);
      if (!j) continue;
      this.finishJob(j, false);
    }
    this.blueprints.delete(id);
  }

  /** Может ли муравей работать над клеткой прямо сейчас (есть где стоять). */
  workable(j: Job): boolean {
    const t = this.t;
    const m = t.get(j.x, j.y);
    if (j.kind === JK.DIG && (!IS_DIGGABLE[m] || m === M.AIR)) return false;
    if (j.kind === JK.BUILD && IS_SOLID[m]) return false;
    if (j.kind === JK.REINFORCE && !IS_SOLID[m]) return false;
    return this.standCell(j) >= 0;
  }

  /** Клетка, с которой работают над задачей. */
  standCell(j: Job): number {
    const W = this.t.W;
    const dirs = j.kind === JK.BUILD ? [[0, 1], [-1, 0], [1, 0], [0, -1], [-1, 1], [1, 1]] : [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of dirs) {
      const x = j.x + dx;
      const y = j.y + dy;
      if (!this.t.inBounds(x, y)) continue;
      if (this.nav.walkable(x, y) && !(this.t.flags[y * W + x] & F_FORBID)) return y * W + x;
    }
    return -1;
  }

  /** Для BUILD: клетка должна к чему-то крепиться. */
  private attachable(j: Job): boolean {
    const t = this.t;
    return t.solid(j.x, j.y + 1) || t.solid(j.x - 1, j.y) || t.solid(j.x + 1, j.y) || t.solid(j.x, j.y - 1);
  }

  /**
   * Взять ближайшую доступную задачу. Выборка случайных кандидатов вместо полного
   * перебора — O(1) на запрос при любом числе задач.
   */
  claim(colony: number, antId: number, x: number, y: number, kinds: number, time: number, near?: [number, number]): Job | null {
    const list = this.openList(colony);
    if (list.length === 0) return null;
    let best: Job | null = null;
    let bestScore = Infinity;
    const samples = Math.min(list.length, 48);
    const px = near ? near[0] : x;
    const py = near ? near[1] : y;
    for (let s = 0; s < samples && list.length > 0; s++) {
      const k = list.length <= 48 ? s : this.rng.int(list.length);
      if (k >= list.length) break;
      const jid = list[k];
      const j = this.jobs.get(jid);
      if (!j || j.done) { list[k] = list[list.length - 1]; list.pop(); if (list.length <= 48) s--; continue; }
      if (j.claimed >= 0) continue;
      if (!((1 << j.kind) & kinds)) continue;
      if (!this.workable(j)) continue;
      if (j.kind === JK.BUILD && !this.attachable(j)) continue;
      const bp = this.blueprints.get(j.bp);
      const pr = bp ? (bp.player ? 0.6 : 1) / Math.max(0.2, bp.priority) : 1;
      // копать сверху вниз и снаружи внутрь: так тоннель не обрушивается на строителей
      const d = Math.hypot(j.x - px, j.y - py) * pr + (j.kind === JK.DIG ? 0 : 0);
      if (d < bestScore) { bestScore = d; best = j; }
    }
    if (best) {
      best.claimed = antId;
      best.claimT = time;
    }
    return best;
  }

  release(jobId: number): void {
    const j = this.jobs.get(jobId);
    if (j && !j.done) j.claimed = -1;
  }

  /** Отпускает задачи, взятые давно и не выполненные (муравей погиб/застрял). */
  expire(time: number, alive: (antId: number) => boolean): void {
    for (const j of this.jobs.values()) {
      if (j.claimed >= 0 && (time - j.claimT > 45 || !alive(j.claimed))) j.claimed = -1;
      if (!j.done) {
        const m = this.t.get(j.x, j.y);
        if (j.kind === JK.DIG && (m === M.AIR || !IS_DIGGABLE[m])) this.finishJob(j, true);
        else if (j.kind === JK.BUILD && IS_SOLID[m]) this.finishJob(j, true);
        else if (j.kind === JK.REINFORCE && (m === M.NESTWALL || !IS_SOLID[m])) this.finishJob(j, true);
      }
    }
  }

  /** Работа копателя. Возвращает материал добытого куска или -1, если ещё не докопал. */
  dig(j: Job, power: number, dt: number): number {
    const t = this.t;
    const i = j.y * t.W + j.x;
    const m = t.mat[i];
    if (!IS_DIGGABLE[m] || m === M.AIR) { this.finishJob(j, true); return -2; }
    const hard = MATERIALS[m].hardness * (t.moist[i] > 150 ? 0.7 : 1);
    j.progress += (power * dt) / Math.max(0.05, hard);
    t.hp[i] = Math.max(1, Math.round(255 * (1 - j.progress)));
    if (j.progress >= 1) {
      const yields = MATERIALS[m].yields;
      const bp = this.blueprints.get(j.bp);
      t.set(j.x, j.y, M.AIR);
      t.flags[i] |= F_TUNNEL;
      if (bp && (bp.kind === BPK.ROOM || bp.kind === BPK.TUNNEL)) t.flags[i] |= F_NEST;
      this.bus.emit({ type: 'dig', x: j.x, y: j.y, mat: m });
      this.finishJob(j, true);
      return yields;
    }
    t.renderDirty.markCell(j.x, j.y);
    return -1;
  }

  /** Уложить кусок материала. */
  place(j: Job, material: number): boolean {
    const t = this.t;
    const i = j.y * t.W + j.x;
    if (j.kind === JK.BUILD) {
      if (IS_SOLID[t.mat[i]]) { this.finishJob(j, true); return false; }
      const m = material === M.CLAY ? M.NESTWALL : M.BUILT;
      t.set(j.x, j.y, m);
      t.moist[i] = 60;
    } else if (j.kind === JK.REINFORCE) {
      if (!IS_SOLID[t.mat[i]]) { this.finishJob(j, true); return false; }
      t.set(j.x, j.y, M.NESTWALL, true);
    }
    this.bus.emit({ type: 'build', x: j.x, y: j.y });
    this.finishJob(j, true);
    return true;
  }

  private finishJob(j: Job, success: boolean): void {
    if (j.done) return;
    j.done = true;
    j.claimed = -1;
    const i = j.y * this.t.W + j.x;
    this.jobAt.delete(i);
    this.t.flags[i] &= ~F_PLAN;
    this.t.renderDirty.markCell(j.x, j.y);
    this.jobs.delete(j.id);
    const bp = this.blueprints.get(j.bp);
    if (bp) {
      bp.remaining--;
      if (bp.remaining <= 0 && !bp.complete) {
        bp.complete = true;
        this.blueprints.delete(bp.id);
        if (success) this.onBlueprintComplete?.(bp);
      }
    }
  }

  jobAtCell(x: number, y: number): Job | undefined {
    const id = this.jobAt.get(y * this.t.W + x);
    return id ? this.jobs.get(id) : undefined;
  }

  openCount(colony: number): number {
    let n = 0;
    for (const bp of this.blueprints.values()) if (bp.colony === colony) n += bp.remaining;
    return n;
  }

  /** Сколько задач можно выполнять прямо сейчас (с доступом) — для стимула стройки. */
  workableCount(colony: number, limit = 200): number {
    const list = this.openList(colony);
    let n = 0;
    const step = Math.max(1, Math.floor(list.length / limit));
    for (let k = 0; k < list.length; k += step) {
      const j = this.jobs.get(list[k]);
      if (j && !j.done && j.claimed < 0 && this.workable(j)) n += step;
    }
    return n;
  }

  /** Клетки-источники для поля потока к стройке (где стоять). */
  frontierCells(bpId: number, max = 400): number[] {
    const bp = this.blueprints.get(bpId);
    if (!bp) return [];
    const out: number[] = [];
    for (const jid of bp.jobs) {
      const j = this.jobs.get(jid);
      if (!j || j.done) continue;
      const s = this.standCell(j);
      if (s >= 0) out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Найти рядом материал для стройки (рыхлая земля, отвал, земля стены). */
  findMaterial(x: number, y: number, radius: number): [number, number] | null {
    const t = this.t;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let k = 0; k < 90; k++) {
      const cx = Math.round(x + (this.rng.next() * 2 - 1) * radius);
      const cy = Math.round(y + (this.rng.next() * 2 - 1) * radius);
      if (!t.inBounds(cx, cy)) continue;
      const i = cy * t.W + cx;
      const m = t.mat[i];
      if (!(m === M.LOOSE || m === M.SOIL || m === M.SAND || m === M.MUD || m === M.CLAY || m === M.TOPSOIL)) continue;
      if (t.flags[i] & (F_PLAN | F_FORBID)) continue;
      if (t.plant[i]) continue;
      // не подкапываем стены гнезда
      if (m !== M.LOOSE && (t.flags[i - t.W] & F_NEST || t.flags[i + t.W] & F_NEST)) continue;
      let stand = false;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0]]) if (this.nav.walkable(cx + dx, cy + dy)) stand = true;
      if (!stand) continue;
      const d = Math.hypot(cx - x, cy - y) * (m === M.LOOSE ? 0.4 : 1);
      if (d < bestD) { bestD = d; best = [cx, cy]; }
    }
    return best;
  }
}
