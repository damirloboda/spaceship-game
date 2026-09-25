/** Виды существ экосистемы (кроме муравьёв — они в AntStore). */
export const CK = {
  SPIDER: 0,
  BEETLE: 1,
  WORM: 2,
  CATERPILLAR: 3,
  FLY: 4,
} as const;

export interface CreatureDef {
  id: number;
  name: string;
  hp: number;
  /** урон в секунду */
  attack: number;
  speed: number;
  radius: number;
  /** масса туши (становится едой) */
  mass: number;
  /** роль в экосистеме */
  role: 'predator' | 'thief' | 'digger' | 'prey' | 'nuisance';
  color: [number, number, number];
}

export const CREATURES: CreatureDef[] = [
  { id: 0, name: 'паук', hp: 120, attack: 9, speed: 7, radius: 2.4, mass: 24, role: 'predator', color: [40, 32, 30] },
  { id: 1, name: 'жук', hp: 160, attack: 4, speed: 3.2, radius: 2.8, mass: 30, role: 'thief', color: [30, 44, 40] },
  { id: 2, name: 'червь', hp: 70, attack: 0, speed: 1.2, radius: 1.4, mass: 18, role: 'digger', color: [196, 120, 118] },
  { id: 3, name: 'гусеница', hp: 40, attack: 0, speed: 0.8, radius: 1.6, mass: 14, role: 'prey', color: [120, 170, 70] },
  { id: 4, name: 'муха', hp: 12, attack: 0, speed: 14, radius: 1.2, mass: 3, role: 'nuisance', color: [40, 40, 50] },
];
