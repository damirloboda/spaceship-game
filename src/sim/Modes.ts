/** Режимы игры — не отдельные "игры", а наборы параметров одной и той же симуляции. */
export interface ModeConfig {
  key: string;
  name: string;
  desc: string;
  startAnts: number;
  startFood: number;
  startLevel: number;
  predators: number;
  foodMul: number;
  eggRate: number;
  creative: boolean;
  survival: boolean;
  fog: boolean;
  chasm: boolean;
  worldW: number;
  worldH: number;
  rival: boolean;
  goal?: string;
  /** собственный бюджет агентов режима (остальные — жители и потоки) */
  agentCap?: number;
  /** тема мира */
  theme?: 'garden' | 'sakura';
}

export const MODES: ModeConfig[] = [
  { key: 'sandbox', name: 'Песочница', desc: 'Основной режим: 10 муравьёв, живой мир, никакой спешки.', startAnts: 10, startFood: 40, startLevel: 1, predators: 1, foodMul: 1, eggRate: 1, creative: false, survival: false, fog: true, chasm: false, worldW: 2048, worldH: 768, rival: true },
  { key: 'sakura', name: 'Сакуровый сад', desc: 'Мирный японский сад: аллея сакур, пруд, каменные фонари, метель лепестков. Лучше всего с графикой «Максимальная».', startAnts: 40, startFood: 200, startLevel: 2, predators: 0.3, foodMul: 1.4, eggRate: 1.2, creative: false, survival: false, fog: false, chasm: false, worldW: 2048, worldH: 768, rival: false, theme: 'sakura' },
  { key: 'survival', name: 'Выживание', desc: 'Больше хищников, меньше еды. Колония может погибнуть.', startAnts: 10, startFood: 20, startLevel: 1, predators: 1.8, foodMul: 0.6, eggRate: 0.9, creative: false, survival: true, fog: true, chasm: false, worldW: 2048, worldH: 768, rival: true },
  { key: 'challenge', name: 'Испытание: Пропасть', desc: 'Огромная пропасть и 30 000 муравьёв. Проведите линию через неё — и смотрите.', agentCap: 2500, startAnts: 30000, startFood: 15000, startLevel: 6, predators: 0.3, foodMul: 1, eggRate: 1, creative: false, survival: false, fog: false, chasm: true, worldW: 1280, worldH: 640, rival: false, goal: 'Перебросьте живой мост через пропасть и доставьте 400 еды.' },
  { key: 'colony', name: 'Колония', desc: 'Упор на строительство гнезда: больше еды, меньше угроз.', startAnts: 60, startFood: 300, startLevel: 3, predators: 0.4, foodMul: 1.5, eggRate: 1.3, creative: false, survival: false, fog: true, chasm: false, worldW: 2048, worldH: 768, rival: true },
  { key: 'exploration', name: 'Исследование', desc: 'Широкий мир в тумане. Разведчики и маршруты.', startAnts: 30, startFood: 120, startLevel: 2, predators: 0.8, foodMul: 1, eggRate: 1, creative: false, survival: false, fog: true, chasm: false, worldW: 3072, worldH: 768, rival: true },
  { key: 'creative', name: 'Творчество', desc: 'Неограниченные ресурсы, все уровни, инструменты мира.', startAnts: 200, startFood: 5000, startLevel: 10, predators: 0.5, foodMul: 2, eggRate: 3, creative: true, survival: false, fog: false, chasm: false, worldW: 2048, worldH: 768, rival: true },
];

export function modeByKey(k: string): ModeConfig {
  return MODES.find((m) => m.key === k) ?? MODES[0];
}
