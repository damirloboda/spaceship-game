/**
 * Skills and player specialisation (§68, §69).
 *
 * You gain levels in six disciplines by doing the thing, and you may declare a
 * profession for a bonus — but nothing is locked, and switching costs you
 * nothing but the bonus you were getting (§68 explicitly forbids a permanent
 * class prison).
 */

export const SKILLS = {
  exploration: { label: 'Exploration', xpPerLevel: 480 },
  engineering: { label: 'Engineering', xpPerLevel: 520 },
  piloting:    { label: 'Piloting',    xpPerLevel: 500 },
  science:     { label: 'Science',     xpPerLevel: 540 },
  survival:    { label: 'Survival',    xpPerLevel: 460 },
  diplomacy:   { label: 'Diplomacy',   xpPerLevel: 560 },
};

export const PROFESSIONS = {
  explorer:      { label: 'Explorer',      boosts: { exploration: 1.35 }, perk: 'scan_range' },
  scientist:     { label: 'Scientist',     boosts: { science: 1.35 },     perk: 'research_speed' },
  miner:         { label: 'Miner',         boosts: { engineering: 1.2, survival: 1.15 }, perk: 'mining_yield' },
  trader:        { label: 'Trader',        boosts: { diplomacy: 1.3 },    perk: 'better_prices' },
  engineer:      { label: 'Engineer',      boosts: { engineering: 1.35 }, perk: 'repair_efficiency' },
  pilot:         { label: 'Pilot',         boosts: { piloting: 1.35 },    perk: 'fuel_efficiency' },
  archaeologist: { label: 'Archaeologist', boosts: { science: 1.2, exploration: 1.2 }, perk: 'ruin_sense' },
  colonist:      { label: 'Colonist',      boosts: { engineering: 1.2, survival: 1.2 }, perk: 'build_cost' },
  mercenary:     { label: 'Mercenary',     boosts: { piloting: 1.2, survival: 1.2 }, perk: 'weapon_damage' },
  diplomat:      { label: 'Diplomat',      boosts: { diplomacy: 1.4 },    perk: 'reputation_gain' },
};

/** What each perk multiplies. Read by the systems that care. */
export const PERK_EFFECTS = {
  scan_range:        { scanRange: 1.3 },
  research_speed:    { research: 1.4 },
  mining_yield:      { miningYield: 1.35 },
  better_prices:     { priceMargin: 0.9 },
  repair_efficiency: { repairParts: 0.7 },
  fuel_efficiency:   { fuelBurn: 0.78 },
  ruin_sense:        { ruinDetect: 1.0 },
  build_cost:        { buildCost: 0.8 },
  weapon_damage:     { weaponDamage: 1.3 },
  reputation_gain:   { reputationGain: 1.4 },
};

export class Progression {
  constructor(saved = null) {
    this.xp = {};
    this.levels = {};
    for (const k of Object.keys(SKILLS)) { this.xp[k] = 0; this.levels[k] = 1; }
    this.profession = null;
    this.recentLevelUps = [];
    if (saved) this.load(saved);
  }

  /** Award XP; returns the new level if it went up. */
  award(skill, amount) {
    if (!SKILLS[skill] || amount <= 0) return null;
    const mult = this.profession && PROFESSIONS[this.profession].boosts[skill]
      ? PROFESSIONS[this.profession].boosts[skill] : 1;
    this.xp[skill] += amount * mult;
    const per = SKILLS[skill].xpPerLevel;
    // Each level costs progressively more.
    let level = 1, need = per, spent = 0;
    while (this.xp[skill] >= spent + need && level < 50) {
      spent += need;
      level++;
      need = Math.round(per * Math.pow(1.14, level - 1));
    }
    const prev = this.levels[skill];
    this.levels[skill] = level;
    if (level > prev) {
      this.recentLevelUps.push({ skill, level });
      return level;
    }
    return null;
  }

  /** Progress toward the next level, 0..1. */
  progress(skill) {
    const per = SKILLS[skill].xpPerLevel;
    let level = 1, need = per, spent = 0;
    while (level < this.levels[skill]) {
      spent += need;
      level++;
      need = Math.round(per * Math.pow(1.14, level - 1));
    }
    return Math.max(0, Math.min(1, (this.xp[skill] - spent) / need));
  }

  setProfession(id) {
    if (id !== null && !PROFESSIONS[id]) return false;
    this.profession = id;                 // freely reversible by design
    return true;
  }

  /** Aggregate multiplier for an effect, from profession perk and levels. */
  effect(name) {
    let v = 1;
    if (this.profession) {
      const perk = PROFESSIONS[this.profession].perk;
      const eff = PERK_EFFECTS[perk];
      if (eff && eff[name] !== undefined) v *= eff[name];
    }
    // Levels give a gentle across-the-board improvement.
    const relevant = {
      scanRange: 'exploration', research: 'science', miningYield: 'engineering',
      priceMargin: 'diplomacy', repairParts: 'engineering', fuelBurn: 'piloting',
      buildCost: 'engineering', weaponDamage: 'piloting', reputationGain: 'diplomacy',
    }[name];
    if (relevant) {
      const lvl = this.levels[relevant] - 1;
      // Cost-type effects go down with level; benefit-type effects go up.
      const isCost = ['priceMargin', 'repairParts', 'fuelBurn', 'buildCost'].includes(name);
      v *= isCost ? Math.max(0.5, 1 - lvl * 0.012) : 1 + lvl * 0.018;
    }
    return v;
  }

  save() { return { xp: this.xp, levels: this.levels, profession: this.profession }; }

  load(d) {
    if (!d) return;
    Object.assign(this.xp, d.xp || {});
    Object.assign(this.levels, d.levels || {});
    this.profession = d.profession ?? null;
  }
}
