import { Rng } from '../core/Rng';
import { ChunkSet } from '../world/ChunkSet';
import { IS_SOLID, M, POROUS } from '../world/Materials';
import { Terrain } from '../world/Terrain';

/**
 * Вода: клеточный автомат с количеством воды 0..255 в пустых клетках.
 * Течёт вниз, растекается в стороны, впитывается в пористые материалы
 * (повышая влажность), испаряется на солнце. Сырая земля превращается в грязь,
 * у которой почти нет пролёта — так дождь подтапливает и обрушивает тоннели.
 */
export class Water {
  readonly renderDirty: ChunkSet;
  private soilCursor = 0;
  evaporation = 0.3; // задаётся погодой
  totalMoved = 0;

  constructor(private t: Terrain, private rng: Rng) {
    this.renderDirty = new ChunkSet(t.W, t.H, 32);
  }

  add(x: number, y: number, amount: number): void {
    const t = this.t;
    if (!t.inBounds(x, y)) return;
    const i = y * t.W + x;
    if (IS_SOLID[t.mat[i]]) return;
    t.water[i] = Math.min(255, t.water[i] + amount);
    t.waterDirty.markCell(x, y);
    this.renderDirty.markCell(x, y);
  }

  update(maxChunks: number, dt: number): void {
    const t = this.t;
    const W = t.W;
    const H = t.H;
    const cs = 32;
    const set = t.waterDirty;
    const list = set.drain();
    list.sort((a, b) => b - a);
    const cw = set.cw;
    const flip = this.rng.next() < 0.5;
    let processed = 0;
    this.totalMoved = 0;
    for (const ci of list) {
      if (processed++ >= maxChunks) { set.markChunk(ci); continue; }
      const x0 = (ci % cw) * cs;
      const y0 = ((ci / cw) | 0) * cs;
      const x1 = Math.min(W - 1, x0 + cs);
      const y1 = Math.min(H - 1, y0 + cs);
      let changed = false;
      for (let y = y1 - 1; y >= Math.max(1, y0); y--) {
        for (let k = Math.max(1, x0); k < x1; k++) {
          const x = flip ? x1 - 1 - (k - Math.max(1, x0)) : k;
          const i = y * W + x;
          let w = t.water[i];
          if (w === 0) continue;
          if (IS_SOLID[t.mat[i]]) { t.water[i] = 0; continue; }
          // 1. вниз
          const b = i + W;
          const bm = t.mat[b];
          if (!IS_SOLID[bm]) {
            const room = 255 - t.water[b];
            if (room > 0) {
              const f = Math.min(w, room);
              t.water[b] += f;
              w -= f;
              changed = true;
              if (((y + 1) % cs) === 0) { set.markCell(x, y + 1); this.renderDirty.markCell(x, y + 1); }
            }
          } else if (POROUS[bm] > 0) {
            // впитывание в пол
            const absorb = Math.min(w, Math.ceil(POROUS[bm] * 3));
            if (t.moist[b] < 250) {
              t.moist[b] = Math.min(255, t.moist[b] + absorb * 2);
              w -= absorb;
              changed = true;
            }
          }
          // 2. в стороны
          if (w > 1) {
            for (const dx of flip ? [1, -1] : [-1, 1]) {
              const j = i + dx;
              if (IS_SOLID[t.mat[j]]) {
                const pm = t.mat[j];
                if (POROUS[pm] > 0 && t.moist[j] < 250 && this.rng.next() < POROUS[pm] * 0.3) {
                  t.moist[j] = Math.min(255, t.moist[j] + 2);
                  w -= 1;
                }
                continue;
              }
              const diff = w - t.water[j];
              if (diff > 1) {
                const f = (diff / 3) | 0 || 1;
                t.water[j] += f;
                w -= f;
                changed = true;
                const nx = x + dx;
                if (nx % cs === 0 || nx % cs === cs - 1) { set.markCell(nx, y); this.renderDirty.markCell(nx, y); }
              }
            }
          }
          // 3. испарение тонких плёнок
          if (w > 0 && w < 12 && this.rng.next() < this.evaporation * dt) { w--; changed = true; }
          t.water[i] = w;
        }
      }
      if (changed) {
        set.markChunk(ci);
        this.renderDirty.markChunk(ci);
        this.totalMoved++;
      } else {
        this.renderDirty.markChunk(ci);
      }
    }
  }

  /**
   * Медленный проход по почве: влага уходит вглубь и высыхает у поверхности,
   * мокрая земля становится грязью, сухая грязь — землёй.
   */
  soilPass(rows: number, dryness: number): void {
    const t = this.t;
    const W = t.W;
    for (let r = 0; r < rows; r++) {
      const y = this.soilCursor;
      this.soilCursor = (this.soilCursor + 1) % (t.H - 1);
      if (y < 1) continue;
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const mo = t.moist[i];
        if (mo === 0) continue;
        const m = t.mat[i];
        // просачивание вниз
        const b = i + W;
        const bm = t.mat[b];
        if (POROUS[bm] > 0 && t.moist[b] + 4 < mo) {
          const f = ((mo - t.moist[b]) * 0.25 * POROUS[bm]) | 0;
          t.moist[b] += f;
          t.moist[i] = mo - f;
        }
        // высыхание: быстрее у неба
        const nearSky = y <= t.skyline[x] + 3;
        const dry = nearSky ? dryness * 3 : dryness * 0.4;
        if (this.rng.next() < dry) t.moist[i] = Math.max(0, t.moist[i] - 1);
        const nm = t.moist[i];
        if ((m === M.SOIL || m === M.TOPSOIL || m === M.LOOSE || m === M.BUILT) && nm > 235) {
          t.set(x, y, M.MUD, true);
          t.moist[i] = nm;
        } else if (m === M.MUD && nm < 90) {
          t.set(x, y, M.SOIL, true);
          t.moist[i] = nm;
        } else if (nm > 0 && (y & 7) === 0 && (x & 7) === 0) {
          t.renderDirty.markCell(x, y);
        }
      }
    }
  }

  /** Суммарный объём воды в прямоугольнике (для датчиков затопления комнат). */
  volumeIn(x0: number, y0: number, x1: number, y1: number): number {
    const t = this.t;
    let s = 0;
    for (let y = Math.max(0, y0); y <= Math.min(t.H - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(t.W - 1, x1); x++) s += t.water[y * t.W + x];
    return s;
  }
}
