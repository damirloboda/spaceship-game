/** Виды еды. Еда — физический объект мира: масса, размер, питательность, запах, свежесть. */
export const FK = {
  CRUMB: 0,
  SEED: 1,
  BERRY: 2,
  FRUIT: 3,
  COOKIE: 4,
  BREAD: 5,
  SUGAR: 6,
  MEAT: 7,
  INSECT: 8,
  MUSHROOM: 9,
  LEAF: 10, // кусочек листа — ресурс для грибной фермы
  LEFTOVER: 11,
  HUMAN: 12,
  TWIG: 13, // веточка — строительный ресурс
  PETAL: 14, // лепесток сакуры — ресурс грибной фермы
} as const;

export interface FoodKindDef {
  id: number;
  name: string;
  /** питательность на единицу массы */
  nutrition: number;
  /** радиус (клеток) при массе baseMass */
  baseR: number;
  baseMass: number;
  /** сек до полной порчи (Infinity — не портится) */
  spoil: number;
  /** плотность относительно воды (<1 плавает) */
  density: number;
  /** сила запаха (радиус обнаружения, клеток) */
  scent: number;
  /** строительный/фермерский ресурс, а не еда */
  resource: boolean;
  color: [number, number, number];
  /** форма для рендера: 0 круг, 1 зерно, 2 диск/печенье, 3 ломоть, 4 насекомое, 5 гриб, 6 лист, 7 кристалл, 8 веточка */
  shape: number;
}

export const FOOD_KINDS: FoodKindDef[] = [
  { id: 0, name: 'крошка', nutrition: 1.0, baseR: 0.45, baseMass: 1, spoil: 900, density: 0.6, scent: 10, resource: false, color: [214, 168, 96], shape: 3 },
  { id: 1, name: 'семя', nutrition: 1.3, baseR: 0.45, baseMass: 1.5, spoil: Infinity, density: 0.9, scent: 7, resource: false, color: [150, 118, 70], shape: 1 },
  { id: 2, name: 'ягода', nutrition: 0.9, baseR: 1.4, baseMass: 8, spoil: 600, density: 0.95, scent: 22, resource: false, color: [168, 30, 60], shape: 0 },
  { id: 3, name: 'огрызок яблока', nutrition: 0.8, baseR: 4.5, baseMass: 60, spoil: 1400, density: 0.8, scent: 40, resource: false, color: [226, 212, 150], shape: 0 },
  { id: 4, name: 'печенье', nutrition: 1.7, baseR: 7, baseMass: 200, spoil: Infinity, density: 0.7, scent: 50, resource: false, color: [196, 140, 72], shape: 2 },
  { id: 5, name: 'хлеб', nutrition: 1.2, baseR: 6, baseMass: 120, spoil: 2400, density: 0.4, scent: 40, resource: false, color: [210, 160, 96], shape: 3 },
  { id: 6, name: 'сахар', nutrition: 3.0, baseR: 0.35, baseMass: 0.6, spoil: Infinity, density: 1.5, scent: 14, resource: false, color: [250, 250, 250], shape: 7 },
  { id: 7, name: 'мясо', nutrition: 1.8, baseR: 2.5, baseMass: 30, spoil: 500, density: 1.05, scent: 45, resource: false, color: [170, 60, 60], shape: 3 },
  { id: 8, name: 'насекомое', nutrition: 1.5, baseR: 2.2, baseMass: 20, spoil: 700, density: 0.9, scent: 30, resource: false, color: [60, 46, 40], shape: 4 },
  { id: 9, name: 'гриб', nutrition: 1.0, baseR: 2.2, baseMass: 14, spoil: 800, density: 0.6, scent: 18, resource: false, color: [220, 200, 170], shape: 5 },
  { id: 10, name: 'лист', nutrition: 0.25, baseR: 0.6, baseMass: 1, spoil: 1200, density: 0.3, scent: 5, resource: true, color: [84, 142, 58], shape: 6 },
  { id: 11, name: 'остатки еды', nutrition: 1.0, baseR: 4, baseMass: 60, spoil: 1100, density: 0.9, scent: 45, resource: false, color: [176, 132, 90], shape: 3 },
  { id: 12, name: 'чипсы', nutrition: 1.4, baseR: 3.5, baseMass: 40, spoil: Infinity, density: 0.3, scent: 45, resource: false, color: [236, 196, 90], shape: 2 },
  { id: 13, name: 'веточка', nutrition: 0, baseR: 0.9, baseMass: 1.2, spoil: Infinity, density: 0.6, scent: 3, resource: true, color: [120, 86, 52], shape: 8 },
  { id: 14, name: 'лепесток сакуры', nutrition: 0.2, baseR: 0.55, baseMass: 0.5, spoil: 900, density: 0.2, scent: 6, resource: true, color: [248, 186, 208], shape: 6 },
];

export function foodRadius(kind: number, mass: number): number {
  const k = FOOD_KINDS[kind];
  return Math.max(0.3, k.baseR * Math.sqrt(Math.max(0.05, mass) / k.baseMass));
}
