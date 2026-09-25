import { IS_SOLID, M } from '../world/Materials';
import { Terrain } from '../world/Terrain';
import { NavGrid, N_STRUCT } from './NavGrid';

const UNREACHED = 65535;
const MAX_FALL = 48;
const MAX_STEP = 2;

/** Проходимо для груза: воздух, листва, стебли (груз продирается сквозь траву). */
function passable(t: Terrain, i: number): boolean {
  const m = t.mat[i];
  return !IS_SOLID[m] || m === M.LEAF || m === M.GRASS || m === M.FLOWER || m === M.STEM || (m === M.WOOD && t.plant[i] !== 0);
}

/**
 * Поле переноски тяжёлого груза. Отличается от поля "домой" для муравьёв:
 * муравей лазает по стенам и потолку, а груз — нет. Груз тащат по полу,
 * он поднимается на ступеньку до 2 клеток, падает с любого обрыва и может
 * ехать по живому мосту или лестнице. Поле — направленный BFS в обратную
 * сторону от входа в гнездо по таким переходам.
 */
export class CarryField {
  field: Uint16Array;
  private building: Uint16Array;
  private queue: Int32Array;
  private qh = 0;
  private qt = 0;
  private busy = false;
  builtVersion = -1;
  private pendingVersion = -1;
  private sources: number[] = [];

  constructor(private t: Terrain, private nav: NavGrid) {
    this.field = new Uint16Array(t.size).fill(UNREACHED);
    this.building = new Uint16Array(t.size);
    this.queue = new Int32Array(t.size);
  }

  get isBuilding(): boolean {
    return this.busy;
  }

  /** Клетка-"пол": груз может здесь лежать. */
  floor(i: number): boolean {
    const t = this.t;
    if (!passable(t, i)) return false;
    if (this.nav.struct[i] > 0) return true;
    const b = i + t.W;
    if (b >= t.size) return true;
    const bm = t.mat[b];
    return (IS_SOLID[bm] === 1 && !passable(t, b)) || (this.nav.nav[b] & N_STRUCT) !== 0;
  }

  begin(sources: number[]): void {
    this.sources = sources;
    this.building.fill(UNREACHED);
    this.qh = 0;
    this.qt = 0;
    for (const s of sources) {
      if (!this.floor(s) || this.building[s] === 0) continue;
      this.building[s] = 0;
      this.queue[this.qt++] = s;
    }
    this.busy = true;
    this.pendingVersion = this.nav.version;
  }

  buildNow(sources: number[]): void {
    this.begin(sources);
    this.step(Number.MAX_SAFE_INTEGER);
  }

  step(budget: number): boolean {
    if (!this.busy) return true;
    const t = this.t;
    const W = t.W;
    const b = this.building;
    const q = this.queue;
    let n = 0;
    while (this.qh < this.qt && n < budget) {
      const c = q[this.qh++];
      n++;
      const d = b[c] + 1;
      const x = c % W;
      const y = (c / W) | 0;
      for (const side of [-1, 1]) {
        const px = x + side;
        if (px < 1 || px >= W - 1) continue;
        // (а) предшественник на той же высоте или выше: сдвиг вбок и падение на c
        for (let h = 0; h <= MAX_FALL; h++) {
          const yy = y - h;
          if (yy < 1) break;
          const colI = yy * W + x;
          if (h > 0 && !passable(t, colI)) break;
          const p = yy * W + px;
          if (b[p] === UNREACHED && this.floor(p)) {
            b[p] = d;
            q[this.qt++] = p;
          }
          if (!passable(t, p) && h > 0) {
            // сбоку стена — выше по этой колонке предшественников нет
          }
        }
        // (б) предшественник ниже на 1–2: подъём на ступеньку
        for (let s = 1; s <= MAX_STEP; s++) {
          const py = y + s;
          if (py >= t.H - 1) break;
          const p = py * W + px;
          if (b[p] !== UNREACHED || !this.floor(p)) continue;
          // над предшественником должно быть свободно до высоты c
          let clear = true;
          for (let k = 1; k <= s; k++) if (!passable(t, (py - k) * W + px)) { clear = false; break; }
          if (!clear) continue;
          b[p] = d;
          q[this.qt++] = p;
        }
      }
      // (в) вертикаль по живой конструкции (лестница/башня)
      for (const dy of [-1, 1]) {
        const p = c + dy * W;
        if (p < 0 || p >= t.size) continue;
        if (b[p] === UNREACHED && this.nav.struct[p] > 0 && this.nav.struct[c] > 0) {
          b[p] = d;
          q[this.qt++] = p;
        }
      }
    }
    if (this.qh >= this.qt) {
      const tmp = this.field;
      this.field = this.building;
      this.building = tmp;
      this.busy = false;
      this.builtVersion = this.pendingVersion;
      return true;
    }
    return false;
  }

  /** Найти клетку-пол под точкой (груз лежит на ней). */
  private floorAt(x: number, y: number): number {
    const t = this.t;
    const xi = x | 0;
    let yi = y | 0;
    if (xi < 1 || xi >= t.W - 1) return -1;
    for (let k = 0; k < 4 && yi < t.H - 1; k++, yi++) {
      const i = yi * t.W + xi;
      if (this.floor(i)) return i;
      if (!passable(t, i)) break;
    }
    return -1;
  }

  /** Куда сдвинуть груз по горизонтали: -1, 0 или +1. */
  direction(x: number, y: number): number {
    const t = this.t;
    const W = t.W;
    const c = this.floorAt(x, y);
    if (c < 0) return 0;
    const d0 = this.field[c];
    if (d0 === 0) return 0;
    let best = d0;
    let dir = 0;
    const cx = c % W;
    const cy = (c / W) | 0;
    for (const side of [-1, 1]) {
      const nx = cx + side;
      if (nx < 1 || nx >= W - 1) continue;
      let land = -1;
      if (passable(t, cy * W + nx)) {
        for (let k = 0; k <= MAX_FALL && cy + k < t.H - 1; k++) {
          const i = (cy + k) * W + nx;
          if (!passable(t, i)) break;
          if (this.floor(i)) { land = i; break; }
        }
      } else {
        for (let s = 1; s <= MAX_STEP; s++) {
          const i = (cy - s) * W + nx;
          if (cy - s < 1) break;
          if (!passable(t, (cy - s) * W + cx)) break;
          if (this.floor(i)) { land = i; break; }
        }
      }
      if (land >= 0 && this.field[land] < best) { best = this.field[land]; dir = side; }
    }
    // по вертикальной конструкции вверх
    if (dir === 0 && this.nav.struct[c] > 0 && c - W >= 0 && this.field[c - W] < d0) return 2;
    return dir;
  }

  dist(x: number, y: number): number {
    const c = this.floorAt(x, y);
    return c < 0 ? UNREACHED : this.field[c];
  }
}
