import { Rng } from '../core/Rng';
import { CarryField } from '../nav/CarryField';
import { DistanceField } from '../nav/DistanceField';
import { NavGrid } from '../nav/NavGrid';
import { ROOM } from '../procgen/WorldGenerator';
import { IS_DIGGABLE, IS_SOLID, M } from '../world/Materials';
import { F_NEST, Terrain } from '../world/Terrain';

export const ROOM_NAMES = ['Камера матки', 'Хранилище еды', 'Детская', 'Казарма', 'Грибная ферма', 'Склад', 'Резервуар', 'Лаборатория', 'Убежище', 'Тоннель'];

export interface Room {
  id: number;
  type: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  built: boolean;
  flooded: boolean;
  water: number;
  bpId: number;
  area: number;
  /** запас в комнате (для фермы — листья) */
  stock: number;
}

/**
 * Гнездо: вход, комнаты и поле пути домой. Планировщик сам выбирает, где копать
 * новую комнату: оценивает грунт (устойчивость), воду, влажность, глубину и
 * расстояние до существующих ходов — у каждого типа комнаты свои предпочтения.
 */
export class Nest {
  rooms: Room[] = [];
  field: DistanceField;
  /** поле переноски тяжёлого груза к входу */
  carry: CarryField;
  private nextRoom = 1;
  fieldTimer = 0;
  dumpToggle = 1;
  sealed = false;

  constructor(
    public entranceX: number,
    public entranceY: number,
    private t: Terrain,
    private nav: NavGrid,
  ) {
    this.field = new DistanceField(nav, t.W, t.H, 60000);
    this.carry = new CarryField(t, nav);
  }

  /** Источники поля переноски: пол у входа. */
  carrySources(): number[] {
    const W = this.t.W;
    const out: number[] = [];
    for (let dy = -4; dy <= 3; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = this.entranceX + dx;
        const y = this.entranceY + dy;
        if (this.t.inBounds(x, y)) out.push(y * W + x);
      }
    return out;
  }

  addRoom(type: number, x0: number, y0: number, x1: number, y1: number, built: boolean, bpId = -1): Room {
    const r: Room = {
      id: this.nextRoom++, type, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, built, flooded: false, water: 0, bpId,
      area: Math.max(1, Math.round((Math.PI * (x1 - x0) * (y1 - y0)) / 4)), stock: 0,
    };
    this.rooms.push(r);
    return r;
  }

  room(id: number): Room | undefined {
    return this.rooms.find((r) => r.id === id);
  }

  roomsOf(type: number, built = true): Room[] {
    return this.rooms.filter((r) => r.type === type && (!built || r.built));
  }

  capacity(type: number): number {
    let s = 0;
    for (const r of this.rooms) if (r.built && r.type === type) s += r.area;
    return s;
  }

  /** Сколько взрослых может жить внутри (все комнаты + ходы). */
  livingCapacity(): number {
    let s = 30;
    for (const r of this.rooms) if (r.built) s += r.area * (r.type === ROOM.SHELTER || r.type === ROOM.BARRACKS ? 4 : 1.2);
    return s;
  }

  entranceCell(): number {
    return this.entranceY * this.t.W + this.entranceX;
  }

  /** Источники поля "домой": вход и клетки у входа. */
  homeSources(): number[] {
    const W = this.t.W;
    const out: number[] = [];
    for (let dy = -2; dy <= 3; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = this.entranceX + dx;
        const y = this.entranceY + dy;
        if (this.t.inBounds(x, y) && this.nav.walkable(x, y)) out.push(y * W + x);
      }
    if (out.length === 0) out.push(this.entranceCell());
    return out;
  }

  atEntrance(x: number, y: number, r = 3.5): boolean {
    const dx = x - this.entranceX;
    const dy = y - this.entranceY;
    return dx * dx + dy * dy <= r * r;
  }

  /** Точка сброса выкопанной земли: по бокам от входа, холмик растёт. */
  dumpSpot(rng: Rng): [number, number] {
    this.dumpToggle = -this.dumpToggle;
    const x = Math.round(this.entranceX + this.dumpToggle * rng.range(5, 12 + Math.min(20, this.rooms.length * 2)));
    let y = 0;
    while (y < this.t.H - 1 && !IS_SOLID[this.t.mat[y * this.t.W + x]]) y++;
    return [x, y - 1];
  }

  /**
   * Выбрать место для новой комнаты. Возвращает эллипс и клетки раскопки (комната + тоннель).
   */
  planRoom(type: number, rng: Rng, maxW: number, level: number): { cx: number; cy: number; rx: number; ry: number; cells: [number, number][] } | null {
    const t = this.t;
    const W = t.W;
    const rx = Math.min(maxW / 2, type === ROOM.QUEEN ? 8 : type === ROOM.FARM ? 9 + level * 0.4 : type === ROOM.SHELTER ? 6 + level * 0.8 : 5 + level * 0.4);
    const ry = Math.max(2.2, Math.min(5.5, rx * 0.42));
    let best: { cx: number; cy: number; score: number } | null = null;
    const baseY = this.entranceY;
    for (let k = 0; k < 70; k++) {
      const cx = Math.round(this.entranceX + rng.range(-40 - level * 12, 40 + level * 12));
      const depthPref = type === ROOM.NURSERY || type === ROOM.QUEEN ? 45 : type === ROOM.FOOD || type === ROOM.BARRACKS ? 16 : type === ROOM.FARM ? 35 : 28;
      const cy = Math.round(baseY + Math.max(10, depthPref + rng.range(-12, 12 + level * 4)));
      if (cx - rx < 2 || cx + rx > W - 3 || cy + ry > t.H - 14) continue;
      let ok = true;
      let soft = 0;
      let wet = 0;
      let total = 0;
      for (let dy = -Math.ceil(ry) - 2; dy <= Math.ceil(ry) + 2 && ok; dy++) {
        for (let dx = -Math.ceil(rx) - 2; dx <= Math.ceil(rx) + 2; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const i = y * W + x;
          const m = t.mat[i];
          const inside = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
          const near = (dx * dx) / ((rx + 2) ** 2) + (dy * dy) / ((ry + 2) ** 2) <= 1;
          if (!near) continue;
          if (t.water[i] > 0) { ok = false; break; }
          if (inside) {
            if (t.flags[i] & F_NEST) { ok = false; break; }
            if (!IS_DIGGABLE[m] && m !== M.AIR) { ok = false; break; }
            if (m === M.AIR) { ok = false; break; } // пещеры и чужие ходы — не строим
            if (m === M.SAND || m === M.GRAVEL || m === M.LOOSE) soft++;
            wet += t.moist[i];
            total++;
          } else if (t.flags[i] & F_NEST && !(dx === 0)) {
            // не впритык к другой комнате
            if (Math.abs(dy) <= ry) { ok = false; break; }
          }
        }
      }
      if (!ok || total === 0) continue;
      // расстояние до ближайшего хода гнезда
      const anchor = this.nearestNestPoint(cx, cy);
      const tunnelLen = Math.hypot(anchor[0] - cx, anchor[1] - cy);
      const moistAvg = wet / total;
      let score = -tunnelLen * 0.6 - soft * 2;
      if (type === ROOM.FARM) score += moistAvg * 0.05;
      else score -= moistAvg * 0.05;
      if (type === ROOM.NURSERY) score += (cy - baseY) * 0.2;
      if (type === ROOM.FOOD || type === ROOM.BARRACKS) score -= (cy - baseY) * 0.15;
      score += rng.next() * 3;
      if (!best || score > best.score) best = { cx, cy, score };
    }
    if (!best) return null;
    const cells: [number, number][] = [];
    const seen = new Set<number>();
    const push = (x: number, y: number) => {
      const i = y * W + x;
      if (seen.has(i) || !t.inBounds(x, y)) return;
      if (!IS_SOLID[t.mat[i]]) return;
      seen.add(i);
      cells.push([x, y]);
    };
    // тоннель от ближайшего хода — сверху вниз, чтобы копать было откуда
    const [ax, ay] = this.nearestNestPoint(best.cx, best.cy);
    const n = Math.ceil(Math.hypot(best.cx - ax, best.cy - ay));
    for (let s = 0; s <= n; s++) {
      const x = Math.round(ax + ((best.cx - ax) * s) / n);
      const y = Math.round(ay + ((best.cy - ay) * s) / n);
      push(x, y);
      push(x, y + 1);
      if (Math.abs(best.cy - ay) > Math.abs(best.cx - ax)) push(x + 1, y);
    }
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) push(best.cx + dx, best.cy + dy);
    return { cx: best.cx, cy: best.cy, rx, ry, cells };
  }

  nearestNestPoint(x: number, y: number): [number, number] {
    let best: [number, number] = [this.entranceX, this.entranceY + 4];
    let bd = Math.hypot(x - best[0], y - best[1]);
    for (const r of this.rooms) {
      if (!r.built) continue;
      const d = Math.hypot(x - r.cx, y - r.cy);
      if (d < bd) { bd = d; best = [Math.round(r.cx), Math.round(r.cy)]; }
    }
    return best;
  }

  /** Самая безопасная (сухая и высокая) комната — для эвакуации. */
  safestRoom(except: number): Room | undefined {
    let best: Room | undefined;
    let bs = -Infinity;
    for (const r of this.rooms) {
      if (!r.built || r.id === except || r.flooded) continue;
      const s = -r.water * 0.01 - r.cy * 0.05 + (r.type === ROOM.NURSERY ? 5 : 0);
      if (s > bs) { bs = s; best = r; }
    }
    return best;
  }
}
