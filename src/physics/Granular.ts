import { Rng } from '../core/Rng';
import { ChunkSet } from '../world/ChunkSet';
import { IS_GRANULAR, IS_SOLID, M } from '../world/Materials';
import { Terrain } from '../world/Terrain';

/**
 * Сыпучие материалы (песок, рыхлая земля, гравий) падают и осыпаются
 * клеточным автоматом. Работает только в активных чанках.
 */
export class Granular {
  private active: ChunkSet;
  moved = 0;

  constructor(private t: Terrain, private rng: Rng) {
    this.active = new ChunkSet(t.W, t.H, 16);
    t.onChange((x, y) => {
      this.active.markCellNeighborhood(x, y);
      this.active.markCell(x, y - 1);
    });
  }

  wake(x: number, y: number): void {
    this.active.markCellNeighborhood(x, y);
  }

  update(maxChunks: number): void {
    const list = this.active.drain();
    const t = this.t;
    const W = t.W;
    const s = 16;
    const cw = this.active.cw;
    this.moved = 0;
    // сортируем снизу вверх, чтобы столб падал за один проход
    list.sort((a, b) => b - a);
    let processed = 0;
    for (const ci of list) {
      if (processed++ >= maxChunks) {
        this.active.markChunk(ci);
        continue;
      }
      const x0 = (ci % cw) * s;
      const y0 = ((ci / cw) | 0) * s;
      const x1 = Math.min(W, x0 + s);
      const y1 = Math.min(t.H - 1, y0 + s);
      const flip = this.rng.next() < 0.5;
      for (let y = y1 - 1; y >= y0; y--) {
        for (let k = x0; k < x1; k++) {
          const x = flip ? x1 - 1 - (k - x0) : k;
          const i = y * W + x;
          const m = t.mat[i];
          if (!IS_GRANULAR[m]) continue;
          const below = i + W;
          if (!IS_SOLID[t.mat[below]]) {
            this.move(x, y, x, y + 1, m);
            continue;
          }
          const d = this.rng.next() < 0.5 ? -1 : 1;
          for (const dx of [d, -d]) {
            const nx = x + dx;
            if (nx < 0 || nx >= W) continue;
            // осыпание по диагонали (угол естественного откоса)
            if (!IS_SOLID[t.mat[y * W + nx]] && !IS_SOLID[t.mat[(y + 1) * W + nx]]) {
              if (m === M.GRAVEL && this.rng.next() < 0.5) break;
              this.move(x, y, nx, y + 1, m);
              break;
            }
          }
        }
      }
    }
  }

  private move(x: number, y: number, nx: number, ny: number, m: number): void {
    const t = this.t;
    const ni = ny * t.W + nx;
    const moist = t.moist[y * t.W + x];
    const w = t.water[ni];
    t.water[ni] = 0;
    t.set(x, y, M.AIR);
    t.set(nx, ny, m);
    t.moist[ni] = moist;
    if (w > 0) t.water[y * t.W + x] = Math.min(255, t.water[y * t.W + x] + w);
    this.moved++;
  }
}
