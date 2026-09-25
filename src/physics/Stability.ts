import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { IS_GRANULAR, IS_SOLID, M, SPAN } from '../world/Materials';
import { F_SETTLED, Terrain } from '../world/Terrain';

/**
 * Устойчивость конструкций.
 * Правило пролёта: твёрдая клетка держится, если под ней опора, либо если
 * в пределах пролёта материала (span) по горизонтали есть непрерывная цепочка
 * клеток до клетки, стоящей на опоре. Неопорные клетки не падают мгновенно:
 * в них копится напряжение (видимые трещины) — у колонии есть время отреагировать:
 * укрепить потолок, эвакуировать личинок. Если не успели — обвал.
 */
export class Stability {
  private queue: number[] = [];
  private queued: Uint8Array;
  readonly stressed = new Set<number>();
  private checkTimer = 0;
  collapsedThisTick = 0;
  /** Колбэк "клетка в опасности" — колония ставит задачу на укрепление. */
  onStressed: ((x: number, y: number) => void) | null = null;

  constructor(private t: Terrain, private bus: EventBus, private rng: Rng) {
    this.queued = new Uint8Array(t.size);
    t.onChange((x, y, _old, nm) => {
      if (!IS_SOLID[nm]) this.onRemoved(x, y);
      else this.enqueue(x, y);
    });
  }

  enqueue(x: number, y: number): void {
    if (!this.t.inBounds(x, y)) return;
    const i = y * this.t.W + x;
    if (this.queued[i]) return;
    this.queued[i] = 1;
    this.queue.push(i);
  }

  /** Клетка стала пустой — соседи сверху и сбоку могли потерять опору. */
  private onRemoved(x: number, y: number): void {
    for (let dx = -10; dx <= 10; dx++) {
      this.enqueue(x + dx, y - 1);
      if (dx !== 0 && Math.abs(dx) <= 10) this.enqueue(x + dx, y);
    }
  }

  effectiveSpan(i: number): number {
    const t = this.t;
    const m = t.mat[i];
    let s = SPAN[m];
    if (t.flags[i] & F_SETTLED) s = s * 1.5 + 1;
    const moist = t.moist[i];
    if (moist > 170) s *= 0.55;
    else if (moist > 110) s *= 0.8;
    return s;
  }

  supported(x: number, y: number): boolean {
    const t = this.t;
    const W = t.W;
    const i = y * W + x;
    const m = t.mat[i];
    if (!IS_SOLID[m] || IS_GRANULAR[m]) return true;
    if (SPAN[m] >= 999) return true;
    if (t.plant[i] !== 0) return true; // растения держатся своей структурой
    if (y >= t.H - 1) return true;
    if (IS_SOLID[t.mat[i + W]]) return true;
    const span = this.effectiveSpan(i);
    for (const dir of [-1, 1]) {
      for (let d = 1; d <= span; d++) {
        const xx = x + dir * d;
        if (xx < 0 || xx >= W) return true;
        const j = y * W + xx;
        if (!IS_SOLID[t.mat[j]] || IS_GRANULAR[t.mat[j]]) break;
        if (IS_SOLID[t.mat[j + W]]) return true;
      }
    }
    return false;
  }

  update(dt: number, budget: number): void {
    this.collapsedThisTick = 0;
    const t = this.t;
    const W = t.W;
    let n = 0;
    while (this.queue.length > 0 && n < budget) {
      const i = this.queue.pop()!;
      this.queued[i] = 0;
      n++;
      const x = i % W;
      const y = (i / W) | 0;
      if (!IS_SOLID[t.mat[i]] || IS_GRANULAR[t.mat[i]]) continue;
      if (!this.supported(x, y)) {
        if (!this.stressed.has(i)) {
          this.stressed.add(i);
          this.onStressed?.(x, y);
        }
      }
    }
    this.checkTimer += dt;
    if (this.checkTimer < 0.5) return;
    const step = this.checkTimer;
    this.checkTimer = 0;
    const collapse: number[] = [];
    for (const i of this.stressed) {
      const x = i % W;
      const y = (i / W) | 0;
      if (!IS_SOLID[t.mat[i]] || IS_GRANULAR[t.mat[i]] || this.supported(x, y)) {
        this.stressed.delete(i);
        t.stress[i] = 0;
        t.renderDirty.markCell(x, y);
        continue;
      }
      const wet = t.moist[i] > 150 ? 2 : 1;
      const inc = (22 + this.rng.next() * 30) * wet * step * 2;
      const s = t.stress[i] + inc;
      if (s >= 255) collapse.push(i);
      else t.stress[i] = s;
      t.renderDirty.markCell(x, y);
    }
    let cx = 0;
    let cy = 0;
    for (const i of collapse) {
      const x = i % W;
      const y = (i / W) | 0;
      this.stressed.delete(i);
      cx += x;
      cy += y;
      t.set(x, y, M.LOOSE);
      this.collapsedThisTick++;
    }
    if (collapse.length > 0) {
      this.bus.emit({ type: 'collapse', x: cx / collapse.length, y: cy / collapse.length, size: collapse.length });
    }
  }

  get pending(): number {
    return this.queue.length;
  }
}
