// Local markets. Prices float with supply and demand: selling floods the
// market, buying drains it, and both recover over time. Events (storms,
// wars, discoveries) push the modifiers around.
import { itemDef } from './items.js';
import { RNG } from '../core/rng.js';

export class Market {
  constructor(id, seed, profile = {}) {
    this.id = id;
    this.rng = new RNG(seed);
    this.stock = {};
    this.profile = profile; // { itemId: multiplier } local specialties
    this.eventMod = 1;
  }

  entry(item) {
    if (!this.stock[item]) {
      this.stock[item] = { pressure: 0, bias: this.profile[item] ?? this.rng.range(0.85, 1.2) };
    }
    return this.stock[item];
  }

  // side: 'buy' (player buys) or 'sell' (player sells). repDiscount 0..0.2
  price(item, side = 'buy', repDiscount = 0) {
    const base = itemDef(item).price;
    if (!base) return 0;
    const e = this.entry(item);
    const mod = e.bias * this.eventMod * (1 + e.pressure);
    const p = side === 'buy' ? base * mod * 1.15 * (1 - repDiscount) : base * mod * 0.8 * (1 + repDiscount * 0.5);
    return Math.max(1, Math.round(p));
  }

  recordSale(item, n) {
    const e = this.entry(item);
    e.pressure = Math.max(-0.6, e.pressure - 0.012 * n);
  }

  recordPurchase(item, n) {
    const e = this.entry(item);
    e.pressure = Math.min(1.5, e.pressure + 0.02 * n);
  }

  update(dt) {
    for (const e of Object.values(this.stock)) {
      e.pressure *= Math.exp(-dt / 600);
    }
    this.eventMod += (1 - this.eventMod) * Math.min(1, dt / 900);
  }

  toJSON() {
    return { stock: this.stock, eventMod: this.eventMod };
  }

  load(d) {
    if (!d) return;
    if (d.stock) this.stock = d.stock;
    if (Number.isFinite(d.eventMod)) this.eventMod = d.eventMod;
  }
}

export const REPUTATION_TIERS = [
  { id: 'hostile', min: -Infinity },
  { id: 'neutral', min: -20 },
  { id: 'friendly', min: 15 },
  { id: 'trusted', min: 45 },
  { id: 'honored', min: 80 },
];

export function reputationTier(value) {
  let tier = REPUTATION_TIERS[0].id;
  for (const t of REPUTATION_TIERS) if (value >= t.min) tier = t.id;
  return tier;
}

export function reputationDiscount(value) {
  const tier = reputationTier(value);
  return { hostile: 0, neutral: 0, friendly: 0.05, trusted: 0.1, honored: 0.18 }[tier];
}
