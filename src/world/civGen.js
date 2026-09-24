// Civilizations and their citizens. The vertical slice realises the Veyari
// Concord on Aurel; the other nine are fully described so later systems
// (diplomacy, cities elsewhere, fleets) can instantiate them.
import { RNG, makeName } from '../core/rng.js';

export const CIVILIZATIONS = [
  {
    id: 'veyari', name: 'Veyari Concord', architecture: 'terraced domes', tech: 'biotech + fusion', economy: 'trade guilds',
    colors: [[0.85, 0.82, 0.74], [0.32, 0.62, 0.66], [0.95, 0.72, 0.35]],
    language: { start: ['ve', 'sa', 'ori', 'tal', 'ne', 'ila', 'mi', 'ka'], mid: ['ya', 'ri', 'le', 'no', 'sha'], end: ['n', 'ra', 'el', 'is', 'ae', 'or'] },
    greeting: 'Sael veyan.', temperament: 'curious', relations: { korr: -20, lumen: 40 },
    history: 'Settled Aurel twelve centuries ago after fleeing a collapsing star.',
  },
  { id: 'korr', name: 'Korr Dominion', architecture: 'basalt fortresses', tech: 'kinetic weapons', economy: 'war tribute', colors: [[0.3, 0.28, 0.3], [0.7, 0.2, 0.15]], language: { start: ['kr', 'gar', 'dro', 'ul'], mid: ['ak', 'or', 'uk'], end: ['k', 'gar', 'th', 'ull'] }, greeting: 'Speak quickly.', temperament: 'proud', relations: { veyari: -20 }, history: 'A militarised hegemony of high-gravity worlds.' },
  { id: 'lumen', name: 'Lumen Choir', architecture: 'crystal spires', tech: 'photonic computing', economy: 'knowledge exchange', colors: [[0.8, 0.9, 1.0], [0.5, 0.7, 1.0]], language: { start: ['li', 'ae', 'io', 'su'], mid: ['la', 'ie', 'ua'], end: ['ae', 'ia', 'iel'] }, greeting: 'We hear you.', temperament: 'serene', relations: { veyari: 40 }, history: 'A collective that sings data across light-years.' },
  { id: 'thessid', name: 'Thessid Swarm', architecture: 'organic hives', tech: 'gene-forging', economy: 'resource harvesting', colors: [[0.4, 0.5, 0.2], [0.8, 0.7, 0.2]], language: { start: ['ts', 'ss', 'khi'], mid: ['ik', 'iss'], end: ['ss', 'ix', 'tk'] }, greeting: 'Sss-welcome.', temperament: 'alien', relations: {}, history: 'An insectoid meta-organism spreading between moons.' },
  { id: 'ormund', name: 'Ormund Traders', architecture: 'modular stations', tech: 'logistics AI', economy: 'free markets', colors: [[0.7, 0.6, 0.4], [0.2, 0.4, 0.6]], language: { start: ['or', 'mun', 'bel', 'ta'], mid: ['do', 'ra'], end: ['d', 'ro', 'ex'] }, greeting: 'What are you buying?', temperament: 'pragmatic', relations: {}, history: 'Nomadic merchants whose home was lost to a nova.' },
  { id: 'vael', name: 'Vael Remnant', architecture: 'sunken vaults', tech: 'gravitics', economy: 'salvage', colors: [[0.25, 0.3, 0.4], [0.6, 0.8, 0.9]], language: { start: ['va', 'el', 'thy'], mid: ['ae', 'yr'], end: ['l', 'ith', 'ael'] }, greeting: 'You should not be here.', temperament: 'secretive', relations: {}, history: 'Survivors of a civilisation that once studied the Precursor gates.' },
  { id: 'quorra', name: 'Quorra Deep', architecture: 'pressure domes', tech: 'hydro-engineering', economy: 'aquaculture', colors: [[0.2, 0.5, 0.6], [0.9, 0.9, 0.8]], language: { start: ['qu', 'oo', 'ma', 'lu'], mid: ['ro', 'wa'], end: ['ra', 'oo', 'ul'] }, greeting: 'Bubbles and blessings.', temperament: 'gentle', relations: {}, history: 'An aquatic people living in the oceans of tidal-locked worlds.' },
  { id: 'nyx', name: 'Nyx Syndicate', architecture: 'hidden asteroid dens', tech: 'stealth fields', economy: 'smuggling', colors: [[0.15, 0.12, 0.2], [0.6, 0.1, 0.6]], language: { start: ['ny', 'zx', 'ra'], mid: ['x', 'ae'], end: ['x', 'yx', 'is'] }, greeting: 'Keep your voice down.', temperament: 'cunning', relations: {}, history: 'A loose pirate confederacy.' },
  { id: 'aurum', name: 'Aurum Ascendancy', architecture: 'golden ziggurats', tech: 'antimatter', economy: 'mining empire', colors: [[0.9, 0.75, 0.3], [0.5, 0.3, 0.1]], language: { start: ['au', 'ra', 'zi'], mid: ['ru', 'ka'], end: ['um', 'ar', 'at'] }, greeting: 'Kneel, or trade.', temperament: 'imperial', relations: {}, history: 'Rich from a single world of pure metal.' },
  { id: 'silent', name: 'The Silent', architecture: 'unknown', tech: 'unknown', economy: 'unknown', colors: [[0.05, 0.05, 0.05], [0.8, 0.8, 0.8]], language: { start: ['.'], mid: [''], end: ['.'] }, greeting: '...', temperament: 'unknown', relations: {}, history: 'Only rumours. Some say they built the gates.' },
];

export const PROFESSIONS = ['merchant', 'engineer', 'scientist', 'pilot', 'medic', 'farmer', 'guard', 'cook', 'miner', 'archivist', 'mechanic', 'dockhand'];
export const PERSONALITIES = ['cheerful', 'grumpy', 'curious', 'shy', 'proud', 'nervous', 'wise', 'sarcastic'];

// Workplaces keyed by profession, matched to city building kinds.
export const WORKPLACE = {
  merchant: 'market', engineer: 'workshop', scientist: 'lab', pilot: 'spaceport', medic: 'hospital',
  farmer: 'farm', guard: 'plaza', cook: 'restaurant', miner: 'factory', archivist: 'lab', mechanic: 'workshop', dockhand: 'spaceport',
};

export function generateCitizens(civIndex, seed, count, buildings) {
  const civ = CIVILIZATIONS[civIndex] || CIVILIZATIONS[0];
  const rng = new RNG(seed);
  const homes = buildings.filter((b) => b.kind === 'residential' || b.kind === 'hotel');
  const citizens = [];
  for (let i = 0; i < count; i++) {
    const r = rng.fork(`npc${i}`);
    const profession = i === 0 ? 'merchant' : i === 1 ? 'mechanic' : i === 2 ? 'scientist' : r.pick(PROFESSIONS);
    const wantKind = WORKPLACE[profession];
    const works = buildings.filter((b) => b.kind === wantKind);
    const work = works.length ? r.pick(works) : r.pick(buildings);
    const home = homes.length ? r.pick(homes) : r.pick(buildings);
    const wake = r.range(5, 8);
    citizens.push({
      id: `npc-${i}`,
      name: `${makeName(r.fork('a'), civ.language, 0, 1)} ${makeName(r.fork('b'), civ.language, 0, 1)}`,
      civ: civ.id,
      faction: civ.id,
      profession,
      personality: r.pick(PERSONALITIES),
      home: home.index,
      work: work.index,
      schedule: { wake, workStart: wake + r.range(0.5, 1.5), workEnd: r.range(15, 18), marketUntil: r.range(18.5, 20.5), sleep: r.range(21.5, 23.5) },
      relations: {},
      story: i < STORIES.length ? STORIES[i] : null,
      color: r.pick(civ.colors),
      height: r.range(1.6, 2.1),
    });
  }
  // Simple social graph: coworkers are friends, a few rivals.
  for (const a of citizens) {
    for (const b of citizens) {
      if (a === b) continue;
      if (a.work === b.work) a.relations[b.id] = 'friend';
      else if (rng.chance(0.03)) a.relations[b.id] = 'rival';
    }
  }
  return citizens;
}

// Hand-written side stories attached to the first citizens.
export const STORIES = [
  { id: 'merchant_price', kind: 'trade' },
  { id: 'lost_drone', kind: 'fetch', target: 'drone', reward: 350 },
  { id: 'moon_signal', kind: 'rumor', target: 'home/tessa' },
  { id: 'sample_request', kind: 'deliver', item: 'cobalt', count: 5, reward: 420 },
  { id: 'old_pilot', kind: 'lore' },
];
