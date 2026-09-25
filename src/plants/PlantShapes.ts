import { hash2, Rng } from '../core/Rng';
import { M } from '../world/Materials';

/** Виды растений. */
export const PK = {
  GRASS: 0,
  DANDELION: 1,
  BUSH: 2,
  TREE: 3,
  SAKURA: 4,
} as const;
export const PLANT_NAMES = ['трава', 'одуванчик', 'ягодный куст', 'дерево', 'сакура'];

export interface PlantGenome {
  height: number;
  trunkW: number;
  branches: number;
  branchLen: number;
  leafR: number;
  rootD: number;
  lean: number;
  stems: number;
}

export interface Plant {
  id: number;
  kind: number;
  x: number;
  /** y поверхности у основания (первая клетка грунта) */
  y: number;
  seed: number;
  size: number;
  age: number;
  health: number;
  water: number;
  dead: boolean;
  fallen: boolean;
  genome: PlantGenome;
  fruitTimer: number;
  seedTimer: number;
  growTimer: number;
  /** стадия цветка одуванчика: 0 бутон, 1 цветок, 2 пух */
  flower: number;
}

export function makeGenome(kind: number, seed: number): PlantGenome {
  const r = new Rng(seed);
  switch (kind) {
    case PK.GRASS:
      return { height: r.irange(6, 22), trunkW: 1, branches: 0, branchLen: 0, leafR: 0, rootD: r.irange(3, 7), lean: r.range(-0.5, 0.5), stems: r.irange(1, 4) };
    case PK.DANDELION:
      return { height: r.irange(26, 52), trunkW: 1, branches: 0, branchLen: r.irange(4, 8), leafR: r.range(2.2, 3.2), rootD: r.irange(10, 20), lean: r.range(-0.25, 0.25), stems: 1 };
    case PK.BUSH:
      return { height: r.irange(40, 70), trunkW: 2, branches: r.irange(4, 7), branchLen: r.irange(14, 26), leafR: r.range(7, 11), rootD: r.irange(20, 34), lean: r.range(-0.2, 0.2), stems: r.irange(3, 5) };
    case PK.SAKURA:
      return { height: r.irange(95, 150), trunkW: r.irange(5, 7), branches: r.irange(6, 9), branchLen: r.irange(40, 64), leafR: r.range(13, 19), rootD: r.irange(40, 60), lean: r.range(-0.3, 0.3), stems: 1 };
    default:
      return { height: r.irange(150, 230), trunkW: r.irange(6, 9), branches: r.irange(5, 8), branchLen: r.irange(30, 55), leafR: r.range(15, 24), rootD: r.irange(45, 75), lean: r.range(-0.15, 0.15), stems: 1 };
  }
}

type Emit = (x: number, y: number, mat: number) => void;

function line(x0: number, y0: number, x1: number, y1: number, thick: number, mat: number, emit: Emit): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const r = thick / 2;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    if (thick <= 1) { emit(Math.round(cx), Math.round(cy), mat); continue; }
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
        if (dx * dx + dy * dy <= r * r + 0.3) emit(Math.round(cx + dx), Math.round(cy + dy), mat);
  }
}

function blob(cx: number, cy: number, rx: number, ry: number, seed: number, mat: number, emit: Emit): void {
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
      const jitter = 0.72 + 0.4 * hash2(Math.round(cx + dx), Math.round(cy + dy), seed);
      if (d < jitter) emit(Math.round(cx + dx), Math.round(cy + dy), mat);
    }
}

/**
 * Процедурная форма растения при размере s (0..1).
 * Рост — это растеризация формы при увеличивающемся s: ствол вытягивается,
 * ветви удлиняются, крона набирается, корни уходят вглубь.
 * Возвращает также "точки плодов" — места, где висят ягоды/семена.
 */
export function rasterPlant(p: Plant, s: number, emit: Emit, fruitSpots?: [number, number][]): void {
  const g = p.genome;
  const bx = p.x;
  const by = p.y - 1; // первая клетка над землёй
  const rng = new Rng(p.seed);
  s = Math.max(0.05, Math.min(1, s));
  switch (p.kind) {
    case PK.GRASS: {
      for (let k = 0; k < g.stems; k++) {
        const h = Math.max(2, Math.round(g.height * s * (0.7 + 0.3 * rng.next())));
        const ox = k - (g.stems >> 1);
        const lean = g.lean + rng.range(-0.3, 0.3);
        for (let i = 0; i < h; i++) {
          const t = i / h;
          emit(bx + ox + Math.round(lean * t * t * h * 0.35), by - i, M.GRASS);
        }
      }
      for (let i = 1; i <= Math.round(g.rootD * s); i++) emit(bx + (i % 2), by + i, M.ROOT);
      return;
    }
    case PK.DANDELION: {
      const h = Math.max(3, Math.round(g.height * s));
      let topX = bx;
      for (let i = 0; i < h; i++) {
        const t = i / h;
        topX = bx + Math.round(g.lean * t * t * h * 0.3);
        emit(topX, by - i, M.STEM);
      }
      // розетка листьев
      const ll = Math.round(g.branchLen * Math.min(1, s * 1.5));
      for (let i = 1; i <= ll; i++) {
        const lift = Math.round(Math.sin((i / ll) * Math.PI) * 1.5);
        emit(bx - i, by - lift, M.LEAF);
        emit(bx + i, by - lift, M.LEAF);
      }
      if (s > 0.6 && p.flower < 3) {
        const r = g.leafR * (s > 0.8 ? 1 : 0.6);
        blob(topX, by - h - r + 1, r, r * 0.8, p.seed, M.FLOWER, emit);
        fruitSpots?.push([topX, by - h - r]);
      }
      for (let i = 1; i <= Math.round(g.rootD * s); i++) emit(bx, by + i, M.ROOT);
      return;
    }
    case PK.BUSH: {
      const h = g.height * s;
      for (let k = 0; k < g.stems; k++) {
        const ang = -Math.PI / 2 + (k - (g.stems - 1) / 2) * 0.35 + rng.range(-0.1, 0.1);
        const len = h * rng.range(0.75, 1);
        const ex = bx + Math.cos(ang) * len;
        const ey = by + Math.sin(ang) * len;
        line(bx, by, ex, ey, s > 0.5 ? 2 : 1, M.WOOD, emit);
        // листва по стеблю
        const nb = Math.max(1, Math.round(g.branches * s));
        for (let b = 0; b < nb; b++) {
          const t = 0.45 + 0.55 * ((b + 1) / nb);
          const lx = bx + (ex - bx) * t + rng.range(-3, 3);
          const ly = by + (ey - by) * t;
          blob(lx, ly, g.leafR * s * rng.range(0.7, 1.1), g.leafR * s * 0.75, p.seed + b * 7 + k * 31, M.LEAF, emit);
          if (fruitSpots && s > 0.7) fruitSpots.push([Math.round(lx + rng.range(-4, 4)), Math.round(ly + g.leafR * s * 0.6)]);
        }
      }
      const rd = Math.round(g.rootD * s);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 2 + (k - 1.5) * 0.45;
        line(bx, by + 1, bx + Math.cos(a) * rd, by + 1 + Math.sin(a) * rd, 1, M.ROOT, emit);
      }
      return;
    }
    case PK.SAKURA: {
      // сакура: невысокий изогнутый ствол, широкие почти горизонтальные ветви, облака цветов
      const H = g.height * s;
      const tw = Math.max(1, Math.round(g.trunkW * Math.sqrt(s)));
      const bend = (t: number) => bx + g.lean * H * 0.5 * Math.sin(t * 2.6) + g.lean * t * H * 0.3;
      let top: [number, number] = [bx, by];
      for (let i = 0; i < H; i++) {
        const t = i / H;
        const cx = bend(t);
        const w = Math.max(1, Math.round(tw * (1 - t * 0.5)));
        for (let k = 0; k < w; k++) emit(Math.round(cx - w / 2 + k + 0.5), by - i, M.WOOD);
        top = [cx, by - i];
      }
      for (let k = 1; k <= Math.round(tw * 0.9); k++) {
        emit(Math.round(bx - tw / 2 - k), by - Math.max(0, Math.round(tw * 0.7) - k), M.WOOD);
        emit(Math.round(bx + tw / 2 + k), by - Math.max(0, Math.round(tw * 0.7) - k), M.WOOD);
      }
      const nb = Math.max(1, Math.round(g.branches * Math.min(1, s * 1.3)));
      for (let b = 0; b < nb; b++) {
        const t = 0.45 + 0.5 * (b / Math.max(1, nb - 1));
        const side = b % 2 === 0 ? -1 : 1;
        const sx = bend(t);
        const sy = by - t * H;
        const len = g.branchLen * s * rng.range(0.7, 1.15) * (1 - t * 0.3);
        // ветвь чуть поднимается, потом изгибается вниз под тяжестью цветов
        const mx = sx + side * len * 0.55;
        const my = sy - len * rng.range(0.12, 0.3);
        const ex = sx + side * len;
        const ey = my + len * rng.range(0.02, 0.15);
        line(sx, sy, mx, my, Math.max(1, Math.round(tw * 0.4)), M.WOOD, emit);
        line(mx, my, ex, ey, Math.max(1, Math.round(tw * 0.25)), M.WOOD, emit);
        const r = g.leafR * s * rng.range(0.8, 1.2);
        blob(ex, ey - 2, r, r * 0.6, p.seed + b * 17, M.BLOSSOM, emit);
        blob(mx, my - 3, r * 0.8, r * 0.5, p.seed + b * 29, M.BLOSSOM, emit);
        blob(ex - side * r * 0.4, ey + r * 0.2, r * 0.45, r * 0.3, p.seed + b * 31, M.LEAF, emit);
        if (fruitSpots && s > 0.6) fruitSpots.push([Math.round(ex), Math.round(ey + r * 0.3)]);
      }
      blob(top[0], top[1] - g.leafR * s * 0.3, g.leafR * s * 1.4, g.leafR * s * 0.85, p.seed + 777, M.BLOSSOM, emit);
      const rd = g.rootD * s;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k - 2.5) * 0.45;
        line(bx, by + 1, bx + Math.cos(a) * rd * 0.8, by + 1 + Math.sin(a) * rd * 0.8, k === 2 || k === 3 ? 2 : 1, M.ROOT, emit);
      }
      return;
    }
    default: {
      // дерево
      const H = g.height * s;
      const tw = Math.max(1, Math.round(g.trunkW * Math.sqrt(s)));
      let tx = bx;
      const trunkTop: [number, number] = [bx, by];
      for (let i = 0; i < H; i++) {
        const t = i / H;
        tx = bx + g.lean * t * t * H * 0.25;
        const w = Math.max(1, Math.round(tw * (1 - t * 0.55)));
        for (let k = 0; k < w; k++) emit(Math.round(tx - w / 2 + k + 0.5), by - i, M.WOOD);
        trunkTop[0] = tx;
        trunkTop[1] = by - i;
      }
      // корневые лапы у основания
      for (let k = 1; k <= Math.round(tw * 0.8); k++) {
        emit(Math.round(bx - tw / 2 - k), by - Math.max(0, Math.round(tw * 0.8) - k), M.WOOD);
        emit(Math.round(bx + tw / 2 + k), by - Math.max(0, Math.round(tw * 0.8) - k), M.WOOD);
      }
      const nb = Math.max(1, Math.round(g.branches * Math.min(1, s * 1.3)));
      for (let b = 0; b < nb; b++) {
        const t = 0.4 + 0.55 * (b / Math.max(1, nb - 1));
        const side = b % 2 === 0 ? -1 : 1;
        const sx = bx + g.lean * t * t * H * 0.25;
        const sy = by - t * H;
        const len = g.branchLen * s * rng.range(0.7, 1.1) * (1 - t * 0.4);
        const ang = side > 0 ? -rng.range(0.35, 0.8) : Math.PI + rng.range(0.35, 0.8);
        const ex = sx + Math.cos(ang) * len;
        const ey = sy + Math.sin(ang) * len;
        line(sx, sy, ex, ey, Math.max(1, Math.round(tw * 0.35)), M.WOOD, emit);
        blob(ex, ey - 2, g.leafR * s * rng.range(0.8, 1.2), g.leafR * s * 0.65, p.seed + b * 13, M.LEAF, emit);
        if (fruitSpots && s > 0.8) fruitSpots.push([Math.round(ex), Math.round(ey + g.leafR * s * 0.5)]);
      }
      blob(trunkTop[0], trunkTop[1] - g.leafR * s * 0.4, g.leafR * s * 1.3, g.leafR * s * 0.9, p.seed + 999, M.LEAF, emit);
      const rd = g.rootD * s;
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k - 2.5) * 0.4;
        const l = rd * (k === 2 || k === 3 ? 1 : 0.7);
        line(bx, by + 1, bx + Math.cos(a) * l, by + 1 + Math.sin(a) * l, k === 2 || k === 3 ? 2 : 1, M.ROOT, emit);
      }
      return;
    }
  }
}
