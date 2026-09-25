/**
 * Материалы мира. Каждый блок мира — клетка с материалом; свойства материала
 * задают прочность (время копания), массу, пролёт опоры, пористость для воды,
 * возможность лазать по поверхности и то, во что превращается выкопанная клетка.
 */
export const M = {
  AIR: 0,
  SOIL: 1,
  SAND: 2,
  CLAY: 3,
  STONE: 4,
  BEDROCK: 5,
  WOOD: 6,
  LEAF: 7,
  GRASS: 8,
  ROOT: 9,
  MUD: 10,
  METAL: 11,
  GLASS: 12,
  PLASTIC: 13,
  PAPER: 14,
  FABRIC: 15,
  CONCRETE: 16,
  BRICK: 17,
  ASPHALT: 18,
  ORGANIC: 19,
  LOOSE: 20, // рыхлая земля: отвалы, обломки обвала
  BUILT: 21, // земля, уложенная муравьями
  NESTWALL: 22, // укреплённая стена (глина + секрет)
  WEB: 23, // паутина
  STEM: 24, // зелёный стебель
  GRAVEL: 25,
  TOPSOIL: 26, // гумус у поверхности
  FLOWER: 27, // лепестки
  BLOSSOM: 28, // цветы сакуры
} as const;

export type MaterialId = number;
export const MATERIAL_COUNT = 29;

export interface MaterialDef {
  id: number;
  key: string;
  name: string;
  solid: boolean;
  /** секунд копания для рабочего; Infinity — не копается */
  hardness: number;
  /** относительная масса клетки */
  density: number;
  /** на сколько клеток по горизонтали держит пролёт без опоры снизу */
  span: number;
  /** сыпучий: падает сам как песок */
  granular: boolean;
  /** по поверхности можно лазать вертикально/вниз головой */
  climbable: boolean;
  /** впитывает воду (0..1) */
  porous: number;
  /** какой материал получается из добытого куска */
  yields: number;
  /** можно ли муравьям использовать как строительный материал */
  buildable: boolean;
  /** органика: гниёт, съедобна для грибной фермы */
  organic: boolean;
  color: [number, number, number];
}

const T = Infinity;

function def(
  id: number,
  key: string,
  name: string,
  p: Partial<MaterialDef> & { color: [number, number, number] },
): MaterialDef {
  return {
    id,
    key,
    name,
    solid: true,
    hardness: 3,
    density: 1.5,
    span: 3,
    granular: false,
    climbable: true,
    porous: 0,
    yields: id,
    buildable: false,
    organic: false,
    ...p,
  };
}

export const MATERIALS: MaterialDef[] = [
  def(M.AIR, 'air', 'воздух', { solid: false, hardness: 0, density: 0, span: 0, climbable: false, color: [0, 0, 0] }),
  def(M.SOIL, 'soil', 'земля', { hardness: 1.6, density: 1.5, span: 4, porous: 0.5, yields: M.LOOSE, buildable: true, color: [104, 72, 46] }),
  def(M.SAND, 'sand', 'песок', { hardness: 0.6, density: 1.6, span: 0, granular: true, porous: 0.9, yields: M.SAND, buildable: true, color: [196, 170, 116] }),
  def(M.CLAY, 'clay', 'глина', { hardness: 3.2, density: 1.8, span: 7, porous: 0.08, yields: M.CLAY, buildable: true, color: [150, 92, 64] }),
  def(M.STONE, 'stone', 'камень', { hardness: T, density: 2.6, span: 24, color: [118, 116, 112] }),
  def(M.BEDROCK, 'bedrock', 'коренная порода', { hardness: T, density: 3, span: 999, color: [48, 44, 46] }),
  def(M.WOOD, 'wood', 'дерево', { hardness: 9, density: 0.7, span: 30, porous: 0.1, yields: M.ORGANIC, color: [112, 78, 48] }),
  def(M.LEAF, 'leaf', 'листья', { hardness: 0.5, density: 0.2, span: 30, porous: 0.2, yields: M.LEAF, organic: true, color: [72, 128, 52] }),
  def(M.GRASS, 'grass', 'трава', { hardness: 0.8, density: 0.3, span: 30, porous: 0.3, yields: M.LEAF, organic: true, color: [88, 150, 60] }),
  def(M.ROOT, 'root', 'корни', { hardness: 5, density: 0.9, span: 16, porous: 0.3, yields: M.ORGANIC, color: [132, 100, 70] }),
  def(M.MUD, 'mud', 'грязь', { hardness: 0.9, density: 1.9, span: 1, porous: 0.3, yields: M.LOOSE, buildable: true, climbable: true, color: [78, 58, 40] }),
  def(M.METAL, 'metal', 'металл', { hardness: T, density: 7.8, span: 999, climbable: false, color: [150, 158, 166] }),
  def(M.GLASS, 'glass', 'стекло', { hardness: T, density: 2.5, span: 60, climbable: false, color: [170, 200, 210] }),
  def(M.PLASTIC, 'plastic', 'пластик', { hardness: 40, density: 1.0, span: 60, climbable: false, yields: M.PLASTIC, color: [200, 70, 60] }),
  def(M.PAPER, 'paper', 'бумага', { hardness: 2, density: 0.5, span: 20, porous: 0.8, yields: M.PAPER, buildable: true, organic: true, color: [222, 214, 196] }),
  def(M.FABRIC, 'fabric', 'ткань', { hardness: 4, density: 0.4, span: 40, porous: 0.7, yields: M.FABRIC, color: [80, 90, 150] }),
  def(M.CONCRETE, 'concrete', 'бетон', { hardness: T, density: 2.4, span: 80, color: [140, 138, 132] }),
  def(M.BRICK, 'brick', 'кирпич', { hardness: T, density: 2.0, span: 60, color: [150, 68, 50] }),
  def(M.ASPHALT, 'asphalt', 'асфальт', { hardness: T, density: 2.3, span: 60, color: [52, 52, 56] }),
  def(M.ORGANIC, 'organic', 'органика', { hardness: 0.7, density: 0.8, span: 2, porous: 0.6, yields: M.ORGANIC, organic: true, buildable: true, color: [70, 52, 30] }),
  def(M.LOOSE, 'loose', 'рыхлая земля', { hardness: 0.35, density: 1.3, span: 0, granular: true, porous: 0.7, yields: M.LOOSE, buildable: true, color: [120, 88, 58] }),
  def(M.BUILT, 'built', 'уложенная земля', { hardness: 1.2, density: 1.4, span: 3, porous: 0.4, yields: M.LOOSE, buildable: true, color: [128, 94, 62] }),
  def(M.NESTWALL, 'nestwall', 'укреплённая стена', { hardness: 5, density: 1.8, span: 11, porous: 0.05, yields: M.LOOSE, color: [142, 102, 70] }),
  def(M.WEB, 'web', 'паутина', { solid: false, hardness: 0.4, density: 0.01, span: 0, climbable: false, yields: M.AIR, color: [230, 230, 235] }),
  def(M.STEM, 'stem', 'стебель', { hardness: 1.4, density: 0.4, span: 30, porous: 0.2, yields: M.LEAF, organic: true, color: [96, 140, 60] }),
  def(M.GRAVEL, 'gravel', 'гравий', { hardness: 2.5, density: 2.0, span: 0, granular: true, porous: 0.6, yields: M.GRAVEL, color: [128, 124, 118] }),
  def(M.TOPSOIL, 'topsoil', 'гумус', { hardness: 1.2, density: 1.2, span: 3, porous: 0.7, yields: M.LOOSE, buildable: true, color: [74, 54, 36] }),
  def(M.FLOWER, 'flower', 'цветок', { hardness: 0.4, density: 0.1, span: 30, porous: 0.2, yields: M.LEAF, organic: true, color: [236, 196, 48] }),
  def(M.BLOSSOM, 'blossom', 'цветы сакуры', { hardness: 0.3, density: 0.1, span: 30, porous: 0.2, yields: M.LEAF, organic: true, color: [246, 176, 200] }),
];

// Быстрые таблицы для горячих циклов.
export const IS_SOLID = new Uint8Array(MATERIAL_COUNT);
export const IS_GRANULAR = new Uint8Array(MATERIAL_COUNT);
export const IS_CLIMBABLE = new Uint8Array(MATERIAL_COUNT);
export const IS_DIGGABLE = new Uint8Array(MATERIAL_COUNT);
export const SPAN = new Uint16Array(MATERIAL_COUNT);
export const HARDNESS = new Float32Array(MATERIAL_COUNT);
export const POROUS = new Float32Array(MATERIAL_COUNT);
/** Листва: для муравьёв проходима насквозь (медленно), но за неё можно держаться. */
export const IS_FOLIAGE = new Uint8Array(MATERIAL_COUNT);
IS_FOLIAGE[27] = 1; // FLOWER
IS_FOLIAGE[7] = 1; // LEAF
IS_FOLIAGE[8] = 1; // GRASS
IS_FOLIAGE[28] = 1; // BLOSSOM
for (const m of MATERIALS) {
  IS_SOLID[m.id] = m.solid ? 1 : 0;
  IS_GRANULAR[m.id] = m.granular ? 1 : 0;
  IS_CLIMBABLE[m.id] = m.solid && m.climbable ? 1 : 0;
  IS_DIGGABLE[m.id] = (m.solid || m.id === M.WEB) && Number.isFinite(m.hardness) ? 1 : 0;
  SPAN[m.id] = Math.min(m.span, 65535);
  HARDNESS[m.id] = m.hardness;
  POROUS[m.id] = m.porous;
}

export function matName(id: number): string {
  return MATERIALS[id]?.name ?? '?';
}
