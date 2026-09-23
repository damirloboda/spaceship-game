// Item catalog. Names come from the localisation tables (item.<id>).
export const ITEMS = {
  ferrite: { cat: 'resource', stack: 250, price: 6, color: '#9aa3ad', glyph: 'Fe' },
  carbon: { cat: 'resource', stack: 250, price: 4, color: '#5b4a3a', glyph: 'C' },
  cobalt: { cat: 'resource', stack: 250, price: 18, color: '#4f8dff', glyph: 'Co' },
  oxyite: { cat: 'resource', stack: 250, price: 12, color: '#ff6b5b', glyph: 'O₂' },
  aurum: { cat: 'resource', stack: 100, price: 95, color: '#ffc94d', glyph: 'Au' },
  ice: { cat: 'resource', stack: 250, price: 5, color: '#bfe6ff', glyph: 'H₂O' },
  biosample: { cat: 'sample', stack: 50, price: 60, color: '#72e08a', glyph: 'Bio' },
  mineral_sample: { cat: 'sample', stack: 50, price: 45, color: '#c9a37a', glyph: 'Min' },
  precursor_shard: { cat: 'artifact', stack: 10, price: 0, color: '#c78bff', glyph: '◈' },
  jet_fuel: { cat: 'consumable', stack: 20, price: 40, color: '#ffa53d', glyph: 'JF' },
  fuel_cell: { cat: 'consumable', stack: 20, price: 120, color: '#ffdf5d', glyph: 'FC' },
  nitro: { cat: 'module', stack: 5, price: 900, color: '#39d0ff', glyph: 'N₂O' },
  nitro_cell: { cat: 'consumable', stack: 10, price: 150, color: '#7ce3ff', glyph: 'N+' },
  repair_kit: { cat: 'consumable', stack: 10, price: 110, color: '#b7ff6a', glyph: 'RK' },
  medkit: { cat: 'consumable', stack: 10, price: 80, color: '#ff5d8f', glyph: '+' },
  ration: { cat: 'consumable', stack: 30, price: 15, color: '#e8c38a', glyph: 'Fd' },
  water: { cat: 'consumable', stack: 30, price: 8, color: '#6ec6ff', glyph: 'W' },
  energy_cell: { cat: 'consumable', stack: 20, price: 55, color: '#f5ff6b', glyph: 'E' },
  base_kit: { cat: 'deployable', stack: 3, price: 600, color: '#d6d6d6', glyph: 'BK' },
  jetpack: { cat: 'equipment', stack: 1, price: 750, color: '#ff8a3d', glyph: 'JP' },
  jetpack_mk2: { cat: 'equipment', stack: 1, price: 2600, color: '#ff4f3d', glyph: 'JP2' },
  scanner_mk2: { cat: 'equipment', stack: 1, price: 1400, color: '#6bffda', glyph: 'SC2' },
  engine_mk2: { cat: 'shipmod', stack: 1, price: 3200, color: '#ff9d6b', glyph: 'EN2' },
  cargo_ext: { cat: 'shipmod', stack: 1, price: 1800, color: '#a38bff', glyph: 'CG+' },
  skimmer: { cat: 'vehicle', stack: 1, price: 1500, color: '#6bd6ff', glyph: 'SK' },
  drone_part: { cat: 'quest', stack: 5, price: 0, color: '#d0d0ff', glyph: 'DR' },
};

export function itemDef(id) {
  return ITEMS[id] || { cat: 'unknown', stack: 99, price: 1, color: '#888', glyph: '?' };
}
