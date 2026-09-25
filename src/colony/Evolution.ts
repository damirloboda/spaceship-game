/**
 * Эволюция колонии: опыт копится от реальных дел (доставленная еда, раскопки,
 * постройки, мосты, победы, разведка, рост) и открывает новые возможности.
 */
export const LEVEL_XP = [0, 120, 450, 1300, 3500, 9000, 22000, 55000, 140000, 360000];

export const LEVEL_TITLES = [
  'Простые рабочие',
  'Эффективная транспортировка',
  'Сложные тоннели',
  'Солдаты',
  'Фермы',
  'Продвинутое строительство',
  'Специализированные касты',
  'Огромные колонии',
  'Контроль территории',
  'Городская экспансия',
];

export const LEVEL_UNLOCKS = [
  'Рабочие и разведчики. Живые мосты до 48 клеток.',
  'Каста носильщиков, перенос тяжестей быстрее на 25%.',
  'Каста строителей, укрепление сводов, большие комнаты.',
  'Каста солдат, казармы, отряды обороны.',
  'Грибные фермы: листья превращаются в еду.',
  'Мосты до 110 клеток, лестницы и башни до 140, уплотнение мостов.',
  'Бонусы каст: разведчики быстрее, носильщики сильнее. Лаборатория.',
  'Вторая матка, потоковая симуляция муравьёв, бюджет агентов x2.',
  'Форпосты: сброс еды в ближайшем хранилище, контроль территории.',
  'Мосты до 220 клеток, выход в город.',
];

export class Evolution {
  level = 1;
  xp = 0;
  onLevelUp: ((level: number) => void) | null = null;

  add(v: number): void {
    this.xp += v;
    while (this.level < 10 && this.xp >= LEVEL_XP[this.level]) {
      this.level++;
      this.onLevelUp?.(this.level);
    }
  }

  progress(): number {
    if (this.level >= 10) return 1;
    const a = LEVEL_XP[this.level - 1];
    const b = LEVEL_XP[this.level];
    return (this.xp - a) / (b - a);
  }

  bridgeSpan(): number {
    if (this.level >= 10) return 220;
    if (this.level >= 6) return 110;
    return 48 + (this.level - 1) * 8;
  }

  towerHeight(): number {
    if (this.level >= 6) return 140;
    return 26 + (this.level - 1) * 10;
  }

  carryBonus(): number {
    return this.level >= 2 ? (this.level >= 7 ? 1.6 : 1.25) : 1;
  }

  queens(): number {
    return this.level >= 8 ? 2 : 1;
  }

  maxRoomWidth(): number {
    return this.level >= 3 ? 26 : 12;
  }

  has(feature: 'carrier' | 'builder' | 'soldier' | 'farm' | 'thick' | 'lab' | 'streams' | 'outpost'): boolean {
    const need = { carrier: 2, builder: 3, soldier: 4, farm: 5, thick: 6, lab: 7, streams: 8, outpost: 9 }[feature];
    return this.level >= need;
  }
}
