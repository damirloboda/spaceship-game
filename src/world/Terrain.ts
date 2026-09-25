import { ChunkSet } from './ChunkSet';
import { IS_SOLID, M, MATERIALS } from './Materials';

export const F_FORBID = 1;
export const F_PLAN = 2;
export const F_NEST = 4;
export const F_SETTLED = 8;
export const F_TUNNEL = 16;
export const F_DUMP = 32;

export type TerrainChangeListener = (x: number, y: number, oldMat: number, newMat: number) => void;

export const CHUNK = 32;

/**
 * Разрушаемый мир в клетках (Structure of Arrays).
 * mat      — материал
 * hp       — оставшаяся прочность 0..255 (копание снижает)
 * moist    — влажность 0..255
 * water    — количество воды в пустой клетке 0..255
 * stress   — накопленное напряжение неопорной клетки (предвестник обвала)
 * flags    — служебные флаги (запрет, план, гнездо, туннель)
 * plant    — id растения-владельца клетки (0 — нет)
 * temp     — температура (грубая сетка 8x8), °C
 * Высота клетки — её y; масса — плотность материала.
 */
export class Terrain {
  readonly size: number;
  readonly mat: Uint8Array;
  readonly hp: Uint8Array;
  readonly moist: Uint8Array;
  readonly water: Uint8Array;
  readonly stress: Uint8Array;
  readonly flags: Uint8Array;
  readonly plant: Uint16Array;
  readonly tempW: number;
  readonly tempH: number;
  readonly temp: Float32Array;
  /** самая верхняя непрозрачная клетка в каждой колонке — для света и дождя */
  readonly skyline: Int16Array;

  /** чанки, текстуру которых надо перезалить на GPU */
  readonly renderDirty: ChunkSet;
  readonly waterDirty: ChunkSet;
  private listeners: TerrainChangeListener[] = [];
  /** счётчик изменений — для инвалидации кэшей навигации */
  version = 0;
  /** id растения, которому принадлежала только что изменённая клетка (для слушателей) */
  changedPlant = 0;

  constructor(readonly W: number, readonly H: number) {
    this.size = W * H;
    this.mat = new Uint8Array(this.size);
    this.hp = new Uint8Array(this.size);
    this.moist = new Uint8Array(this.size);
    this.water = new Uint8Array(this.size);
    this.stress = new Uint8Array(this.size);
    this.flags = new Uint8Array(this.size);
    this.plant = new Uint16Array(this.size);
    this.tempW = Math.ceil(W / 8);
    this.tempH = Math.ceil(H / 8);
    this.temp = new Float32Array(this.tempW * this.tempH).fill(18);
    this.skyline = new Int16Array(W);
    this.renderDirty = new ChunkSet(W, H, CHUNK);
    this.waterDirty = new ChunkSet(W, H, CHUNK);
  }

  onChange(l: TerrainChangeListener): void {
    this.listeners.push(l);
  }

  idx(x: number, y: number): number {
    return y * this.W + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.W && y < this.H;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return M.BEDROCK;
    return this.mat[y * this.W + x];
  }

  solid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return true;
    return IS_SOLID[this.mat[y * this.W + x]] === 1;
  }

  solidI(i: number): boolean {
    return IS_SOLID[this.mat[i]] === 1;
  }

  /**
   * Единственная точка изменения материала. Сообщает всем подписчикам
   * (устойчивость, вода, навигация, растения, рендер).
   */
  set(x: number, y: number, m: number, keepFlags = false): void {
    if (!this.inBounds(x, y)) return;
    const i = y * this.W + x;
    const old = this.mat[i];
    if (old === m) return;
    this.mat[i] = m;
    this.hp[i] = 255;
    this.stress[i] = 0;
    if (!keepFlags) this.flags[i] &= ~(F_SETTLED | F_PLAN);
    if (IS_SOLID[m]) {
      // твёрдая клетка вытесняет воду вверх
      const w = this.water[i];
      if (w > 0) {
        this.water[i] = 0;
        if (y > 0 && !IS_SOLID[this.mat[i - this.W]]) {
          this.water[i - this.W] = Math.min(255, this.water[i - this.W] + w);
        }
      }
    }
    this.changedPlant = this.plant[i];
    this.version++;
    this.updateSkyline(x);
    this.renderDirty.markCellNeighborhood(x, y);
    this.waterDirty.markCellNeighborhood(x, y);
    for (const l of this.listeners) l(x, y, old, m);
    if (m === M.AIR || m === M.LOOSE || m === M.BUILT || m === M.NESTWALL) this.plant[i] = 0;
    this.changedPlant = 0;
  }

  /** Установка без событий — только для генератора мира. */
  setRaw(x: number, y: number, m: number): void {
    const i = y * this.W + x;
    this.mat[i] = m;
    this.hp[i] = 255;
  }

  isOpaqueForSky(m: number): boolean {
    return IS_SOLID[m] === 1 && m !== M.LEAF && m !== M.GRASS && m !== M.STEM && m !== M.GLASS && m !== M.FLOWER && m !== M.BLOSSOM;
  }

  updateSkyline(x: number): void {
    const W = this.W;
    let y = 0;
    // растения (стволы, кроны) — не небосвод: под деревом тень, а не подземелье
    while (y < this.H && (!this.isOpaqueForSky(this.mat[y * W + x]) || this.plant[y * W + x] !== 0)) y++;
    this.skyline[x] = y;
  }

  rebuildSkyline(): void {
    for (let x = 0; x < this.W; x++) this.updateSkyline(x);
  }

  /** Поверхность земли (первая твёрдая клетка сверху), игнорируя листву. */
  groundY(x: number): number {
    return this.skyline[Math.max(0, Math.min(this.W - 1, x | 0))];
  }

  /**
   * Точка, где можно стоять на поверхности в колонке x: ниже крон и стволов,
   * над травой (первая пустая клетка над грунтом, не внутри листвы).
   */
  standY(x: number): number {
    x = Math.max(1, Math.min(this.W - 2, x | 0));
    const W = this.W;
    let y = this.skyline[x];
    // спускаемся сквозь стволы/стебли растений до настоящего грунта
    while (y < this.H - 1 && (this.plant[y * W + x] !== 0 || !IS_SOLID[this.mat[y * W + x]])) y++;
    // поднимаемся над травой/листвой
    let yy = y - 1;
    while (yy > 1 && IS_SOLID[this.mat[yy * W + x]]) yy--;
    return yy;
  }

  tempAt(x: number, y: number): number {
    const tx = Math.max(0, Math.min(this.tempW - 1, (x / 8) | 0));
    const ty = Math.max(0, Math.min(this.tempH - 1, (y / 8) | 0));
    return this.temp[ty * this.tempW + tx];
  }

  matDef(x: number, y: number) {
    return MATERIALS[this.get(x, y)];
  }
}
