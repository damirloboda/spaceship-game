/**
 * Inventory (§63, §64).
 *
 * Four separate stores — what you carry, what the ship holds, what a base
 * stockpiles, and what an expedition has packed — because the interesting
 * decisions happen at the boundaries between them.
 */
import { COMMODITIES } from '../sim/economy.js';

/** Non-tradeable equipment and consumables. */
export const ITEMS = {
  repair_part:  { label: 'Repair Part',      mass: 4,   stack: 50 },
  medkit:       { label: 'Medkit',           mass: 1.2, stack: 20, heals: 45 },
  ration:       { label: 'Field Ration',     mass: 0.6, stack: 40 },
  oxygen_cell:  { label: 'Oxygen Cell',      mass: 2.5, stack: 20, oxygen: 60 },
  jet_fuel:     { label: 'Jet Fuel Canister',mass: 5,   stack: 20, jetFuel: 30 },
  nitro_charge: { label: 'Overdrive Charge', mass: 8,   stack: 10 },
  scan_probe:   { label: 'Survey Probe',     mass: 3,   stack: 20 },
  base_kit:     { label: 'Habitat Kit',      mass: 90,  stack: 6 },
  drone:        { label: 'Utility Drone',    mass: 30,  stack: 6 },
  sample_vial:  { label: 'Sample Vial',      mass: 0.3, stack: 60 },
  artifact_frag:{ label: 'Artifact Fragment',mass: 6,   stack: 20 },
};

/** Mass of one unit of anything tradeable or carryable. */
export function unitMass(id) {
  if (ITEMS[id]) return ITEMS[id].mass;
  if (COMMODITIES[id]) return COMMODITIES[id].raw ? 8 : 5;
  return 1;
}

export function itemLabel(id) {
  return (ITEMS[id] && ITEMS[id].label) || (COMMODITIES[id] && COMMODITIES[id].label) || id;
}

export class Container {
  /**
   * @param {string} kind 'personal' | 'ship' | 'base' | 'expedition'
   * @param {number} capacity in mass units (kg-equivalent)
   */
  constructor(kind, capacity) {
    this.kind = kind;
    this.capacity = capacity;
    this.slots = {};              // id -> qty
  }

  get usedMass() {
    let m = 0;
    for (const [id, qty] of Object.entries(this.slots)) m += unitMass(id) * qty;
    return m;
  }

  get freeMass() {
    return Math.max(0, this.capacity - this.usedMass);
  }

  get full() {
    return this.freeMass <= 0.001;
  }

  count(id) {
    return this.slots[id] || 0;
  }

  /** Add up to `qty`; returns how many actually fit. */
  add(id, qty = 1) {
    if (qty <= 0) return 0;
    const per = unitMass(id);
    const canFit = per > 0 ? Math.floor(this.freeMass / per) : qty;
    const added = Math.max(0, Math.min(qty, canFit));
    if (added > 0) this.slots[id] = (this.slots[id] || 0) + added;
    return added;
  }

  /** Remove up to `qty`; returns how many were actually removed. */
  remove(id, qty = 1) {
    const have = this.slots[id] || 0;
    const taken = Math.min(have, qty);
    if (taken > 0) {
      this.slots[id] = have - taken;
      if (this.slots[id] <= 0) delete this.slots[id];
    }
    return taken;
  }

  has(id, qty = 1) {
    return (this.slots[id] || 0) >= qty;
  }

  /** Move items to another container; returns how many moved. */
  transferTo(other, id, qty = 1) {
    const available = Math.min(qty, this.count(id));
    if (available <= 0) return 0;
    const accepted = other.add(id, available);
    this.remove(id, accepted);
    return accepted;
  }

  list() {
    return Object.entries(this.slots)
      .map(([id, qty]) => ({ id, qty, label: itemLabel(id), mass: +(unitMass(id) * qty).toFixed(1) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  save() { return { kind: this.kind, capacity: this.capacity, slots: this.slots }; }

  load(d) {
    if (!d) return;
    this.capacity = d.capacity ?? this.capacity;
    this.slots = d.slots || {};
  }
}

/**
 * Expedition readiness check (§64). Reports exactly what is missing rather
 * than a yes/no, because the interesting part is the shopping list.
 */
export const EXPEDITION_REQUIREMENTS = [
  { id: 'fuel',        key: 'shipFuel',   label: 'Fuel',      min: 0.6, kind: 'ratio' },
  { id: 'water',       key: 'water',      label: 'Water',     min: 20 },
  { id: 'food',        key: 'food',       label: 'Food',      min: 20 },
  { id: 'repair_part', key: 'repair_part',label: 'Repair',    min: 6 },
  { id: 'medkit',      key: 'medkit',     label: 'Medical',   min: 3 },
  { id: 'nitro',       key: 'nitro',      label: 'Nitro',     min: 1, kind: 'installed' },
  { id: 'jet_fuel',    key: 'jet_fuel',   label: 'Jet Fuel',  min: 4 },
  { id: 'energy',      key: 'energy',     label: 'Energy',    min: 10 },
  { id: 'cargo',       key: 'cargoFree',  label: 'Cargo',     min: 0.15, kind: 'ratio' },
];

/**
 * @param {object} ctx {ship, shipCargo, personal}
 * @returns {{ready:boolean, items:Array}}
 */
export function expeditionCheck(ctx) {
  const { ship, shipCargo, personal } = ctx;
  const items = [];

  for (const req of EXPEDITION_REQUIREMENTS) {
    let have = 0, ok = false, display = '';

    if (req.kind === 'ratio') {
      if (req.key === 'shipFuel') {
        have = ship.fuelCapacity > 0 ? ship.fuel / ship.fuelCapacity : 0;
      } else {
        have = ship.stats.cargo > 0 ? shipCargo.freeMass / shipCargo.capacity : 0;
      }
      ok = have >= req.min;
      display = `${Math.round(have * 100)}%`;
    } else if (req.kind === 'installed') {
      have = ship.nitro.part ? 1 : 0;
      ok = have >= req.min;
      display = ship.nitro.part ? 'INSTALLED' : 'NOT INSTALLED';
    } else {
      have = (shipCargo.count(req.key) || 0) + (personal.count(req.key) || 0);
      ok = have >= req.min;
      display = `${have}/${req.min}`;
    }

    items.push({ id: req.id, label: req.label, ok, have, need: req.min, display });
  }

  return { ready: items.every((i) => i.ok), items };
}
