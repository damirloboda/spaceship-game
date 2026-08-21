/**
 * Economy (§44, §45).
 *
 * Every market produces some goods and consumes others. Price follows local
 * stock against local demand, so hauling what a system lacks is genuinely
 * profitable and the profit decays as you saturate that market. Prices also
 * respond to war, disaster and ecosystem health, which is how the §1 chain
 * (ecosystem -> resources -> economy -> cities -> factions) actually closes.
 */
import { RNG, hashInts } from '../core/rng.js';
import { CIV_BY_ID } from '../gen/civ.js';
import { RESOURCES } from '../gen/planet.js';

/** Tradeable goods beyond raw resources. */
export const COMMODITIES = {
  // raw resources are merged in below
  food:      { label: 'Rations',            base: 12,   volatility: 0.35, essential: true },
  water:     { label: 'Water',              base: 6,    volatility: 0.3,  essential: true },
  fuel:      { label: 'Fuel Cells',         base: 28,   volatility: 0.4,  essential: true },
  jetfuel:   { label: 'Jet Fuel',           base: 34,   volatility: 0.35, essential: true },
  oxygen:    { label: 'Oxygen',             base: 15,   volatility: 0.3,  essential: true },
  medicine:  { label: 'Medical Supplies',   base: 65,   volatility: 0.45 },
  machinery: { label: 'Machinery',          base: 120,  volatility: 0.3 },
  alloys:    { label: 'Structural Alloys',  base: 85,   volatility: 0.3 },
  electronics:{ label: 'Electronics',       base: 180,  volatility: 0.35 },
  luxuries:  { label: 'Luxuries',           base: 240,  volatility: 0.55 },
  data:      { label: 'Survey Data',        base: 95,   volatility: 0.5 },
  artifacts: { label: 'Artifacts',          base: 900,  volatility: 0.8 },
  salvage:   { label: 'Salvage',            base: 45,   volatility: 0.5 },
  energy:    { label: 'Energy Cells',       base: 40,   volatility: 0.35 },
  gas:       { label: 'Refined Gas',        base: 55,   volatility: 0.4 },
  seeds:     { label: 'Seed Stock',         base: 70,   volatility: 0.4 },
};

// Raw resources are tradeable too.
for (const [id, r] of Object.entries(RESOURCES)) {
  COMMODITIES[id] = { label: r.label, base: r.baseValue, volatility: 0.3 + r.tier * 0.06, raw: true };
}

export const COMMODITY_IDS = Object.keys(COMMODITIES);

/** What a settlement of a given type produces and needs. */
const PRODUCTION_PROFILES = {
  mining:      { produces: ['ferrite', 'copper', 'titanium', 'silica', 'ore'], consumes: ['food', 'water', 'machinery', 'medicine'] },
  agricultural:{ produces: ['food', 'biomass', 'seeds'], consumes: ['machinery', 'electronics', 'fuel'] },
  industrial:  { produces: ['machinery', 'alloys', 'electronics'], consumes: ['ferrite', 'copper', 'energy', 'food'] },
  research:    { produces: ['data', 'medicine'], consumes: ['food', 'luxuries', 'electronics', 'energy'] },
  refinery:    { produces: ['fuel', 'jetfuel', 'energy', 'gas'], consumes: ['helium3', 'ore', 'machinery'] },
  trade:       { produces: ['luxuries'], consumes: ['food', 'water', 'fuel', 'machinery'] },
  frontier:    { produces: ['salvage'], consumes: ['food', 'water', 'fuel', 'medicine', 'machinery', 'oxygen'] },
};

const PROFILE_KEYS = Object.keys(PRODUCTION_PROFILES);

/**
 * A market at one station, city or base. Stock levels move each tick; prices
 * are always derived, never stored, so they can't drift out of sync.
 */
export class Market {
  constructor(id, seed, civId, opts = {}) {
    this.id = id;
    this.seed = seed;
    this.civ = civId;
    const rng = new RNG(hashInts(seed, 0x3A4));
    this.profile = opts.profile || rng.pick(PROFILE_KEYS);
    this.size = opts.size ?? rng.range(0.4, 1.6);       // scales stock + liquidity
    this.wealth = opts.wealth ?? rng.range(0.5, 1.5);

    const def = PRODUCTION_PROFILES[this.profile];
    this.produces = def.produces.filter((c) => COMMODITIES[c]);
    this.consumes = def.consumes.filter((c) => COMMODITIES[c]);

    /** Stock is expressed as a ratio of local normal supply (1 = normal). */
    this.stock = {};
    for (const id2 of COMMODITY_IDS) {
      let s = rng.range(0.7, 1.3);
      if (this.produces.includes(id2)) s *= rng.range(1.7, 3.2);
      if (this.consumes.includes(id2)) s *= rng.range(0.25, 0.6);
      this.stock[id2] = +s.toFixed(3);
    }

    this.modifiers = {};       // event-driven, e.g. { food: 0.4 } during famine
    this.lastTickDay = 0;
  }

  /** Unit price a player pays to buy. */
  buyPrice(commodityId, reputationMul = 1) {
    return Math.max(1, Math.round(this._price(commodityId) * 1.08 * reputationMul));
  }

  /** Unit price a player receives when selling. */
  sellPrice(commodityId, reputationMul = 1) {
    return Math.max(1, Math.round(this._price(commodityId) * 0.92 / Math.max(0.6, reputationMul)));
  }

  _price(commodityId) {
    const c = COMMODITIES[commodityId];
    if (!c) return 0;
    const stock = Math.max(0.05, (this.stock[commodityId] ?? 1) * (this.modifiers[commodityId] ?? 1));
    // Price responds inversely to stock, damped by the good's volatility.
    const scarcity = Math.pow(1 / stock, 0.6 + c.volatility * 0.8);
    const civ = CIV_BY_ID[this.civ];
    const bias = (civ && civ.economyBias && civ.economyBias[commodityId]) || 1;
    const wealth = 0.85 + this.wealth * 0.2;
    return c.base * Math.max(0.18, Math.min(6, scarcity)) * bias * wealth;
  }

  /** How many units this market can absorb before the price collapses. */
  liquidity(commodityId) {
    return Math.max(5, Math.round(60 * this.size * (COMMODITIES[commodityId]?.essential ? 2 : 1)));
  }

  /**
   * Execute a trade. Positive `qty` = player sells to market (stock rises),
   * negative = player buys (stock falls). Returns total credits moved.
   */
  trade(commodityId, qty, reputationMul = 1) {
    if (!COMMODITIES[commodityId] || qty === 0) return 0;
    const liq = this.liquidity(commodityId);
    let total = 0;
    const step = qty > 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(qty); i++) {
      total += step > 0 ? this.sellPrice(commodityId, reputationMul) : -this.buyPrice(commodityId, reputationMul);
      // Each unit moves the market a little; big dumps really do tank a price.
      this.stock[commodityId] = Math.max(0.02, (this.stock[commodityId] ?? 1) + step / liq);
    }
    return Math.round(total);
  }

  /**
   * Advance production and consumption. Stock drifts back toward the local
   * normal, so a market you drained recovers over days rather than instantly.
   */
  tick(days, ctx = {}) {
    if (days <= 0) return;
    const dt = Math.min(days, 3650);
    const health = ctx.ecosystemHealth ?? 1;
    for (const id of COMMODITY_IDS) {
      let target = 1;
      if (this.produces.includes(id)) target = 2.4;
      if (this.consumes.includes(id)) target = 0.42;
      // Biological goods track the local ecosystem's health.
      if ((id === 'food' || id === 'biomass' || id === 'seeds') && this.produces.includes(id)) {
        target *= 0.35 + health * 0.75;
      }
      if (ctx.war) target *= (id === 'medicine' || id === 'machinery' || id === 'alloys') ? 0.55 : 0.85;
      if (ctx.disaster) target *= 0.6;

      const cur = this.stock[id] ?? 1;
      this.stock[id] = cur + (target - cur) * Math.min(0.9, 0.06 * dt);
    }
  }

  save() {
    return { s: this.stock, m: this.modifiers, p: this.profile };
  }

  load(d) {
    if (!d) return;
    if (d.s) this.stock = d.s;
    if (d.m) this.modifiers = d.m;
    if (d.p) this.profile = d.p;
  }
}

/**
 * Best trade runs between two markets, for the route planner and for the
 * §45 dynamic trade routes NPC haulers fly.
 */
export function bestTrades(fromMarket, toMarket, cargoSpace = 100, credits = Infinity, repMul = 1) {
  const out = [];
  for (const id of COMMODITY_IDS) {
    const buy = fromMarket.buyPrice(id, repMul);
    const sell = toMarket.sellPrice(id, repMul);
    const margin = sell - buy;
    if (margin <= 0) continue;
    const affordable = Math.floor(credits / buy);
    const qty = Math.max(0, Math.min(cargoSpace, affordable, fromMarket.liquidity(id)));
    if (qty <= 0) continue;
    out.push({
      commodity: id,
      label: COMMODITIES[id].label,
      buy, sell,
      marginPerUnit: margin,
      qty,
      profit: margin * qty,
    });
  }
  return out.sort((a, b) => b.profit - a.profit);
}
