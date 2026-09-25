import { IS_CLIMBABLE, IS_FOLIAGE, IS_SOLID, M } from '../world/Materials';
import { Terrain } from '../world/Terrain';

export const N_SOLID = 1;
export const N_SURF = 2; // рядом (8-соседство) есть шершавая твёрдая поверхность — можно лазать
export const N_FLOOR = 4; // прямо снизу твёрдый пол (даже гладкий)
export const N_STRUCT = 8; // клетку покрывает живая конструкция (мост/лестница)
export const N_WEB = 16; // паутина — липко
export const N_CEIL = 32; // снизу пусто, сверху потолок — ходьба вниз головой
export const N_FOLIAGE = 64; // внутри травы/листвы: проходимо, медленно

/**
 * Сетка проходимости. Муравьи не летают: они ходят по поверхностям —
 * по полу, стенам и потолку шершавых материалов. Клетка проходима,
 * если она пустая и касается опоры или покрыта живым мостом/лестницей.
 */
export class NavGrid {
  readonly nav: Uint8Array;
  /** сколько узлов живых конструкций покрывают клетку */
  readonly struct: Uint16Array;
  version = 0;
  private W: number;
  private H: number;

  constructor(private terrain: Terrain) {
    this.W = terrain.W;
    this.H = terrain.H;
    this.nav = new Uint8Array(terrain.size);
    this.struct = new Uint16Array(terrain.size);
    terrain.onChange((x, y) => this.updateAround(x, y));
  }

  rebuildAll(): void {
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) this.computeCell(x, y);
    this.version++;
  }

  updateAround(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < this.W && cy < this.H) this.computeCell(cx, cy);
      }
    this.version++;
  }

  computeCell(x: number, y: number): void {
    const t = this.terrain;
    const W = this.W;
    const i = y * W + x;
    const m = t.mat[i];
    // растения (кроме корней в грунте) — объекты "в глубине": в 3D их обходят сбоку,
    // в 2D муравей проходит сквозь них, держась за стебли и листья
    if (IS_FOLIAGE[m] || m === M.STEM || (t.plant[i] !== 0 && m === M.WOOD)) {
      // муравей пробирается сквозь траву и листву, держась за неё
      this.nav[i] = N_FOLIAGE | N_SURF;
      return;
    }
    if (IS_SOLID[m]) {
      this.nav[i] = N_SOLID;
      return;
    }
    let v = 0;
    let climb = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        let nm: number;
        if (xx < 0 || yy < 0 || xx >= W || yy >= this.H) nm = M.BEDROCK;
        else nm = t.mat[yy * W + xx];
        if (IS_CLIMBABLE[nm]) climb++;
      }
    }
    if (climb > 0) v |= N_SURF;
    const below = y + 1 >= this.H ? M.BEDROCK : t.mat[i + W];
    if (IS_SOLID[below]) v |= N_FLOOR;
    else if (y > 0 && IS_CLIMBABLE[t.mat[i - W]]) v |= N_CEIL;
    if (this.struct[i] > 0) v |= N_STRUCT;
    if (m === M.WEB) v |= N_WEB;
    this.nav[i] = v;
  }

  walkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const v = this.nav[y * this.W + x];
    return (v & N_SOLID) === 0 && (v & (N_SURF | N_FLOOR | N_STRUCT)) !== 0;
  }

  walkableI(i: number): boolean {
    const v = this.nav[i];
    return (v & N_SOLID) === 0 && (v & (N_SURF | N_FLOOR | N_STRUCT)) !== 0;
  }

  /** Для груза: нужен пол, живая конструкция или шершавая поверхность (ползком). */
  supportedI(i: number): boolean {
    const v = this.nav[i];
    return (v & N_SOLID) === 0 && (v & (N_FLOOR | N_STRUCT)) !== 0;
  }

  addStruct(x: number, y: number, d: number): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = y * this.W + x;
    const v = this.struct[i] + d;
    this.struct[i] = v < 0 ? 0 : v;
    this.computeCell(x, y);
    this.version++;
  }
}
