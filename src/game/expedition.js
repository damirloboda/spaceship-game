// Expedition readiness check shown before long Lightbreak jumps.
export const EXPEDITION_REQUIREMENTS = [
  { key: 'fuel', need: 25, get: (s) => s.ship.fuel, critical: true },
  { key: 'water', need: 2, get: (s) => s.count('water') },
  { key: 'food', need: 2, get: (s) => s.count('ration') },
  { key: 'repair', need: 1, get: (s) => s.count('repair_kit') },
  { key: 'medical', need: 1, get: (s) => s.count('medkit') },
  { key: 'nitro', need: 1, get: (s) => (s.ship.nitro.installed ? 1 : 0), critical: true },
  { key: 'jetfuel', need: 1, get: (s) => s.count('jet_fuel') + (s.jetpack.owned && s.jetpack.fuel > 30 ? 1 : 0) },
  { key: 'energy', need: 1, get: (s) => s.count('energy_cell') + (s.ship.energy ? 1 : 0) },
  { key: 'cargo', need: 2, get: (s) => s.cargoFree },
];

// source: { ship: ShipSystems, jetpack, count(id), cargoFree }
export function checkExpedition(source, fuelNeeded = 25) {
  const rows = EXPEDITION_REQUIREMENTS.map((r) => {
    const need = r.key === 'fuel' ? fuelNeeded : r.need;
    const have = r.get(source);
    return { key: r.key, have, need, ok: have >= need, critical: !!r.critical };
  });
  const ready = rows.every((r) => r.ok);
  const blocked = rows.some((r) => r.critical && !r.ok);
  return { rows, ready, blocked };
}
