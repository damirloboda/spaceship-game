/** Типы феромонов. */
export const P = {
  FOOD: 0, // след к еде — кладут муравьи, несущие еду домой
  HOME: 1, // след к дому — кладут уходящие из гнезда
  DANGER: 2, // тревога: хищник, обвал, вода
  EXPLORATION: 3, // "здесь уже были" — толкает разведку к неизведанному
  ATTACK: 4, // сбор солдат на цель
  RETREAT: 5, // путь отступления
  BUILD: 6, // стройка зовёт строителей
  RESOURCE: 7, // след к строительным ресурсам (листья, ветки, глина)
} as const;
export const P_COUNT = 8;
export const P_NAMES = ['FOOD', 'HOME', 'DANGER', 'EXPLORATION', 'ATTACK', 'RETREAT', 'BUILD', 'RESOURCE'];

/** Период полураспада (сек) и диффузия по каналам. */
const HALF_LIFE = [45, 110, 10, 150, 7, 12, 25, 60];
const DIFFUSION = [0.01, 0.005, 0.18, 0.004, 0.22, 0.12, 0.05, 0.01];
const CAP = [12, 12, 8, 6, 8, 6, 8, 12];
const TRAFFIC_HALF_LIFE = 480;

export const PH_CELL = 2; // клеток мира на клетку феромона
const CHUNK = 16; // клеток феромона на сторону чанка

/**
 * Поле феромонов. Отдельное на каждую колонию. Клетка поля — 2x2 клетки мира.
 * Испарение/диффузия считаются только в активных чанках и с учётом реально
 * прошедшего времени чанка, поэтому стоимость пропорциональна площади следов, а не мира.
 *
 * traffic — долговременная "протоптанность" (сколько муравьёв прошло).
 * Из неё колония учит маршруты, а рендер рисует натоптанные дороги.
 */
export class PheromoneField {
  readonly w: number;
  readonly h: number;
  readonly ch: Float32Array[];
  readonly traffic: Float32Array;
  private cw: number;
  private chh: number;
  private active: Uint8Array;
  private activeList: number[] = [];
  private lastT: Float32Array;
  private cursor = 0;
  /** чанки, изменившиеся с последней выгрузки в текстуру */
  readonly renderDirty = new Set<number>();
  private decayK: number[];

  constructor(worldW: number, worldH: number) {
    this.w = Math.ceil(worldW / PH_CELL);
    this.h = Math.ceil(worldH / PH_CELL);
    this.ch = [];
    for (let c = 0; c < P_COUNT; c++) this.ch.push(new Float32Array(this.w * this.h));
    this.traffic = new Float32Array(this.w * this.h);
    this.cw = Math.ceil(this.w / CHUNK);
    this.chh = Math.ceil(this.h / CHUNK);
    this.active = new Uint8Array(this.cw * this.chh);
    this.lastT = new Float32Array(this.cw * this.chh);
    this.decayK = HALF_LIFE.map((h) => Math.LN2 / h);
  }

  get chunkCols(): number {
    return this.cw;
  }

  get chunkRows(): number {
    return this.chh;
  }

  get chunkSize(): number {
    return CHUNK;
  }

  cellIndex(x: number, y: number): number {
    let cx = (x / PH_CELL) | 0;
    let cy = (y / PH_CELL) | 0;
    if (cx < 0) cx = 0; else if (cx >= this.w) cx = this.w - 1;
    if (cy < 0) cy = 0; else if (cy >= this.h) cy = this.h - 1;
    return cy * this.w + cx;
  }

  private activate(ci: number, time: number): void {
    const cx = (ci % this.w) / CHUNK | 0;
    const cy = ((ci / this.w) | 0) / CHUNK | 0;
    const k = cy * this.cw + cx;
    if (!this.active[k]) {
      this.active[k] = 1;
      this.lastT[k] = time;
      this.activeList.push(k);
    }
  }

  deposit(c: number, x: number, y: number, amount: number, time: number): void {
    const i = this.cellIndex(x, y);
    const a = this.ch[c];
    const v = a[i] + amount;
    a[i] = v > CAP[c] ? CAP[c] : v;
    this.activate(i, time);
  }

  /** Отложить в радиусе (для тревоги/обвалов). */
  splash(c: number, x: number, y: number, radius: number, amount: number, time: number): void {
    const r = Math.max(1, Math.ceil(radius / PH_CELL));
    const cx = (x / PH_CELL) | 0;
    const cy = (y / PH_CELL) | 0;
    const a = this.ch[c];
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= this.h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= this.w) continue;
        const d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d > 1) continue;
        const i = yy * this.w + xx;
        const v = a[i] + amount * (1 - d);
        a[i] = v > CAP[c] ? CAP[c] : v;
        this.activate(i, time);
      }
    }
  }

  addTraffic(x: number, y: number, amount: number, time: number): void {
    const i = this.cellIndex(x, y);
    this.traffic[i] = Math.min(1000, this.traffic[i] + amount);
    this.activate(i, time);
  }

  sample(c: number, x: number, y: number): number {
    return this.ch[c][this.cellIndex(x, y)];
  }

  /**
   * Обновить до maxChunks активных чанков: испарение, диффузия, протоптанность.
   * Время для каждого чанка берётся фактическое (time - lastT), поэтому порядок обхода не влияет на результат.
   */
  update(time: number, maxChunks: number): void {
    const list = this.activeList;
    if (list.length === 0) return;
    const n = Math.min(maxChunks, list.length);
    const w = this.w;
    const trafficK = Math.LN2 / TRAFFIC_HALF_LIFE;
    for (let s = 0; s < n; s++) {
      if (this.cursor >= list.length) this.cursor = 0;
      const k = list[this.cursor];
      const dt = time - this.lastT[k];
      if (dt < 0.2) { this.cursor++; continue; }
      this.lastT[k] = time;
      const x0 = (k % this.cw) * CHUNK;
      const y0 = ((k / this.cw) | 0) * CHUNK;
      const x1 = Math.min(this.w, x0 + CHUNK);
      const y1 = Math.min(this.h, y0 + CHUNK);
      let alive = 0;
      for (let c = 0; c < P_COUNT; c++) {
        const a = this.ch[c];
        const decay = Math.exp(-this.decayK[c] * dt);
        const diff = Math.min(0.45, DIFFUSION[c] * dt * 4);
        for (let y = y0; y < y1; y++) {
          let i = y * w + x0;
          for (let x = x0; x < x1; x++, i++) {
            let v = a[i];
            if (diff > 0 && x > 0 && x < w - 1 && y > 0 && y < this.h - 1) {
              const avg = (a[i - 1] + a[i + 1] + a[i - w] + a[i + w]) * 0.25;
              if (avg > 0.001 || v > 0.001) v = v + (avg - v) * diff;
            }
            v *= decay;
            if (v < 0.003) v = 0;
            else alive++;
            a[i] = v;
          }
        }
      }
      const tdecay = Math.exp(-trafficK * dt);
      for (let y = y0; y < y1; y++) {
        let i = y * w + x0;
        for (let x = x0; x < x1; x++, i++) {
          const v = this.traffic[i] * tdecay;
          if (v < 0.01) this.traffic[i] = 0;
          else { this.traffic[i] = v; alive++; }
        }
      }
      this.renderDirty.add(k);
      if (alive === 0) {
        this.active[k] = 0;
        list[this.cursor] = list[list.length - 1];
        list.pop();
      } else {
        this.cursor++;
      }
    }
  }

  get activeChunks(): number {
    return this.activeList.length;
  }

  /** Границы чанка в клетках поля. */
  chunkRect(k: number): [number, number, number, number] {
    const x0 = (k % this.cw) * CHUNK;
    const y0 = ((k / this.cw) | 0) * CHUNK;
    return [x0, y0, Math.min(this.w, x0 + CHUNK), Math.min(this.h, y0 + CHUNK)];
  }

  /** Полная реактивация после загрузки сохранения. */
  reactivateAll(time: number): void {
    for (let i = 0; i < this.w * this.h; i++) {
      let any = this.traffic[i] > 0;
      for (let c = 0; c < P_COUNT && !any; c++) any = this.ch[c][i] > 0;
      if (any) this.activate(i, time);
    }
    for (let k = 0; k < this.cw * this.chh; k++) this.renderDirty.add(k);
  }
}
