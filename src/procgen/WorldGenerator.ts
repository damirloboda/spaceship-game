import { Noise } from '../core/Noise';
import { hashSeed, Rng } from '../core/Rng';
import { CK } from '../creatures/CreatureTypes';
import { FK } from '../food/FoodTypes';
import { makeGenome, Plant, PK, rasterPlant } from '../plants/PlantShapes';
import { IS_SOLID, M } from '../world/Materials';
import { F_NEST, F_SETTLED, F_TUNNEL, Terrain } from '../world/Terrain';
import { Z, Zone } from '../world/Zones';

export interface WorldParams {
  seed: number;
  width: number;
  height: number;
  /** включить дом и улицу (нужна ширина >= 1600) */
  urban: boolean;
  /** сценарий "великая пропасть" */
  chasmChallenge?: boolean;
}

export interface FoodSpawn { kind: number; x: number; y: number; mass: number }
export interface CreatureSpawn { kind: number; x: number; y: number; home?: [number, number] }
export interface NestSpec {
  colony: number;
  entranceX: number;
  entranceY: number;
  /** прямоугольники стартовых комнат: [x0,y0,x1,y1,type] */
  rooms: [number, number, number, number, number][];
}

export interface WorldData {
  params: WorldParams;
  terrain: Terrain;
  zones: Zone[];
  plants: Plant[];
  foods: FoodSpawn[];
  creatures: CreatureSpawn[];
  nests: NestSpec[];
  landmarks: { name: string; x: number; y: number }[];
}

/** Типы комнат гнезда (используются и генератором для стартовых комнат). */
export const ROOM = {
  QUEEN: 0,
  FOOD: 1,
  NURSERY: 2,
  BARRACKS: 3,
  FARM: 4,
  STORAGE: 5,
  WATER: 6,
  LAB: 7,
  SHELTER: 8,
  TUNNEL: 9,
} as const;

export const DEFAULT_PARAMS: WorldParams = { seed: 1, width: 2048, height: 768, urban: true };

/**
 * Процедурная генерация. Полностью детерминирована от seed: один seed — один и тот же мир
 * до клетки (проверяется тестом). Слои: небо → поверхность (луг/сад/дом/улица) → гумус →
 * почва с линзами глины, песка и гравия → глина/камень с пещерами и подземной водой → коренная порода.
 */
export function generateWorld(params: WorldParams): WorldData {
  const { width: W, height: H } = params;
  const seed = params.seed >>> 0;
  const rng = new Rng(hashSeed(seed));
  const n = new Noise(hashSeed(seed + 101));
  const n2 = new Noise(hashSeed(seed + 202));
  const n3 = new Noise(hashSeed(seed + 303));
  const t = new Terrain(W, H);

  // --- зоны ---
  const urban = params.urban && W >= 1600;
  const zones: Zone[] = [];
  const houseX0 = urban ? Math.round(W * 0.615) : W + 10;
  const houseX1 = urban ? Math.round(W * 0.905) : W + 10;
  const meadowEnd = Math.round(W * (urban ? 0.19 : 0.3));
  const gardenEnd = urban ? houseX0 - 110 : W;
  zones.push({ kind: Z.MEADOW, x0: 0, x1: meadowEnd, indoor: false });
  zones.push({ kind: Z.GARDEN, x0: meadowEnd, x1: gardenEnd, indoor: false });
  if (urban) {
    zones.push({ kind: Z.PATH, x0: gardenEnd, x1: houseX0, indoor: false });
    zones.push({ kind: Z.HOUSE, x0: houseX0, x1: houseX1, indoor: true });
    zones.push({ kind: Z.STREET, x0: houseX1, x1: W, indoor: false });
  }

  const groundBase = Math.round(H * 0.43);
  const nestX = Math.round(meadowEnd + (gardenEnd - meadowEnd) * 0.22);
  const ditchX0 = nestX + 120 + rng.int(20);
  const ditchW = params.chasmChallenge ? 90 : 30;
  const ditchX1 = ditchX0 + ditchW;
  const ditchDepth = params.chasmChallenge ? 120 : 48;
  const pondX = Math.round(ditchX1 + (gardenEnd - ditchX1) * 0.62);

  // --- рельеф ---
  const surface = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    let h: number;
    if (x < meadowEnd) h = groundBase - 6 + (n.fbm1(x * 0.006, 4) - 0.5) * 60 + (n.fbm1(x * 0.04) - 0.5) * 6;
    else if (x < gardenEnd) h = groundBase + (n.fbm1(x * 0.005, 4) - 0.5) * 26 + (n.fbm1(x * 0.05) - 0.5) * 4;
    else if (x < houseX0) h = groundBase;
    else if (x < houseX1) h = groundBase;
    else h = groundBase + 2;
    // выравниваем площадку гнезда
    const dn = Math.abs(x - nestX);
    if (dn < 40) h = h + (groundBase - h) * (1 - dn / 40);
    // пруд — впадина
    const dp = Math.abs(x - pondX);
    if (urban && dp < 60) h += Math.cos((dp / 60) * Math.PI * 0.5) * 18;
    surface[x] = Math.round(h);
  }
  // сглаживаем переходы у дорожки
  for (let pass = 0; pass < 3; pass++)
    for (let x = 1; x < W - 1; x++) if (x > gardenEnd - 30 && x < houseX0 + 5) surface[x] = Math.round((surface[x - 1] + surface[x] * 2 + surface[x + 1]) / 4);

  const bedrockTop = (x: number) => H - 10 - Math.round(n2.fbm1(x * 0.03) * 8);
  const soilDepth = (x: number) => 64 + Math.round((n2.fbm1(x * 0.004 + 9) - 0.5) * 40);

  // --- грунт ---
  for (let x = 0; x < W; x++) {
    const s = surface[x];
    const sd = soilDepth(x);
    const br = bedrockTop(x);
    for (let y = s; y < H; y++) {
      const d = y - s;
      let m: number = M.SOIL;
      if (y >= br) m = M.BEDROCK;
      else if (d < 3 + Math.round(n.value2(x * 0.1, 3) * 2)) m = x > gardenEnd - 20 && x < houseX0 ? M.GRAVEL : M.TOPSOIL;
      else if (d < sd) {
        m = M.SOIL;
        const clay = n.fbm2(x * 0.02, y * 0.04, 3);
        const sand = n2.fbm2(x * 0.025 + 40, y * 0.05, 3);
        const grav = n3.value2(x * 0.08, y * 0.08);
        const stone = n3.fbm2(x * 0.04 + 100, y * 0.06, 2);
        if (clay > 0.66) m = M.CLAY;
        else if (sand > 0.7 && d > 8) m = M.SAND;
        else if (grav > 0.86) m = M.GRAVEL;
        if (stone > 0.74 && d > 6) m = M.STONE;
      } else {
        const mix = n.fbm2(x * 0.015, y * 0.02, 4);
        m = mix < 0.52 ? M.CLAY : M.STONE;
        if (n3.value2(x * 0.05, y * 0.05) > 0.88) m = M.GRAVEL;
      }
      t.setRaw(x, y, m);
    }
  }

  // --- пещеры (только в глубоких, связных слоях) и подземная вода ---
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = surface[x];
      const d = y - s;
      if (d < 85 || y >= bedrockTop(x) - 3) continue;
      const i = y * W + x;
      const m = t.mat[i];
      if (m !== M.CLAY && m !== M.STONE && m !== M.GRAVEL) continue;
      const r = n3.ridged2(x * 0.012, y * 0.022, 3);
      const worm = n2.fbm2(x * 0.01 + 7, y * 0.018, 3);
      if (r > 0.62 && worm > 0.42) {
        t.setRaw(x, y, M.AIR);
      }
    }
  }
  // вода в нижней части пещер
  for (let x = 0; x < W; x++) {
    if (n.value2(x * 0.01, 77) < 0.55) continue;
    for (let y = H - 12; y > surface[x] + 90; y--) {
      const i = y * W + x;
      if (t.mat[i] !== M.AIR) continue;
      if (IS_SOLID[t.mat[i + W]] || t.water[i + W] > 200) {
        t.water[i] = 255;
      }
    }
  }

  // --- канава (гладкая пластиковая, вода на дне) — место для живого моста ---
  const ditchFloor = groundBase + ditchDepth;
  for (let x = ditchX0 - 3; x <= ditchX1 + 3; x++) {
    if (x < 0 || x >= W) continue;
    for (let y = Math.min(surface[x], groundBase) - 1; y <= ditchFloor + 3; y++) {
      const inner = x >= ditchX0 && x <= ditchX1 && y < ditchFloor;
      const wall = !inner && y >= groundBase - 1;
      if (inner) t.setRaw(x, y, M.AIR);
      else if (wall) t.setRaw(x, y, M.PLASTIC);
    }
    surface[x] = Math.min(surface[x], groundBase);
  }
  for (let x = ditchX0; x <= ditchX1; x++)
    for (let y = ditchFloor - 9; y < ditchFloor; y++) t.water[y * W + x] = 255;
  // бортики канавы на уровне земли
  for (let x = ditchX0 - 3; x <= ditchX1 + 3; x++) {
    if (x >= ditchX0 && x <= ditchX1) continue;
    for (let y = groundBase - 1; y < surface[x] + 1 && y < H; y++) t.setRaw(x, y, M.PLASTIC);
  }

  // --- пруд ---
  if (urban) {
    for (let x = pondX - 60; x <= pondX + 60; x++) {
      const s = surface[x];
      // глиняное дно держит воду
      for (let y = s; y < s + 4; y++) t.setRaw(x, y, M.CLAY);
    }
    const level = surface[pondX] - 12;
    for (let x = pondX - 60; x <= pondX + 60; x++)
      for (let y = level; y < surface[x]; y++) if (!IS_SOLID[t.mat[y * W + x]]) t.water[y * W + x] = 255;
  }

  // --- дом, улица ---
  const landmarks: { name: string; x: number; y: number }[] = [];
  const foods: FoodSpawn[] = [];
  const creatures: CreatureSpawn[] = [];
  if (urban) buildHouse(t, rng, surface, houseX0, houseX1, groundBase, foods, creatures, landmarks);
  if (urban) buildStreet(t, rng, surface, houseX1, groundBase, foods, creatures, landmarks);
  if (urban) {
    // дорожка из плоских камней
    for (let x = gardenEnd; x < houseX0; x += 22) {
      const w = 18;
      for (let k = 0; k < w && x + k < houseX0; k++) for (let y = surface[x + k] - 3; y < surface[x + k] + 1; y++) t.setRaw(x + k, y, M.STONE);
    }
  }

  // --- флаги естественной устойчивости ---
  for (let i = 0; i < t.size; i++) if (IS_SOLID[t.mat[i]]) t.flags[i] |= F_SETTLED;

  // --- растения ---
  const plants: Plant[] = [];
  let pid = 1;
  const addPlant = (kind: number, x: number, size: number) => {
    x = Math.max(4, Math.min(W - 5, Math.round(x)));
    const y = firstSolid(t, x);
    const gm = t.mat[y * W + x];
    if (gm !== M.TOPSOIL && gm !== M.SOIL && gm !== M.CLAY && gm !== M.SAND) return;
    if (t.water[(y - 1) * W + x] > 0) return;
    const p: Plant = {
      id: pid++, kind, x, y, seed: hashSeed(seed * 31 + pid * 7919), size, age: size * 600, health: 1, water: 1,
      dead: false, fallen: false, genome: makeGenome(kind, hashSeed(seed + pid * 131)), fruitTimer: rng.range(20, 80), seedTimer: rng.range(40, 120), growTimer: rng.range(0, 10), flower: 0,
    };
    rasterPlant(p, size, (px, py, pm) => placePlantCell(t, p.id, px, py, pm, true));
    plants.push(p);
  };
  // дерево в саду и на лугу
  addPlant(PK.TREE, meadowEnd + 40, 1);
  addPlant(PK.TREE, rng.range(60, meadowEnd - 80), 0.8);
  addPlant(PK.BUSH, ditchX1 + 70, 1);
  addPlant(PK.BUSH, nestX - 90, 0.6);
  for (let x = 20; x < gardenEnd; x += rng.irange(18, 42)) {
    if (Math.abs(x - nestX) < 14 || (x > ditchX0 - 10 && x < ditchX1 + 10) || (urban && Math.abs(x - pondX) < 66)) continue;
    const r = rng.next();
    if (r < 0.2) addPlant(PK.DANDELION, x, rng.range(0.5, 1));
    else addPlant(PK.GRASS, x, rng.range(0.4, 1));
  }
  for (let x = 6; x < gardenEnd; x += rng.irange(3, 9)) {
    if (Math.abs(x - nestX) < 10 || (x > ditchX0 - 6 && x < ditchX1 + 6) || (urban && Math.abs(x - pondX) < 62)) continue;
    if (x < meadowEnd || rng.chance(0.6)) addPlant(PK.GRASS, x, rng.range(0.3, x < meadowEnd ? 1 : 0.7));
  }

  // --- гнёзда ---
  const nests: NestSpec[] = [];
  nests.push(carveNest(t, 0, nestX, surface[nestX]));
  if (!params.chasmChallenge) {
    const rx = Math.round(meadowEnd * 0.45);
    nests.push(carveNest(t, 1, rx, firstSolidSkipPlants(t, rx)));
  }

  // --- еда ---
  const addFood = (kind: number, x: number, mass: number, yOverride?: number) => {
    x = Math.round(Math.max(3, Math.min(W - 4, x)));
    let y = yOverride ?? firstSolidSkipPlants(t, x) - 1;
    // только в свободную клетку (не внутрь листвы и стеблей)
    if (yOverride === undefined) {
      for (let dx = 0; dx < 12; dx++) {
        const xx = x + (dx % 2 ? -1 : 1) * Math.ceil(dx / 2);
        const yy = firstSolidSkipPlants(t, xx) - 1;
        if (t.mat[yy * W + xx] === M.AIR) { x = xx; y = yy; break; }
      }
    }
    foods.push({ kind, x, y, mass });
  };
  // крошки рядом с гнездом — первая добыча
  for (let k = 0; k < 16; k++) addFood(FK.CRUMB, nestX + rng.range(25, 90) * rng.sign(), rng.range(0.6, 1.4));
  for (let k = 0; k < 10; k++) addFood(FK.SEED, nestX - rng.range(40, 140), rng.range(1, 2));
  addFood(FK.BERRY, nestX + 60, 7);
  addFood(FK.INSECT, nestX - 150, 18);
  // за канавой — огрызок яблока и ягоды: главная причина строить мост
  addFood(FK.FRUIT, ditchX1 + 30, params.chasmChallenge ? 400 : 60);
  for (let k = 0; k < 6; k++) addFood(FK.BERRY, ditchX1 + 55 + rng.range(0, 40), rng.range(6, 10));
  for (let k = 0; k < 20; k++) addFood(FK.CRUMB, ditchX1 + rng.range(10, 140), rng.range(0.6, 1.6));
  // луг
  for (let k = 0; k < 20; k++) addFood(FK.SEED, rng.range(10, meadowEnd), rng.range(1, 2));
  addFood(FK.INSECT, rng.range(40, meadowEnd - 40), 26);
  if (!params.chasmChallenge) addFood(FK.MUSHROOM, meadowEnd + rng.range(10, 40), 12);
  if (params.chasmChallenge) {
    // за пропастью — упавший пикник: хлеб, печенье, сахар
    for (let k = 0; k < 40; k++) addFood(FK.CRUMB, ditchX1 + rng.range(10, 300), rng.range(1, 3));
    addFood(FK.BREAD, ditchX1 + 60, 2500);
    addFood(FK.COOKIE, ditchX1 + 110, 1200);
    addFood(FK.COOKIE, ditchX1 + 150, 900);
    for (let k = 0; k < 60; k++) addFood(FK.SUGAR, ditchX1 + rng.range(40, 170), rng.range(0.5, 1));
  }

  // --- существа ---
  creatures.push({ kind: CK.SPIDER, x: ditchX1 + 110, y: firstSolid(t, ditchX1 + 110) - 2, home: [ditchX1 + 110, firstSolid(t, ditchX1 + 110) - 2] });
  creatures.push({ kind: CK.BEETLE, x: nestX - 200, y: firstSolid(t, nestX - 200) - 2 });
  creatures.push({ kind: CK.BEETLE, x: ditchX1 + 180, y: firstSolid(t, ditchX1 + 180) - 2 });
  for (let k = 0; k < 7; k++) {
    const wx = rng.range(40, W - 40) | 0;
    const wy = firstSolid(t, wx) + rng.irange(12, 60);
    if (t.mat[wy * W + wx] === M.SOIL || t.mat[wy * W + wx] === M.CLAY) creatures.push({ kind: CK.WORM, x: wx, y: wy });
  }
  for (const p of plants) if ((p.kind === PK.BUSH || p.kind === PK.TREE) && rng.chance(0.8)) creatures.push({ kind: CK.CATERPILLAR, x: p.x + rng.range(-6, 6), y: p.y - p.genome.height * p.size * 0.6 });
  for (let k = 0; k < 3; k++) creatures.push({ kind: CK.FLY, x: rng.range(meadowEnd, gardenEnd), y: groundBase - rng.range(20, 80) });

  landmarks.push({ name: 'Гнездо', x: nestX, y: surface[nestX] });
  landmarks.push({ name: 'Канава', x: (ditchX0 + ditchX1) / 2, y: groundBase });
  if (urban) landmarks.push({ name: 'Пруд', x: pondX, y: surface[pondX] });

  t.rebuildSkyline();
  initMoisture(t);
  initTemperature(t);
  return { params, terrain: t, zones, plants, foods, creatures, nests, landmarks };
}

function firstSolid(t: Terrain, x: number): number {
  let y = 0;
  while (y < t.H - 1 && !IS_SOLID[t.mat[y * t.W + x]]) y++;
  return y;
}

function firstSolidSkipPlants(t: Terrain, x: number): number {
  let y = 0;
  while (y < t.H - 1) {
    const m = t.mat[y * t.W + x];
    if (IS_SOLID[m] && t.plant[y * t.W + x] === 0) break;
    y++;
  }
  return y;
}

export function placePlantCell(t: Terrain, plantId: number, x: number, y: number, m: number, raw: boolean): boolean {
  if (!t.inBounds(x, y)) return false;
  const i = y * t.W + x;
  const cur = t.mat[i];
  if (m === M.ROOT) {
    if (cur !== M.SOIL && cur !== M.TOPSOIL && cur !== M.CLAY && cur !== M.SAND && cur !== M.LOOSE) return false;
  } else {
    if (cur !== M.AIR) return t.plant[i] === plantId;
    if (t.water[i] > 60) return false;
  }
  if (raw) t.setRaw(x, y, m);
  else t.set(x, y, m);
  t.plant[i] = plantId;
  return true;
}

/** Стартовое гнездо: вход, наклонный тоннель, камера матки и маленькая кладовая. */
function carveNest(t: Terrain, colony: number, x: number, sy: number): NestSpec {
  const W = t.W;
  const rooms: [number, number, number, number, number][] = [];
  const carve = (cx: number, cy: number) => {
    if (!t.inBounds(cx, cy)) return;
    const i = cy * W + cx;
    if (t.mat[i] === M.BEDROCK) return;
    t.setRaw(cx, cy, M.AIR);
    t.water[i] = 0;
    t.flags[i] |= F_NEST | F_TUNNEL;
    t.plant[i] = 0;
  };
  // вход и расчистка травы
  for (let dx = -6; dx <= 6; dx++)
    for (let y = sy - 30; y < sy; y++) {
      const i = y * W + x + dx;
      if (t.plant[i]) { t.setRaw(x + dx, y, M.AIR); t.plant[i] = 0; }
    }
  // тоннель
  let tx = x;
  let ty = sy - 1;
  const depth = 26;
  for (let k = 0; k < depth; k++) {
    tx += k % 3 === 0 ? 1 : 0;
    ty += 1;
    for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) carve(tx + dx, ty + dy);
  }
  // камера матки
  const qx = tx + 6;
  const qy = ty + 2;
  const carveRoom = (cx: number, cy: number, rx: number, ry: number, type: number) => {
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
      for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
        if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1) carve(cx + dx, cy + dy);
    // укреплённый свод
    for (let dy = -Math.ceil(ry) - 1; dy <= Math.ceil(ry) + 1; dy++)
      for (let dx = -Math.ceil(rx) - 1; dx <= Math.ceil(rx) + 1; dx++) {
        const i = (cy + dy) * W + cx + dx;
        if (!t.inBounds(cx + dx, cy + dy)) continue;
        const m = t.mat[i];
        if (m !== M.AIR && m !== M.BEDROCK && m !== M.STONE && (dx * dx) / ((rx + 1.5) ** 2) + (dy * dy) / ((ry + 1.5) ** 2) <= 1) t.setRaw(cx + dx, cy + dy, M.NESTWALL);
      }
    rooms.push([Math.round(cx - rx), Math.round(cy - ry), Math.round(cx + rx), Math.round(cy + ry), type]);
  };
  carveRoom(qx, qy, 8, 3.5, ROOM.QUEEN);
  for (let k = -3; k <= 6; k++) for (let dy = 0; dy <= 1; dy++) carve(tx + k, ty + dy);
  // кладовая выше
  const fx = x - 12;
  const fy = sy + 12;
  let cx2 = x;
  let cy2 = sy + 8;
  while (cx2 > fx + 4) {
    for (let dy = 0; dy <= 1; dy++) carve(cx2, cy2 + dy);
    cx2--;
    if (cx2 % 3 === 0) cy2++;
  }
  carveRoom(fx, fy, 5, 2.5, ROOM.FOOD);
  // детская под камерой матки
  carveRoom(qx - 10, qy + 9, 5.5, 2.5, ROOM.NURSERY);
  for (let k = 0; k < 9; k++) for (let dx = 0; dx <= 1; dx++) carve(qx - 4 - Math.round(k * 0.6) + dx, qy + 2 + k);
  // холмик выброшенной земли вокруг входа
  for (let dx = -7; dx <= 7; dx++) {
    const hgt = Math.round(3 - Math.abs(dx) * 0.4);
    if (Math.abs(dx) <= 1) continue;
    for (let k = 1; k <= hgt; k++) {
      const yy = sy - k;
      if (t.mat[yy * W + x + dx] === M.AIR) t.setRaw(x + dx, yy, M.LOOSE);
    }
  }
  return { colony, entranceX: x, entranceY: sy - 1, rooms };
}

function buildHouse(
  t: Terrain, rng: Rng, surface: Int16Array, x0: number, x1: number, g: number,
  foods: FoodSpawn[], creatures: CreatureSpawn[], landmarks: { name: string; x: number; y: number }[],
): void {
  const W = t.W;
  const H = t.H;
  const fill = (ax: number, ay: number, bx: number, by: number, m: number) => {
    for (let y = Math.max(0, ay); y <= Math.min(H - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(W - 1, bx); x++) { t.setRaw(x, y, m); t.water[y * W + x] = 0; }
  };
  const floorY = g - 10; // верх пола
  const wallW = 12;
  // фундамент
  fill(x0, floorY, x0 + wallW, g + 70, M.CONCRETE);
  fill(x1 - wallW, floorY, x1, g + 70, M.CONCRETE);
  // подвал
  fill(x0 + wallW, floorY, x1 - wallW, floorY + 10, M.CONCRETE);
  fill(x0 + wallW, floorY + 11, x1 - wallW, g + 60, M.AIR);
  fill(x0 + wallW, g + 61, x1 - wallW, g + 70, M.CONCRETE);
  // трещина в фундаменте со стороны сада — путь в подвал
  for (let k = 0; k <= wallW; k++) for (let dy = 0; dy < 3; dy++) t.setRaw(x0 + k, g + 18 + dy + (k > 6 ? 1 : 0), M.AIR);
  // трубы в подвале
  fill(x0 + wallW, g + 8, x1 - wallW - 40, g + 11, M.METAL);
  // коробки и банки в подвале
  fill(x0 + 60, g + 34, x0 + 110, g + 60, M.PAPER);
  fill(x0 + 64, g + 38, x0 + 106, g + 59, M.AIR);
  fill(x0 + 160, g + 40, x0 + 180, g + 60, M.GLASS);
  fill(x0 + 163, g + 43, x0 + 177, g + 60, M.AIR);
  // стены дома до верха мира, крыша не видна (дом огромен)
  fill(x0, 0, x0 + wallW, floorY, M.BRICK);
  fill(x1 - wallW, 0, x1, floorY, M.BRICK);
  fill(x0 + wallW, 0, x1 - wallW, 6, M.CONCRETE); // потолок — дождь не проходит
  // щель в кирпичной стене у земли
  for (let k = 0; k <= wallW; k++) for (let dy = 1; dy <= 2; dy++) t.setRaw(x0 + k, floorY - dy, M.AIR);
  // деревянный пол
  fill(x0 + wallW, floorY - 3, x1 - wallW, floorY - 1, M.WOOD);
  const fy = floorY - 4; // первая пустая клетка над полом
  // стол на металлических ножках
  const tx0 = x0 + 90;
  const tx1 = tx0 + 170;
  const tableTop = fy - 130;
  fill(tx0, tableTop, tx1, tableTop + 5, M.WOOD);
  fill(tx0 + 8, tableTop + 6, tx0 + 11, fy, M.METAL);
  fill(tx1 - 11, tableTop + 6, tx1 - 8, fy, M.METAL);
  // скатерть свисает — по ней можно залезть, если добраться до края
  fill(tx1 + 1, tableTop - 1, tx1 + 1, tableTop + 95, M.FABRIC);
  fill(tx0, tableTop - 1, tx1 + 1, tableTop - 1, M.FABRIC);
  // стул
  const cx0 = tx1 + 40;
  fill(cx0, fy - 70, cx0 + 60, fy - 66, M.WOOD);
  fill(cx0 + 2, fy - 65, cx0 + 5, fy, M.WOOD);
  fill(cx0 + 55, fy - 65, cx0 + 58, fy, M.WOOD);
  fill(cx0 + 55, fy - 160, cx0 + 58, fy - 71, M.WOOD);
  // мусорное ведро (гладкий пластик)
  const bx0 = cx0 + 100;
  fill(bx0, fy - 80, bx0 + 2, fy, M.PLASTIC);
  fill(bx0 + 52, fy - 80, bx0 + 54, fy, M.PLASTIC);
  fill(bx0, fy - 1, bx0 + 54, fy, M.PLASTIC);
  fill(bx0 + 3, fy - 12, bx0 + 51, fy - 2, M.PAPER);
  fill(bx0 + 3, fy - 16, bx0 + 30, fy - 13, M.ORGANIC);
  // кухонная тумба с сахаром
  const kx0 = bx0 + 110;
  const kx1 = Math.min(x1 - wallW - 60, kx0 + 150);
  fill(kx0, fy - 160, kx1, fy, M.WOOD);
  fill(kx0 + 6, fy - 150, kx1 - 6, fy - 90, M.AIR);
  fill(kx0 + 6, fy - 92, kx1 - 6, fy - 90, M.WOOD);
  fill(kx0 - 2, fy - 164, kx1 + 2, fy - 161, M.STONE); // столешница
  fill(kx0 + 20, fy - 110, kx0 + 44, fy - 93, M.PAPER); // пакет сахара
  fill(kx0 + 23, fy - 107, kx0 + 41, fy - 94, M.AIR);
  // холодильник
  fill(x1 - wallW - 58, 40, x1 - wallW - 4, fy, M.METAL);
  // стопка книг — "лестница" к столу
  fill(tx0 - 40, fy - 12, tx0 - 4, fy, M.PAPER);
  fill(tx0 - 34, fy - 22, tx0 - 8, fy - 13, M.PAPER);
  // провод по полу
  for (let k = 0; k < 80; k++) t.setRaw(tx0 + 20 + k, fy - (k > 60 ? k - 60 : 0), M.PLASTIC);
  // еда человека
  foods.push({ kind: FK.COOKIE, x: tx0 + 70, y: tableTop - 8, mass: 200 });
  foods.push({ kind: FK.HUMAN, x: tx0 + 120, y: tableTop - 5, mass: 40 });
  for (let k = 0; k < 40; k++) foods.push({ kind: FK.CRUMB, x: tx0 + rng.range(10, 170), y: fy - 1, mass: rng.range(0.6, 2) });
  for (let k = 0; k < 50; k++) foods.push({ kind: FK.SUGAR, x: kx0 + rng.range(-30, 40), y: fy - 1, mass: rng.range(0.4, 0.8) });
  for (let k = 0; k < 30; k++) foods.push({ kind: FK.SUGAR, x: kx0 + 24 + rng.range(0, 16), y: fy - 95, mass: 0.6 });
  foods.push({ kind: FK.BREAD, x: bx0 + 30, y: fy - 22, mass: 120 });
  foods.push({ kind: FK.LEFTOVER, x: bx0 + 14, y: fy - 22, mass: 50 });
  foods.push({ kind: FK.MEAT, x: bx0 + 42, y: fy - 16, mass: 25 });
  creatures.push({ kind: CK.SPIDER, x: x0 + 140, y: g + 58, home: [x0 + 140, g + 58] });
  creatures.push({ kind: CK.FLY, x: bx0 + 25, y: fy - 100 });
  creatures.push({ kind: CK.FLY, x: tx0 + 60, y: tableTop - 40 });
  creatures.push({ kind: CK.BEETLE, x: x0 + 90, y: g + 58 });
  for (let x = x0; x <= x1; x++) surface[x] = fy + 1;
  landmarks.push({ name: 'Дом: кухня', x: tx0 + 80, y: tableTop });
  landmarks.push({ name: 'Подвал', x: x0 + 100, y: g + 40 });
}

function buildStreet(
  t: Terrain, rng: Rng, surface: Int16Array, x0: number, g: number,
  foods: FoodSpawn[], creatures: CreatureSpawn[], landmarks: { name: string; x: number; y: number }[],
): void {
  const W = t.W;
  const H = t.H;
  const fill = (ax: number, ay: number, bx: number, by: number, m: number) => {
    for (let y = Math.max(0, ay); y <= Math.min(H - 1, by); y++) for (let x = Math.max(0, ax); x <= Math.min(W - 1, bx); x++) { t.setRaw(x, y, m); t.water[y * W + x] = 0; }
  };
  const sw0 = x0 + 1;
  const sw1 = sw0 + 70;
  // тротуар
  fill(sw0, g - 4, sw1, g + 4, M.CONCRETE);
  fill(sw0, g + 5, sw1, g + 12, M.GRAVEL);
  // бордюр и дорога
  fill(sw1, g - 4, sw1 + 6, g + 16, M.CONCRETE);
  fill(sw1 + 7, g + 8, W - 1, g + 14, M.ASPHALT);
  fill(sw1 + 7, g + 15, W - 1, g + 22, M.GRAVEL);
  fill(sw1 + 7, g - 60, W - 1, g + 7, M.AIR);
  // ливнёвка: решётка и труба-коллектор
  for (let k = 0; k < 24; k++) if (k % 4 !== 0) t.setRaw(sw1 + 10 + k, g + 8, M.AIR);
  fill(sw1 + 10, g + 9, sw1 + 33, g + 40, M.AIR);
  fill(sw1 + 8, g + 9, sw1 + 9, g + 40, M.CONCRETE);
  fill(sw1 + 34, g + 9, sw1 + 35, g + 40, M.CONCRETE);
  // коллектор
  const py = g + 60;
  fill(sw1 - 20, py - 18, W - 1, py - 16, M.CONCRETE);
  fill(sw1 - 20, py + 16, W - 1, py + 18, M.CONCRETE);
  fill(sw1 - 20, py - 15, W - 1, py + 15, M.AIR);
  fill(sw1 + 10, g + 41, sw1 + 33, py - 16, M.AIR);
  for (let x = sw1 - 20; x < W; x++) for (let y = py + 10; y <= py + 15; y++) t.water[y * W + x] = 255;
  foods.push({ kind: FK.HUMAN, x: sw0 + 30, y: g - 6, mass: 50 });
  foods.push({ kind: FK.LEFTOVER, x: sw1 + 60, y: g + 6, mass: 80 });
  for (let k = 0; k < 12; k++) foods.push({ kind: FK.CRUMB, x: sw0 + rng.range(0, 60), y: g - 5, mass: rng.range(0.5, 1.5) });
  creatures.push({ kind: CK.FLY, x: sw1 + 60, y: g - 20 });
  creatures.push({ kind: CK.BEETLE, x: sw1 + 90, y: py + 8 });
  for (let x = x0; x < W; x++) surface[x] = x < sw1 ? g - 4 : g + 8;
  landmarks.push({ name: 'Улица', x: sw1 + 40, y: g });
  landmarks.push({ name: 'Коллектор', x: sw1 + 100, y: py });
}

function initMoisture(t: Terrain): void {
  const W = t.W;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < t.H; y++) {
      const i = y * W + x;
      const m = t.mat[i];
      if (!IS_SOLID[m]) continue;
      const d = y - t.skyline[x];
      let v = 40 + Math.min(80, d * 0.6);
      // у воды мокро
      if (t.water[i - W] > 0 || (x > 0 && t.water[i - 1] > 0) || (x < W - 1 && t.water[i + 1] > 0)) v = 200;
      if (m === M.SAND) v *= 0.5;
      if (m === M.STONE || m === M.METAL || m === M.CONCRETE || m === M.PLASTIC || m === M.GLASS || m === M.BEDROCK) v = 0;
      t.moist[i] = Math.min(220, v);
    }
  }
}

function initTemperature(t: Terrain): void {
  for (let ty = 0; ty < t.tempH; ty++)
    for (let tx = 0; tx < t.tempW; tx++) {
      const x = tx * 8;
      const y = ty * 8;
      const d = y - t.skyline[Math.min(t.W - 1, x)];
      t.temp[ty * t.tempW + tx] = d < 0 ? 20 : 20 - Math.min(8, d * 0.04);
    }
}
