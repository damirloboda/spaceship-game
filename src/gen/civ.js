/**
 * The ten known civilizations (§19). Each has its own language phonetics,
 * architecture rules the city generator reads, technology bias that shapes
 * their ships and market, plus standing relations with the others.
 *
 * Relations are seeded here and then *drift* at runtime in sim/faction.js —
 * these are starting conditions, not constants.
 */

export const CIVILIZATIONS = [
  {
    id: 'concord',
    name: 'Terran Concord',
    phonemes: 'terran',
    ethos: 'pragmatic settlers, treaty-bound, endlessly bureaucratic',
    architecture: { style: 'modular', height: [8, 46], footprint: [10, 26], density: 0.7, color: [0.72, 0.75, 0.8], accent: [0.2, 0.8, 1.0], roofLights: true },
    tech: { engines: 0.7, weapons: 0.6, science: 0.6, medicine: 0.8, mining: 0.7 },
    economyBias: { food: 1.1, machinery: 0.9, medicine: 0.85, alloys: 1.0 },
    greeting: 'Concord Traffic Control, you are cleared.',
    shipStyle: 'boxy',
    hostility: 0.15,
  },
  {
    id: 'vessarid',
    name: 'Vessarid Choir',
    phonemes: 'vessarid',
    ethos: 'void ascetics who map dead stars and sing their catalogues',
    architecture: { style: 'spire', height: [30, 120], footprint: [6, 14], density: 0.45, color: [0.85, 0.86, 0.92], accent: [0.6, 0.5, 1.0], roofLights: true },
    tech: { engines: 0.6, weapons: 0.3, science: 1.0, medicine: 0.6, mining: 0.3 },
    economyBias: { data: 0.6, artifacts: 0.7, luxuries: 1.3 },
    greeting: 'The Choir hears your engine. Be brief.',
    shipStyle: 'needle',
    hostility: 0.1,
  },
  {
    id: 'koth',
    name: 'Koth Assembly',
    phonemes: 'koth',
    ethos: 'silicate hive-builders; they eat rock and excrete cities',
    architecture: { style: 'hive', height: [6, 30], footprint: [14, 40], density: 0.9, color: [0.5, 0.42, 0.35], accent: [1.0, 0.55, 0.15], roofLights: false },
    tech: { engines: 0.5, weapons: 0.7, science: 0.5, medicine: 0.3, mining: 1.0 },
    economyBias: { ore: 0.55, alloys: 0.7, crystal: 0.8, food: 1.4 },
    greeting: 'The Assembly acknowledges mass and intent.',
    shipStyle: 'chunk',
    hostility: 0.3,
  },
  {
    id: 'mirreleth',
    name: 'Mirreleth Drift',
    phonemes: 'mirreleth',
    ethos: 'gas-giant dwellers who consider ground-dwelling a disease',
    architecture: { style: 'suspended', height: [20, 70], footprint: [8, 20], density: 0.4, color: [0.6, 0.72, 0.78], accent: [0.4, 1.0, 0.85], roofLights: true },
    tech: { engines: 0.9, weapons: 0.4, science: 0.8, medicine: 0.7, mining: 0.4 },
    economyBias: { gas: 0.5, fuel: 0.6, machinery: 1.2 },
    greeting: 'You are very far down. We forgive you.',
    shipStyle: 'organic',
    hostility: 0.12,
  },
  {
    id: 'arkhon',
    name: 'Arkhon Lineage',
    phonemes: 'arkhon',
    ethos: 'machine descendants of a dead crew, still running the mission',
    architecture: { style: 'lattice', height: [12, 80], footprint: [12, 30], density: 0.8, color: [0.35, 0.37, 0.4], accent: [1.0, 0.25, 0.2], roofLights: true },
    tech: { engines: 1.0, weapons: 0.9, science: 0.9, medicine: 0.2, mining: 0.8 },
    economyBias: { machinery: 0.6, data: 0.7, medicine: 1.6 },
    greeting: 'Mission continues. State your function.',
    shipStyle: 'angular',
    hostility: 0.35,
  },
  {
    id: 'suneaters',
    name: 'The Sun-Eaters',
    phonemes: 'koth',
    ethos: 'harvest stellar plasma; treat solar systems as fuel reserves',
    architecture: { style: 'industrial', height: [10, 40], footprint: [18, 44], density: 0.85, color: [0.45, 0.3, 0.22], accent: [1.0, 0.75, 0.1], roofLights: false },
    tech: { engines: 0.8, weapons: 0.8, science: 0.6, medicine: 0.4, mining: 0.9 },
    economyBias: { fuel: 0.4, energy: 0.5, food: 1.5 },
    greeting: 'Everything burns eventually. Trade before it does.',
    shipStyle: 'chunk',
    hostility: 0.45,
  },
  {
    id: 'quietfleet',
    name: 'The Quiet Fleet',
    phonemes: 'vessarid',
    ethos: 'a civilization with no planet; every citizen is born under way',
    architecture: { style: 'docked', height: [14, 50], footprint: [10, 24], density: 0.6, color: [0.66, 0.68, 0.7], accent: [0.9, 0.9, 1.0], roofLights: true },
    tech: { engines: 1.0, weapons: 0.5, science: 0.8, medicine: 0.8, mining: 0.5 },
    economyBias: { fuel: 0.8, machinery: 0.85, luxuries: 1.2 },
    greeting: 'We have no port. Match our vector and talk.',
    shipStyle: 'needle',
    hostility: 0.1,
  },
  {
    id: 'thornwrights',
    name: 'Thornwright Groves',
    phonemes: 'mirreleth',
    ethos: 'grow their buildings, their ships, and arguably themselves',
    architecture: { style: 'grown', height: [10, 55], footprint: [12, 28], density: 0.65, color: [0.3, 0.45, 0.28], accent: [0.7, 1.0, 0.35], roofLights: false },
    tech: { engines: 0.5, weapons: 0.4, science: 0.9, medicine: 1.0, mining: 0.3 },
    economyBias: { biomass: 0.5, medicine: 0.6, food: 0.7, alloys: 1.4 },
    greeting: 'Do not step on anything that is still deciding.',
    shipStyle: 'organic',
    hostility: 0.08,
  },
  {
    id: 'hollowmark',
    name: 'Hollowmark Salvage',
    phonemes: 'terran',
    ethos: 'wreck-pickers turned cartel; they know where everything died',
    architecture: { style: 'scrap', height: [6, 28], footprint: [10, 34], density: 0.9, color: [0.42, 0.4, 0.36], accent: [1.0, 0.4, 0.05], roofLights: true },
    tech: { engines: 0.7, weapons: 0.8, science: 0.4, medicine: 0.5, mining: 0.8 },
    economyBias: { salvage: 0.4, machinery: 0.7, artifacts: 0.9 },
    greeting: 'If it is broken, we already own it.',
    shipStyle: 'boxy',
    hostility: 0.5,
  },
  {
    id: 'seventh',
    name: 'The Seventh Silence',
    phonemes: 'precursor',
    ethos: 'appeared after the precursors left; will not explain the connection',
    architecture: { style: 'monolith', height: [40, 160], footprint: [16, 32], density: 0.3, color: [0.15, 0.15, 0.18], accent: [0.55, 0.95, 1.0], roofLights: true },
    tech: { engines: 1.0, weapons: 1.0, science: 1.0, medicine: 0.9, mining: 0.6 },
    economyBias: { artifacts: 0.3, data: 0.5, energy: 0.7 },
    greeting: '...',
    shipStyle: 'angular',
    hostility: 0.25,
  },
];

export const CIV_BY_ID = Object.fromEntries(CIVILIZATIONS.map((c) => [c.id, c]));

/** Starting diplomatic matrix, -1 hostile .. +1 allied. Symmetric. */
export const BASE_RELATIONS = (() => {
  const pairs = {
    'concord:vessarid': 0.4, 'concord:koth': 0.1, 'concord:arkhon': -0.3,
    'concord:hollowmark': -0.5, 'concord:quietfleet': 0.5, 'concord:suneaters': -0.2,
    'concord:thornwrights': 0.3, 'concord:mirreleth': 0.2, 'concord:seventh': -0.1,
    'vessarid:seventh': 0.6, 'vessarid:suneaters': -0.7, 'vessarid:koth': -0.1,
    'koth:suneaters': 0.5, 'koth:thornwrights': -0.6, 'koth:hollowmark': 0.2,
    'arkhon:seventh': -0.8, 'arkhon:hollowmark': 0.3, 'arkhon:quietfleet': -0.2,
    'mirreleth:thornwrights': 0.5, 'mirreleth:suneaters': -0.6,
    'quietfleet:hollowmark': -0.4, 'thornwrights:hollowmark': -0.3,
  };
  const m = {};
  for (const a of CIVILIZATIONS) {
    m[a.id] = {};
    for (const b of CIVILIZATIONS) {
      if (a.id === b.id) { m[a.id][b.id] = 1; continue; }
      const v = pairs[`${a.id}:${b.id}`] ?? pairs[`${b.id}:${a.id}`] ?? 0;
      m[a.id][b.id] = v;
    }
  }
  return m;
})();

/** Player-facing reputation tiers (§67). */
export const REPUTATION_TIERS = [
  { id: 'HOSTILE', min: -Infinity, max: -40 },
  { id: 'NEUTRAL', min: -40, max: 25 },
  { id: 'FRIENDLY', min: 25, max: 60 },
  { id: 'TRUSTED', min: 60, max: 85 },
  { id: 'HONORED', min: 85, max: Infinity },
];

export function reputationTier(value) {
  for (const t of REPUTATION_TIERS) if (value >= t.min && value < t.max) return t.id;
  return 'NEUTRAL';
}

/**
 * What a reputation tier actually unlocks (§67 — relations must change access,
 * not just show a label).
 */
export const TIER_ACCESS = {
  HOSTILE:  { trade: false, dock: false, missions: false, shipyard: false, priceMul: 1.6, attackOnSight: true },
  NEUTRAL:  { trade: true,  dock: true,  missions: true,  shipyard: false, priceMul: 1.12, attackOnSight: false },
  FRIENDLY: { trade: true,  dock: true,  missions: true,  shipyard: true,  priceMul: 1.0, attackOnSight: false },
  TRUSTED:  { trade: true,  dock: true,  missions: true,  shipyard: true,  priceMul: 0.92, attackOnSight: false, restrictedGoods: true },
  HONORED:  { trade: true,  dock: true,  missions: true,  shipyard: true,  priceMul: 0.85, attackOnSight: false, restrictedGoods: true, civTech: true },
};
