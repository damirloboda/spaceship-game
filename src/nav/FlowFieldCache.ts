import { DistanceField } from './DistanceField';
import { NavGrid } from './NavGrid';

interface Entry {
  field: DistanceField;
  lastUsed: number;
  getSources: () => number[];
}

export const FIELD_WIN_W = 480;
export const FIELD_WIN_H = 320;

/**
 * Кэш полей потока к общим целям (стройка, еда, мост, маршрут).
 * Тысячи муравьёв, идущих к одной цели, делят одно поле — стоимость навигации
 * не растёт с числом муравьёв. Поле строится в окне вокруг цели; дальше окна
 * муравей идёт по общему полю гнезда или по феромонам.
 */
export class FlowFieldCache {
  private entries = new Map<string, Entry>();
  private tick = 0;

  constructor(private nav: NavGrid, private W: number, private H: number, private maxFields = 12) {}

  get(key: string, cx: number, cy: number, getSources: () => number[]): DistanceField | null {
    let e = this.entries.get(key);
    if (!e) {
      if (this.entries.size >= this.maxFields) this.evict();
      const w = Math.min(this.W, FIELD_WIN_W);
      const h = Math.min(this.H, FIELD_WIN_H);
      const ox = Math.max(0, Math.min(this.W - w, (cx | 0) - (w >> 1)));
      const oy = Math.max(0, Math.min(this.H - h, (cy | 0) - (h >> 1)));
      const field = new DistanceField(this.nav, this.W, this.H, 60000, ox, oy, w, h);
      e = { field, lastUsed: this.tick, getSources };
      this.entries.set(key, e);
      field.begin(getSources());
    }
    e.lastUsed = this.tick;
    e.getSources = getSources;
    return e.field.complete ? e.field : null;
  }

  drop(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.field.cancel();
    this.entries.delete(key);
  }

  private evict(): void {
    let worst: string | null = null;
    let worstT = Infinity;
    for (const [k, e] of this.entries) if (e.lastUsed < worstT) { worstT = e.lastUsed; worst = k; }
    if (worst) this.drop(worst);
  }

  /** Достраивает поля и перестраивает устаревшие (мир изменился), с бюджетом. */
  update(budget: number, time: number): void {
    this.tick++;
    for (const [k, e] of this.entries) {
      if (this.tick - e.lastUsed > 900) { this.drop(k); continue; }
    }
    // строим строго по одному (общая очередь BFS)
    for (const e of this.entries.values()) {
      if (e.field.isBuilding) {
        e.field.step(budget);
        return;
      }
    }
    for (const e of this.entries.values()) {
      const f = e.field;
      if (f.builtVersion !== this.nav.version && time - f.lastBuildTime > 2) {
        f.lastBuildTime = time;
        f.begin(e.getSources());
        f.step(budget);
        return;
      }
    }
  }

  get count(): number {
    return this.entries.size;
  }

  // ---- локальные поля: окно 64x64, строятся мгновенно, для ближних целей ----
  private local = new Map<string, { field: DistanceField; lastUsed: number; version: number; time: number }>();

  /**
   * Локальное поле для цели рядом (до ~30 клеток): BFS на 4096 клеток стоит микросекунды,
   * поэтому строится синхронно. Решает проблему "локальных минимумов" прямого наведения
   * (травинка, ямка, выступ) без хранения пути на каждом муравье.
   */
  getLocal(key: string, cx: number, cy: number, getSources: () => number[], time: number): DistanceField {
    let e = this.local.get(key);
    if (e && e.version !== this.nav.version && time - e.time > 0.7) {
      e.field.buildNow(getSources());
      e.version = this.nav.version;
      e.time = time;
    }
    if (!e) {
      if (this.local.size >= 160) {
        let worst: string | null = null;
        let wt = Infinity;
        for (const [k, v] of this.local) if (v.lastUsed < wt) { wt = v.lastUsed; worst = k; }
        if (worst) this.local.delete(worst);
      }
      const w = 64;
      const h = 64;
      const ox = Math.max(0, Math.min(this.W - w, (cx | 0) - 32));
      const oy = Math.max(0, Math.min(this.H - h, (cy | 0) - 32));
      const field = new DistanceField(this.nav, this.W, this.H, 60000, ox, oy, w, h);
      field.buildNow(getSources());
      e = { field, lastUsed: this.tick, version: this.nav.version, time };
      this.local.set(key, e);
    }
    e.lastUsed = this.tick;
    return e.field;
  }
}
