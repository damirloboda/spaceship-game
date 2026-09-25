/** Масштабы/зоны мира. В вертикальном срезе — одна полоса: луг → сад → дом → улица. */
export const Z = {
  MEADOW: 0,
  GARDEN: 1,
  PATH: 2,
  HOUSE: 3,
  STREET: 4,
} as const;

export const ZONE_NAMES = ['Луг', 'Сад', 'Дорожка', 'Дом', 'Улица'];

export interface Zone {
  kind: number;
  x0: number;
  x1: number;
  indoor: boolean;
}

export function zoneAt(zones: Zone[], x: number): Zone | undefined {
  for (const z of zones) if (x >= z.x0 && x < z.x1) return z;
  return zones[zones.length - 1];
}
