/**
 * Living ecosystem (§16).
 *
 * Species are arranged into trophic tiers and their populations run a
 * Lotka-Volterra-ish update. This matters because the player can perturb it:
 * hunt out the herbivores and the predators starve, then the vegetation booms
 * and the resource yields on that planet shift with it (§1's chain: ecosystem
 * -> resources -> economy).
 *
 * State is small (a few floats per species) so it saves cheaply per planet.
 */
import { generateFauna, generateFlora } from '../gen/creature.js';

const TIER = { photosynth: 0, filter: 1, herbivore: 1, omnivore: 2, scavenger: 2, carnivore: 3, apex: 4 };

export class Ecosystem {
  constructor(planet, saved = null) {
    this.planetSeed = planet.seed;
    this.planet = planet;
    this.species = generateFauna(planet);
    this.flora = generateFlora(planet);

    // Producer biomass, normalised: 1.0 is the world's natural carrying level.
    this.vegetation = 1.0;
    this.populations = {};
    for (const s of this.species) {
      const tier = TIER[s.diet] ?? 1;
      // Planet-wide populations, falling with trophic level and body mass.
      // These were an order of magnitude too small: an apex predator baseline
      // of 2 meant ordinary population noise counted as extinction.
      const base = 40000 / Math.pow(3, tier) / Math.max(1, Math.pow(s.mass, 0.25));
      this.populations[s.id] = Math.max(15, Math.round(base * (0.6 + s.herdSize / 40)));
    }
    this.baseline = { ...this.populations };

    /*
     * Prey biomass available to each tier when every species sits at its
     * baseline. Food availability is measured against *this*, so a freshly
     * generated world is in equilibrium by construction. Normalising against
     * the predator's own baseline instead (the previous approach) made food
     * supply essentially arbitrary and starved the predators off a third of
     * all worlds within 200 years, with no player involvement.
     */
    this.baselinePrey = {};
    for (let t = 1; t <= 4; t++) {
      this.baselinePrey[t] = this._preyMassFrom(this.baseline, t);
    }
    this.baseGrazing = this._grazingFrom(this.baseline);

    this.collapsed = [];
    if (saved) this.load(saved);
  }

  tier(species) {
    return TIER[species.diet] ?? 1;
  }

  /**
   * Edible weight of one animal.
   *
   * Raw body mass spans seven orders of magnitude on a single planet, so
   * weighting prey biomass by mass directly let one 2400-tonne grazer define
   * the entire food supply — and when its population wobbled, every tier above
   * it starved. Metabolic scaling (Kleiber's law, mass^0.25) compresses that
   * range to something a food web can actually balance on.
   */
  _weight(s) {
    return Math.pow(Math.max(0.1, s.mass), 0.25);
  }

  /**
   * Edible biomass available to tier `t`, from a given population map.
   * Predators prefer the tier directly below them but will eat further down
   * when that tier is missing — otherwise a world that generated a carnivore
   * and no omnivores would have a predator with nothing at all to hunt.
   */
  _preyMassFrom(pops, t) {
    for (let below = t - 1; below >= 1; below--) {
      let m = 0;
      for (const s of this.species) {
        if (this.tier(s) === below) m += (pops[s.id] || 0) * this._weight(s);
      }
      if (m > 0) return m;
    }
    return 0;
  }

  /** Edible biomass currently available to tier `t`. */
  preyMass(t) {
    return this._preyMassFrom(this.populations, t);
  }

  /** Total grazing demand on the vegetation layer, from a population map. */
  _grazingFrom(pops) {
    let g = 0;
    for (const s of this.species) {
      if (this.tier(s) <= 1) g += (pops[s.id] || 0) * this._weight(s) * s.metabolism;
    }
    return g;
  }

  /**
   * Advance the ecosystem by `days`.
   *
   * Integrated in small sub-steps: a single Euler step of a year is wildly
   * unstable and drove healthy species extinct on its own. Long absences are
   * capped in step count and use a coarser step, which is accurate enough for
   * "what happened while I was away" without burning a frame on it.
   */
  tick(days) {
    if (days <= 0 || !this.species.length) return;
    let remaining = Math.min(days, 36500);
    const step = remaining > 400 ? remaining / 200 : 2;   // days per sub-step
    let guard = 0;

    while (remaining > 0 && guard++ < 400) {
      const dt = Math.min(step, remaining);
      remaining -= dt;
      this._substep(dt);
    }
  }

  _substep(dt) {
    // Vegetation moves toward the level current grazing pressure can sustain.
    // Normalised against baseline grazing, so an untouched world sits at 1.0.
    const grazing = this._grazingFrom(this.populations);
    const capacity = this.baseGrazing > 0
      ? Math.max(0.05, Math.min(1.6, 1 + (this.baseGrazing - grazing) / (this.baseGrazing * 2)))
      : 1;
    this.vegetation += (capacity - this.vegetation) * Math.min(0.5, 0.004 * dt);
    this.vegetation = Math.max(0.02, Math.min(2.5, this.vegetation));

    for (const s of this.species) {
      const t = this.tier(s);
      const pop = this.populations[s.id] || 0;
      if (pop <= 0) continue;

      // Food supply, where 1.0 means "as much as this tier normally has".
      let food;
      if (t <= 1) {
        food = this.vegetation;
      } else {
        const supply = this.baselinePrey[t] || 0;
        // No prey tier at all: scavenge the vegetation layer instead, so the
        // species merely struggles rather than starving to zero.
        food = supply > 0 ? Math.min(2.0, this.preyMass(t) / supply) : this.vegetation * 0.8;
      }

      /*
       * Logistic growth, arranged so that (food = 1, pop = baseline) gives
       * exactly zero net change for every species regardless of its
       * metabolism: BIRTH - DEATH - DENSITY == 0 there by construction.
       * Metabolism scales how fast the species moves, not where it settles —
       * previously it scaled birth alone, which doomed every slow-metabolism
       * animal to a slow unprovoked extinction.
       */
      const BIRTH = 0.0045, DEATH = 0.0034, DENSITY = BIRTH - DEATH;
      const starve = food < 0.6 ? (0.6 - food) * 0.004 : 0;
      const rate = s.metabolism * (BIRTH * food - DEATH - DENSITY * (pop / this.baseline[s.id]) - starve);

      // Clamp per-substep change so no single step can swing more than 25%.
      const delta = Math.max(-0.25, Math.min(0.25, rate * dt)) * pop;
      let next = Math.max(0, Math.min(this.baseline[s.id] * 4, pop + delta));

      // Below a viable breeding population a species is gone for good.
      if (next < 1.5) {
        next = 0;
        if (!this.collapsed.includes(s.id)) this.collapsed.push(s.id);
      }
      this.populations[s.id] = next;
    }
  }

  /** The player killed `n` of a species. Returns a warning if it destabilises. */
  recordKill(speciesId, n = 1) {
    const pop = this.populations[speciesId];
    if (pop === undefined) return null;
    this.populations[speciesId] = Math.max(0, pop - n);
    const ratio = this.populations[speciesId] / Math.max(1, this.baseline[speciesId]);
    if (this.populations[speciesId] <= 0) {
      if (!this.collapsed.includes(speciesId)) this.collapsed.push(speciesId);
      return { level: 'extinct', speciesId };
    }
    if (ratio < 0.2) return { level: 'endangered', speciesId, ratio };
    return null;
  }

  /** Species currently present enough to encounter, for the spawner. */
  livingSpecies() {
    return this.species.filter((s) => (this.populations[s.id] || 0) > 0);
  }

  /**
   * Ecosystem health 0..1. Drives resource regeneration on this world, which
   * is how §1's "ecosystem affects economy" chain actually closes.
   */
  health() {
    if (!this.species.length) return 1;
    let sum = 0;
    for (const s of this.species) {
      const r = (this.populations[s.id] || 0) / Math.max(1, this.baseline[s.id]);
      sum += Math.min(1, r);
    }
    return +(sum / this.species.length * Math.min(1, this.vegetation)).toFixed(3);
  }

  save() {
    return { v: this.vegetation, p: this.populations, c: this.collapsed };
  }

  load(data) {
    if (!data) return;
    this.vegetation = data.v ?? 1;
    if (data.p) Object.assign(this.populations, data.p);
    this.collapsed = data.c || [];
  }
}

const cache = new Map();
export function getEcosystem(planet, saved) {
  let e = cache.get(planet.seed);
  if (!e) {
    e = new Ecosystem(planet, saved);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    cache.set(planet.seed, e);
  }
  return e;
}
