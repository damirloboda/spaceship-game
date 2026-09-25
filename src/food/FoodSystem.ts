import { Rng } from '../core/Rng';
import { NavGrid, N_STRUCT } from '../nav/NavGrid';
import { IS_SOLID, M } from '../world/Materials';

/** Листва и стебли не держат предметы: еда проваливается сквозь траву на землю. */
const FOLIAGE = new Uint8Array(64);
FOLIAGE[M.LEAF] = 1;
FOLIAGE[M.GRASS] = 1;
FOLIAGE[M.FLOWER] = 1;
FOLIAGE[M.STEM] = 1;
FOLIAGE[M.WEB] = 1;
import { Terrain } from '../world/Terrain';
import { FOOD_KINDS, foodRadius, FK } from './FoodTypes';

export interface FoodItem {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  initialMass: number;
  r: number;
  fresh: number;
  /** муравьи, тащащие предмет командой */
  carriers: number[];
  /** муравьи, направленные к предмету */
  assigned: number;
  /** сколько муравьёв нужно, чтобы унести (оценка колонии) */
  need: number;
  grounded: boolean;
  stuckT: number;
  moving: boolean;
  /** колония, которая тащит предмет (-1 — никто) */
  hauler: number;
  /** колония, у входа которой предмет разбирают */
  delivering: number;
  /** колонии, знающие о предмете (битовая маска) */
  known: number;
  /** висит на растении (id), не падает */
  attached: number;
  /** парит в воздухе (семя одуванчика) */
  airborne: boolean;
  /** режим разрезания: слишком тяжело или застряло — рабочие откусывают куски */
  cut: boolean;
  dirX: number;
  dirY: number;
  age: number;
  lift: number;
  removed: boolean;
  /** сколько раз муравьи не смогли дойти (недоступная еда получает меньше внимания) */
  fails: number;
}

export interface HaulContext {
  /** направление к гнезду колонии из точки (для консенсуса носильщиков) */
  homeDir(colony: number, x: number, y: number, out: number[]): boolean;
  /** x входа гнезда колонии */
  homeX(colony: number): number;
  /** направление переноски по полю груза: -1/0/1, 2 — вверх по конструкции */
  carryDir(colony: number, x: number, y: number): number;
  carryDist(colony: number, x: number, y: number): number;
  /** предмет у входа гнезда колонии? */
  atNest(colony: number, x: number, y: number, r: number): boolean;
  deliver(colony: number, kind: number, amount: number, x: number, y: number): void;
  release(antId: number): void;
  strength(antId: number): number;
  wind: number;
}

const GRID = 16;

/**
 * Еда как физика: у каждого куска масса, радиус, свежесть и запах.
 * Мелкое уносит один муравей. Крупное требует команды: подъёмная сила — сумма сил
 * носильщиков; предмет едет, только если сил хватает, и тем быстрее, чем их больше.
 * Направление — консенсус (поле пути к гнезду в точке предмета). Если предмет застрял
 * или он неподъёмен — колония переходит к разрезанию на куски.
 */
export class FoodSystem {
  items: FoodItem[] = [];
  private byId = new Map<number, FoodItem>();
  private nextId = 1;
  private gw: number;
  private gh: number;
  private grid: FoodItem[][];
  private gridDirty = true;
  private tmp = [0, 0];

  constructor(private t: Terrain, private nav: NavGrid, private rng: Rng) {
    this.gw = Math.ceil(t.W / GRID);
    this.gh = Math.ceil(t.H / GRID);
    this.grid = Array.from({ length: this.gw * this.gh }, () => []);
  }

  spawn(kind: number, x: number, y: number, mass: number, opts: Partial<FoodItem> = {}): FoodItem {
    const it: FoodItem = {
      id: this.nextId++, kind, x, y, vx: 0, vy: 0, mass, initialMass: mass, r: foodRadius(kind, mass), fresh: 1,
      carriers: [], assigned: 0, need: 0, grounded: false, stuckT: 0, moving: false, hauler: -1, delivering: -1,
      known: 0, attached: 0, airborne: false, cut: false, dirX: 0, dirY: 0, age: 0, lift: 0, removed: false, fails: 0,
      ...opts,
    };
    this.items.push(it);
    this.byId.set(it.id, it);
    this.gridDirty = true;
    return it;
  }

  get(id: number): FoodItem | undefined {
    return this.byId.get(id);
  }

  remove(it: FoodItem, ctx?: HaulContext): void {
    if (it.removed) return;
    it.removed = true;
    this.byId.delete(it.id);
    if (ctx) for (const a of it.carriers) ctx.release(a);
    it.carriers.length = 0;
    this.gridDirty = true;
  }

  /** Откусить кусок (одиночный перенос или разрезание). Возвращает массу. */
  take(it: FoodItem, amount: number): number {
    const a = Math.min(amount, it.mass);
    it.mass -= a;
    it.r = foodRadius(it.kind, it.mass);
    if (it.mass <= 0.05) this.remove(it);
    return a;
  }

  private rebuildGrid(): void {
    for (const c of this.grid) c.length = 0;
    const alive: FoodItem[] = [];
    for (const it of this.items) {
      if (it.removed) continue;
      alive.push(it);
      const gx = Math.max(0, Math.min(this.gw - 1, (it.x / GRID) | 0));
      const gy = Math.max(0, Math.min(this.gh - 1, (it.y / GRID) | 0));
      this.grid[gy * this.gw + gx].push(it);
    }
    this.items = alive;
    this.gridDirty = false;
  }

  /** Ближайшая еда в радиусе "нюха" (учитывается сила запаха вида и размер). */
  sense(x: number, y: number, radius: number, filter?: (it: FoodItem) => boolean): FoodItem | null {
    if (this.gridDirty) this.rebuildGrid();
    const maxR = radius + 50;
    const x0 = Math.max(0, ((x - maxR) / GRID) | 0);
    const x1 = Math.min(this.gw - 1, ((x + maxR) / GRID) | 0);
    const y0 = Math.max(0, ((y - maxR) / GRID) | 0);
    const y1 = Math.min(this.gh - 1, ((y + maxR) / GRID) | 0);
    let best: FoodItem | null = null;
    let bestD = Infinity;
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (const it of this.grid[gy * this.gw + gx]) {
          if (it.removed || it.attached || it.airborne || it.fails > 3) continue;
          if (!it.cut && it.carriers.length > 0 && it.carriers.length >= it.need && it.lift >= it.mass * 1.1) continue;
          const def = FOOD_KINDS[it.kind];
          const reach = Math.min(radius + def.scent * 0.35 * it.fresh + it.r, radius * 3 + it.r);
          const dx = it.x - x;
          const dy = it.y - y;
          const d = dx * dx + dy * dy;
          if (d > reach * reach || d >= bestD) continue;
          if (filter && !filter(it)) continue;
          best = it;
          bestD = d;
        }
    return best;
  }

  /** Все предметы в радиусе. */
  query(x: number, y: number, radius: number, cb: (it: FoodItem) => void): void {
    if (this.gridDirty) this.rebuildGrid();
    const x0 = Math.max(0, ((x - radius) / GRID) | 0);
    const x1 = Math.min(this.gw - 1, ((x + radius) / GRID) | 0);
    const y0 = Math.max(0, ((y - radius) / GRID) | 0);
    const y1 = Math.min(this.gh - 1, ((y + radius) / GRID) | 0);
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++)
        for (const it of this.grid[gy * this.gw + gx]) {
          if (it.removed) continue;
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= (radius + it.r) * (radius + it.r)) cb(it);
        }
  }

  /** Позиция слота носильщика вокруг предмета. */
  slotPos(it: FoodItem, slot: number, out: number[]): void {
    const slots = this.slotCount(it);
    const a = Math.PI - 0.25 + ((slot % slots) + 0.5) / slots * (Math.PI + 0.5);
    const layer = Math.floor(slot / slots);
    const rr = it.r + 0.45 + layer * 0.55;
    out[0] = it.x + Math.cos(a) * rr;
    out[1] = it.y + Math.sin(a) * rr * (it.kind === FK.COOKIE || it.kind === FK.HUMAN ? 0.45 : 1);
  }

  slotCount(it: FoodItem): number {
    return Math.max(2, Math.floor((Math.PI * (it.r + 0.5)) / 0.55));
  }

  /** Максимум носильщиков (два слоя вокруг). */
  maxCarriers(it: FoodItem): number {
    return this.slotCount(it) * 2;
  }

  private solidAt(x: number, y: number): boolean {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (!this.t.inBounds(xi, yi)) return true;
    const i = yi * this.t.W + xi;
    const m = this.t.mat[i];
    return IS_SOLID[m] === 1 && FOLIAGE[m] === 0 && !(m === M.WOOD && this.t.plant[i] !== 0);
  }

  private overlaps(it: FoodItem, x: number, y: number): boolean {
    const r = it.r * 0.85;
    if (this.solidAt(x, y)) return true;
    const n = it.r > 3 ? 14 : 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      if (this.solidAt(x + Math.cos(a) * r, y + Math.sin(a) * r)) return true;
    }
    return false;
  }

  private supported(it: FoodItem): boolean {
    const by = it.y + it.r * 0.85 + 0.35;
    const W = this.t.W;
    for (const k of [-0.6, -0.2, 0.2, 0.6]) {
      const px = Math.floor(it.x + k * it.r);
      const py = Math.floor(by);
      if (this.solidAt(px, py)) return true;
      if (this.t.inBounds(px, py) && (this.nav.nav[py * W + px] & N_STRUCT)) return true;
    }
    return false;
  }

  update(dt: number, ctx: HaulContext): void {
    if (this.gridDirty) this.rebuildGrid();
    const t = this.t;
    let moved = false;
    for (const it of this.items) {
      if (it.removed) continue;
      it.age += dt;
      if (it.fails > 0) it.fails = Math.max(0, it.fails - dt * 0.02);
      const def = FOOD_KINDS[it.kind];
      if (Number.isFinite(def.spoil)) {
        const wet = t.water[t.idx(Math.max(0, Math.min(t.W - 1, it.x | 0)), Math.max(0, Math.min(t.H - 1, it.y | 0)))] > 0 ? 3 : 1;
        it.fresh -= (dt / def.spoil) * wet;
        if (it.fresh <= 0) {
          // сгнило: становится органикой в почве
          const cx = it.x | 0;
          const cy = Math.min(t.H - 1, (it.y + it.r) | 0);
          if (it.mass > 3 && t.get(cx, cy) === M.AIR) t.set(cx, cy, M.ORGANIC);
          this.remove(it, ctx);
          continue;
        }
      }
      if (it.attached) continue;
      // носильщики, ушедшие из команды
      if (it.carriers.length > 0) {
        let lift = 0;
        for (const a of it.carriers) lift += ctx.strength(a);
        it.lift = lift;
      } else it.lift = 0;

      // разборка у входа гнезда
      if (it.delivering >= 0) {
        const rate = Math.max(0.5, it.carriers.length * 0.6) * dt;
        const a = this.take(it, rate);
        ctx.deliver(it.delivering, it.kind, a, it.x, it.y);
        if (it.removed) { for (const c of it.carriers) ctx.release(c); it.carriers.length = 0; }
        continue;
      }

      // опора: либо под предметом твёрдое, либо он упёрся в угол ступеньки и не может упасть
      const sup = this.supported(it) || this.overlaps(it, it.x, it.y + 0.1);
      const liftOk = it.lift >= it.mass * 0.6;
      it.grounded = sup;
      if (it.airborne) {
        it.vx = ctx.wind * 3 + Math.sin(it.age * 2 + it.id) * 0.8;
        it.vy = 1.2;
        const nx = it.x + it.vx * dt;
        const ny = it.y + it.vy * dt;
        if (this.overlaps(it, nx, ny) || sup) { it.airborne = false; it.vx = 0; it.vy = 0; }
        else { it.x = Math.max(1, Math.min(t.W - 2, nx)); it.y = ny; moved = true; }
        continue;
      }
      // вода: всплытие лёгкого
      const ci = t.idx(Math.max(0, Math.min(t.W - 1, it.x | 0)), Math.max(0, Math.min(t.H - 1, it.y | 0)));
      const inWater = t.water[ci] > 90;
      // без опоры предмет падает, даже если его держат: муравьи не летают
      if (!sup) {
        // свободное падение
        if (inWater && def.density < 1) it.vy = Math.max(-1.5, it.vy - 20 * dt) * 0.9;
        else it.vy = Math.min(30, it.vy + 40 * dt);
        const ny = it.y + it.vy * dt;
        if (!this.overlaps(it, it.x, ny)) { it.y = ny; moved = true; }
        else it.vy = 0;
        if (it.y > t.H - 2) it.y = t.H - 2;
        continue;
      }
      it.vy = 0;
      // выталкивание, если засыпало
      if (this.overlaps(it, it.x, it.y)) {
        for (let k = 1; k <= 6; k++) if (!this.overlaps(it, it.x, it.y - k * 0.5)) { it.y -= k * 0.5; moved = true; break; }
      }
      // коллективный перенос
      it.moving = false;
      if (it.carriers.length > 0 && it.hauler >= 0 && !it.cut) {
        if (!liftOk) {
          it.stuckT += dt * 0.5;
        } else {
          const ratio = it.lift / Math.max(0.1, it.mass);
          const speed = 3.4 * Math.max(0.12, Math.min(1, (ratio - 0.6) / 1.0));
          const dir = this.tmp;
          const bottomY = it.y + it.r * 0.7;
          // груз не лазает: тянем по земле. Сторону выбирает поле пути домой
          // (консенсус "информированных" носильщиков), вертикаль — ступеньки и гравитация.
          let want = ctx.carryDir(it.hauler, it.x, bottomY);
          if (want === 2) {
            // вверх по живой лестнице/башне
            if (!this.overlaps(it, it.x, it.y - speed * dt)) { it.y -= speed * dt; it.moving = true; moved = true; }
            want = 0;
          } else if (want === 0 && ctx.carryDist(it.hauler, it.x, bottomY) === 65535) {
            // поле не знает пути — тянем в сторону дома
            want = Math.sign(ctx.homeX(it.hauler) - it.x) || 1;
          }
          void dir;
          it.dirX += (want - it.dirX) * Math.min(1, dt * 2.5);
          it.dirY = 0;
          const jitter = ((this.rng.next() - 0.5) * 0.5) / Math.sqrt(it.carriers.length);
          const mx = (it.dirX + jitter) * speed * dt;
          if (Math.abs(mx) > 1e-4) {
            const nx = it.x + mx;
            let ny = it.y;
            let ok = !this.overlaps(it, nx, ny);
            if (!ok) {
              // шаг вверх (порог, склон) — до двух клеток
              for (let k = 1; k <= 4 && !ok; k++) {
                const sy = it.y - k * 0.5;
                if (!this.overlaps(it, nx, sy)) { ny = sy; ok = true; }
              }
            }
            if (ok) {
              it.x = nx;
              it.y = ny;
              it.moving = true;
              it.stuckT = Math.max(0, it.stuckT - dt * 2);
              moved = true;
            } else it.stuckT += dt;
          } else it.stuckT += dt * 0.3;
        }
        if (ctx.atNest(it.hauler, it.x, it.y, it.r)) {
          it.delivering = it.hauler;
        }
        // застряли надолго — режем на куски
        if (it.stuckT > 9) it.cut = true;
      }
    }
    if (moved) this.gridDirty = true;
  }

  /** Сколько сил нужно, чтобы тащить предмет с нормальной скоростью. */
  requiredLift(it: FoodItem): number {
    return it.mass * 1.1;
  }
}
