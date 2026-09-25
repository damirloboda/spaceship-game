/** Касты. Каста — не "класс юнита", а набор порогов реакции и физических параметров. */
export const C = {
  WORKER: 0,
  SOLDIER: 1,
  SCOUT: 2,
  BUILDER: 3,
  CARRIER: 4,
  QUEEN: 5,
} as const;
export const CASTE_COUNT = 6;

/** Категории работы колонии (соответствуют приоритетам игрока). */
export const T = {
  FOOD: 0,
  BUILD: 1,
  DEFENSE: 2,
  EXPLORE: 3,
  RESOURCE: 4,
} as const;
export const TASK_COUNT = 5;
export const TASK_NAMES = ['Еда', 'Стройка', 'Оборона', 'Разведка', 'Ресурсы'];

export interface CasteDef {
  id: number;
  name: string;
  speed: number;
  strength: number;
  attack: number;
  hp: number;
  size: number;
  sense: number;
  dig: number;
  build: number;
  /** базовые пороги реакции по категориям (ниже — охотнее берётся) */
  thresholds: [number, number, number, number, number];
  /** уровень колонии, открывающий касту */
  unlock: number;
  color: [number, number, number];
}

export const CASTES: CasteDef[] = [
  { id: 0, name: 'Рабочий', speed: 5.2, strength: 1, attack: 1.6, hp: 10, size: 1.0, sense: 7, dig: 1, build: 1, thresholds: [0.25, 0.45, 0.9, 0.6, 0.5], unlock: 1, color: [44, 30, 24] },
  { id: 1, name: 'Солдат', speed: 4.6, strength: 1.6, attack: 7, hp: 34, size: 1.4, sense: 8, dig: 0.5, build: 0.3, thresholds: [0.9, 0.95, 0.12, 0.8, 0.95], unlock: 4, color: [70, 30, 20] },
  { id: 2, name: 'Разведчик', speed: 7.4, strength: 0.6, attack: 1.2, hp: 8, size: 0.88, sense: 14, dig: 0.3, build: 0.2, thresholds: [0.55, 0.95, 0.8, 0.1, 0.7], unlock: 1, color: [60, 44, 26] },
  { id: 3, name: 'Строитель', speed: 4.8, strength: 1.3, attack: 1.4, hp: 13, size: 1.05, sense: 7, dig: 1.6, build: 2.2, thresholds: [0.8, 0.12, 0.9, 0.9, 0.4], unlock: 3, color: [52, 36, 30] },
  { id: 4, name: 'Носильщик', speed: 4.3, strength: 4, attack: 2, hp: 18, size: 1.3, sense: 6, dig: 0.7, build: 0.6, thresholds: [0.15, 0.8, 0.8, 0.95, 0.35], unlock: 2, color: [58, 36, 22] },
  { id: 5, name: 'Матка', speed: 0.6, strength: 2, attack: 3, hp: 80, size: 2.6, sense: 4, dig: 0, build: 0, thresholds: [1, 1, 1, 1, 1], unlock: 1, color: [80, 44, 26] },
];
