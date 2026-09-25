import { NavGrid } from './NavGrid';

export const UNREACHED = 65535;

/**
 * Поле расстояний (BFS по проходимым клеткам от набора источников) в окне мира.
 * Строится инкрементально с бюджетом клеток за кадр и двойной буферизацией:
 * пока строится новое поле, муравьи пользуются старым — никаких фризов.
 * Очередь BFS общая для всех полей: одновременно строится только одно поле
 * (планировщик), так что память не растёт с числом целей.
 */
export class DistanceField {
  field: Uint16Array;
  private building: Uint16Array;
  private static queue: Int32Array = new Int32Array(0);
  private static owner: DistanceField | null = null;
  /** маленькие поля (локальная навигация) имеют свою очередь и не ждут общую */
  private localQueue: Int32Array | null = null;
  private qHead = 0;
  private qTail = 0;
  private sources: number[] = [];
  private busy = false;
  private started = false;
  complete = false;
  builtVersion = -1;
  pendingVersion = -1;
  lastBuildTime = -1e9;
  readonly worldW: number;
  readonly worldH: number;

  /**
   * @param ox,oy,w,h — окно в клетках мира (по умолчанию весь мир)
   */
  constructor(
    private nav: NavGrid,
    worldW: number,
    worldH: number,
    private maxDist = 60000,
    readonly ox = 0,
    readonly oy = 0,
    readonly w = worldW,
    readonly h = worldH,
  ) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.field = new Uint16Array(w * h).fill(UNREACHED);
    this.building = new Uint16Array(w * h);
    if (w * h <= 128 * 128) this.localQueue = new Int32Array(w * h);
    else if (DistanceField.queue.length < w * h) DistanceField.queue = new Int32Array(w * h);
  }

  get isBuilding(): boolean {
    return this.busy;
  }

  /** Источники — индексы клеток мира. */
  begin(sourceCells: number[]): void {
    this.sources = sourceCells.slice();
    this.busy = true;
    this.started = false;
    this.pendingVersion = this.nav.version;
  }

  private start(): void {
    this.building.fill(UNREACHED);
    this.qHead = 0;
    this.qTail = 0;
    const q = this.localQueue ?? DistanceField.queue;
    const W = this.worldW;
    for (const s of this.sources) {
      const x = (s % W) - this.ox;
      const y = ((s / W) | 0) - this.oy;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
      const li = y * this.w + x;
      if (this.building[li] === 0) continue;
      this.building[li] = 0;
      q[this.qTail++] = li;
    }
    this.started = true;
  }

  /** Обработать до budget клеток. Возвращает true, когда поле достроено. */
  step(budget: number): boolean {
    if (!this.busy) return true;
    const local = this.localQueue !== null;
    if (!local) {
      if (DistanceField.owner && DistanceField.owner !== this) return false;
      DistanceField.owner = this;
    }
    if (!this.started) this.start();
    const w = this.w;
    const h = this.h;
    const W = this.worldW;
    const base = this.oy * W + this.ox;
    const b = this.building;
    const q = this.localQueue ?? DistanceField.queue;
    const nav = this.nav;
    const maxD = this.maxDist;
    let n = 0;
    while (this.qHead < this.qTail && n < budget) {
      const li = q[this.qHead++];
      n++;
      const d = b[li] + 1;
      if (d >= maxD) continue;
      const x = li % w;
      const y = (li / w) | 0;
      const wi = base + y * W + x;
      // 8-связность: муравей движется непрерывно и проходит по диагонали между углами
      const xl = x > 0;
      const xr = x < w - 1;
      const yu = y > 0;
      const yd = y < h - 1;
      if (xl && b[li - 1] === UNREACHED && nav.walkableI(wi - 1)) { b[li - 1] = d; q[this.qTail++] = li - 1; }
      if (xr && b[li + 1] === UNREACHED && nav.walkableI(wi + 1)) { b[li + 1] = d; q[this.qTail++] = li + 1; }
      if (yu && b[li - w] === UNREACHED && nav.walkableI(wi - W)) { b[li - w] = d; q[this.qTail++] = li - w; }
      if (yd && b[li + w] === UNREACHED && nav.walkableI(wi + W)) { b[li + w] = d; q[this.qTail++] = li + w; }
      if (xl && yu && b[li - w - 1] === UNREACHED && nav.walkableI(wi - W - 1)) { b[li - w - 1] = d; q[this.qTail++] = li - w - 1; }
      if (xr && yu && b[li - w + 1] === UNREACHED && nav.walkableI(wi - W + 1)) { b[li - w + 1] = d; q[this.qTail++] = li - w + 1; }
      if (xl && yd && b[li + w - 1] === UNREACHED && nav.walkableI(wi + W - 1)) { b[li + w - 1] = d; q[this.qTail++] = li + w - 1; }
      if (xr && yd && b[li + w + 1] === UNREACHED && nav.walkableI(wi + W + 1)) { b[li + w + 1] = d; q[this.qTail++] = li + w + 1; }
    }
    if (this.qHead >= this.qTail) {
      const tmp = this.field;
      this.field = this.building;
      this.building = tmp;
      this.busy = false;
      this.complete = true;
      this.builtVersion = this.pendingVersion;
      if (!local) DistanceField.owner = null;
      return true;
    }
    return false;
  }

  /** Отменить постройку (освободить очередь). */
  cancel(): void {
    if (DistanceField.owner === this) DistanceField.owner = null;
    this.busy = false;
  }

  /** Построить сразу целиком (для генерации и тестов). */
  buildNow(sourceCells: number[]): void {
    if (!this.localQueue && DistanceField.owner && DistanceField.owner !== this) {
      // принудительно: прерываем чужую постройку, она перезапустится
      const other = DistanceField.owner;
      other.started = false;
      DistanceField.owner = null;
    }
    this.begin(sourceCells);
    this.step(Number.MAX_SAFE_INTEGER);
  }

  contains(x: number, y: number): boolean {
    const lx = (x | 0) - this.ox;
    const ly = (y | 0) - this.oy;
    return lx >= 1 && ly >= 1 && lx < this.w - 1 && ly < this.h - 1;
  }

  dist(x: number, y: number): number {
    const lx = (x | 0) - this.ox;
    const ly = (y | 0) - this.oy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return UNREACHED;
    return this.field[ly * this.w + lx];
  }

  /**
   * Направление спуска по полю из точки (x,y). Возвращает false, если клетка
   * не достигнута полем. Результат пишется в out[0], out[1] (нормированный вектор).
   */
  descend(x: number, y: number, out: Float32Array | number[]): boolean {
    const w = this.w;
    const lx = (x | 0) - this.ox;
    const ly = (y | 0) - this.oy;
    if (lx < 1 || ly < 1 || lx >= w - 1 || ly >= this.h - 1) return false;
    const f = this.field;
    const i = ly * w + lx;
    let d0 = f[i];
    if (d0 === UNREACHED) {
      let best = UNREACHED;
      let bx = 0;
      let by = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = f[i + dy * w + dx];
        if (v < best) { best = v; bx = dx; by = dy; }
      }
      if (best === UNREACHED) return false;
      const l = Math.hypot(bx, by) || 1;
      out[0] = bx / l;
      out[1] = by / l;
      return true;
    }
    if (d0 === 0) return false;
    let gx = 0;
    let gy = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const v = f[i + dy * w + dx];
        if (v === UNREACHED || v >= d0) continue;
        const wgt = (d0 - v) / (dx !== 0 && dy !== 0 ? 1.41 : 1);
        gx += dx * wgt;
        gy += dy * wgt;
      }
    }
    const l = Math.hypot(gx, gy);
    if (l < 1e-6) return false;
    out[0] = gx / l;
    out[1] = gy / l;
    return true;
  }
}
