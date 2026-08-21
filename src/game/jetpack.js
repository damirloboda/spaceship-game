/**
 * Jetpack (§28).
 *
 * A real thruster, not an animation: it produces a force, burns fuel to do it,
 * builds heat, and cuts out when it overheats or runs dry. Whether it can lift
 * you at all depends on the planet's gravity and your loaded mass, so the same
 * pack that flies on a moon barely hops on a heavy world — that's the point.
 */

export const JETPACK_MODELS = {
  none: null,
  civilian: {
    id: 'civilian', label: 'Civilian Lift Pack',
    // Thrust is tuned by thrust-to-weight, not by feel: ~1.4 TWR for a 85 kg
    // pilot at 1g. Enough to hover and climb deliberately; not enough to
    // become a cannon. Low-gravity worlds then feel genuinely different.
    thrust: 1500,          // newtons at full throttle
    fuelCapacity: 60,      // units
    burnRate: 3.4,         // units/sec at full throttle
    mass: 22,              // kg (counts against your own lift)
    // Heat is deliberately the binding constraint on a sustained climb and
    // fuel the constraint across a whole excursion. If a tank outlasts the
    // heat budget the overheat system never fires and stops being a mechanic.
    coolRate: 0.16,        // heat/sec while idle
    heatRate: 0.08,        // heat/sec at full throttle
    price: 12000,
  },
  survey: {
    id: 'survey', label: 'Survey Pack S-2',
    thrust: 2400, fuelCapacity: 110, burnRate: 4.1, mass: 28,
    coolRate: 0.22, heatRate: 0.045, price: 34000,
  },
  heavy: {
    id: 'heavy', label: 'Heavy Lift Rig',
    thrust: 4300, fuelCapacity: 180, burnRate: 7.6, mass: 46,
    coolRate: 0.18, heatRate: 0.06, price: 96000,
  },
  // Rare tech (§70): salvaged from precursor sites, not sold anywhere.
  precursor: {
    id: 'precursor', label: 'Vault-Pattern Ascender',
    thrust: 7200, fuelCapacity: 240, burnRate: 4.4, mass: 19,
    coolRate: 0.4, heatRate: 0.028, price: 0, rare: true,
  },
};

export const JETPACK_UPGRADES = {
  tank_1:    { label: 'Extended Tank I',  fuelCapacity: 1.35, price: 6000 },
  tank_2:    { label: 'Extended Tank II', fuelCapacity: 1.6,  price: 18000 },
  thrust_1:  { label: 'Injector Tune',    thrust: 1.25,       price: 9000 },
  thrust_2:  { label: 'Overpressure Kit', thrust: 1.5, heatRate: 1.3, price: 26000 },
  cooling_1: { label: 'Heat Sink Array',  coolRate: 1.5, heatRate: 0.8, price: 11000 },
  efficiency:{ label: 'Flow Regulator',   burnRate: 0.72,     price: 21000 },
};

export class Jetpack {
  constructor(modelId = 'none', upgrades = []) {
    this.setModel(modelId, upgrades);
    this.fuel = this.stats ? this.stats.fuelCapacity : 0;
    this.heat = 0;
    this.overheated = false;
    this.active = false;
    this.throttle = 0;
  }

  setModel(modelId, upgrades = []) {
    this.modelId = modelId;
    this.upgrades = [...upgrades];
    const base = JETPACK_MODELS[modelId];
    if (!base) {
      this.stats = null;
      this.fuel = 0;
      return;
    }
    // Upgrades are multiplicative on the base model's stats.
    const s = { ...base };
    for (const u of this.upgrades) {
      const up = JETPACK_UPGRADES[u];
      if (!up) continue;
      for (const k of ['thrust', 'fuelCapacity', 'burnRate', 'coolRate', 'heatRate', 'mass']) {
        if (up[k]) s[k] *= up[k];
      }
    }
    this.stats = s;
    if (this.fuel !== undefined) this.fuel = Math.min(this.fuel, s.fuelCapacity);
  }

  get installed() {
    return !!this.stats;
  }

  get fuelFraction() {
    return this.stats ? this.fuel / this.stats.fuelCapacity : 0;
  }

  addUpgrade(id) {
    if (!JETPACK_UPGRADES[id] || this.upgrades.includes(id)) return false;
    this.upgrades.push(id);
    this.setModel(this.modelId, this.upgrades);
    return true;
  }

  refuel(units = Infinity) {
    if (!this.stats) return 0;
    const before = this.fuel;
    this.fuel = Math.min(this.stats.fuelCapacity, this.fuel + units);
    return this.fuel - before;
  }

  /** Can this pack lift `massKg` against `gravity`? Used by the HUD warning. */
  canLift(massKg, gravity) {
    if (!this.stats) return false;
    return this.stats.thrust > (massKg + this.stats.mass) * gravity;
  }

  /** Thrust-to-weight ratio, the number that actually decides how it feels. */
  twr(massKg, gravity) {
    if (!this.stats || gravity <= 0) return Infinity;
    return this.stats.thrust / ((massKg + this.stats.mass) * gravity);
  }

  /**
   * Step the jetpack.
   * @param {number} dt seconds
   * @param {number} throttle 0..1 requested
   * @returns {number} thrust in newtons actually produced this step
   */
  update(dt, throttle) {
    if (!this.stats) { this.active = false; return 0; }
    const s = this.stats;

    let t = Math.max(0, Math.min(1, throttle || 0));
    if (this.fuel <= 0 || this.overheated) t = 0;

    if (t > 0) {
      const burn = s.burnRate * t * dt;
      if (burn > this.fuel) {
        // Partial burn on the last drops rather than a hard cutoff.
        t *= this.fuel / burn;
        this.fuel = 0;
      } else {
        this.fuel -= burn;
      }
      this.heat = Math.min(1.2, this.heat + s.heatRate * t * dt);
      if (this.heat >= 1) this.overheated = true;
    } else {
      this.heat = Math.max(0, this.heat - s.coolRate * dt);
      // Hysteresis: you have to actually cool down, not just tap off.
      if (this.overheated && this.heat < 0.55) this.overheated = false;
    }

    this.throttle = t;
    this.active = t > 0.01;
    return s.thrust * t;
  }

  save() {
    return { m: this.modelId, u: this.upgrades, f: this.fuel, h: this.heat, o: this.overheated };
  }

  load(d) {
    if (!d) return;
    this.setModel(d.m || 'none', d.u || []);
    this.fuel = d.f ?? 0;
    this.heat = d.h ?? 0;
    this.overheated = !!d.o;
  }
}
