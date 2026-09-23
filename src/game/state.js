// All persistent game state lives here. Rendering objects read from and write
// to this; save.js serialises it.
import { Inventory } from './inventory.js';
import { Jetpack } from './jetpack.js';
import { ShipSystems } from './shipSystems.js';
import { HOME_SYSTEM_ID } from '../world/galaxy.js';

export const SKILLS = ['exploration', 'engineering', 'piloting', 'science', 'survival', 'diplomacy'];
export const PROFESSIONS = ['explorer', 'scientist', 'miner', 'trader', 'engineer', 'pilot', 'archaeologist', 'colonist', 'mercenary', 'diplomat'];

// Which skills feed which (non-exclusive) profession title.
const PROFESSION_SKILLS = {
  explorer: ['exploration'], scientist: ['science'], miner: ['survival', 'engineering'], trader: ['diplomacy'],
  engineer: ['engineering'], pilot: ['piloting'], archaeologist: ['science', 'exploration'], colonist: ['engineering', 'survival'],
  mercenary: ['piloting', 'survival'], diplomat: ['diplomacy'],
};

export class GameState {
  constructor() {
    this.profile = { name: 'Explorer', suit: '#e8eef5', visor: '#39d0ff', build: 'standard' };
    this.credits = 300;
    this.suit = new Inventory(18);
    this.cargo = new Inventory(24);
    this.jetpack = new Jetpack('basic');
    this.ship = new ShipSystems('explorer');
    this.vitals = { health: 100, oxygen: 100, suitEnergy: 100 };
    this.skills = Object.fromEntries(SKILLS.map((s) => [s, 0]));
    this.reputation = { veyari: 0 };
    this.discoveries = { systems: {}, planets: {}, species: {}, sites: {} };
    this.minedDeposits = new Set();
    this.bases = [];
    this.tutorial = { step: 0, done: false };
    this.location = { systemId: HOME_SYSTEM_ID, mode: 'foot', player: null, ship: null, vehicle: null };
    this.time = 0;
    this.story = { flags: {} };
    this.quests = { active: {}, done: {} };
    this.markets = {};
    this.museum = [];
    this.owned = { skimmer: false, scanner_mk2: false };
    this.stats = { distance: 0, jumps: 0, scans: 0, mined: 0, playTime: 0 };
    this.news = [];
    this.newGame = true;
  }

  count(id) {
    return this.suit.count(id) + this.cargo.count(id);
  }

  addItem(id, n = 1) {
    const left = this.suit.add(id, n);
    return left ? this.cargo.add(id, left) : 0;
  }

  removeItem(id, n = 1) {
    if (this.count(id) < n) return false;
    const fromSuit = Math.min(this.suit.count(id), n);
    if (fromSuit) this.suit.remove(id, fromSuit);
    if (n - fromSuit) this.cargo.remove(id, n - fromSuit);
    return true;
  }

  // A merged view for systems that accept "any inventory".
  get combined() {
    const self = this;
    return {
      has: (id, n = 1) => self.count(id) >= n,
      remove: (id, n = 1) => self.removeItem(id, n),
      count: (id) => self.count(id),
    };
  }

  addXP(skill, amount) {
    const before = this.skillLevel(skill);
    this.skills[skill] = (this.skills[skill] || 0) + amount;
    const after = this.skillLevel(skill);
    return after > before ? after : 0;
  }

  skillLevel(skill) {
    return Math.floor(Math.sqrt((this.skills[skill] || 0) / 40));
  }

  // The title shown on the profile follows what the player actually does.
  primaryProfession() {
    let best = 'explorer';
    let bestScore = -1;
    for (const p of PROFESSIONS) {
      const skills = PROFESSION_SKILLS[p];
      const score = skills.reduce((a, s) => a + (this.skills[s] || 0), 0) / skills.length;
      if (score > bestScore) { best = p; bestScore = score; }
    }
    return best;
  }

  discover(kind, id, data = {}) {
    const bucket = this.discoveries[kind];
    if (!bucket || bucket[id]) return false;
    bucket[id] = { t: this.time, ...data };
    return true;
  }

  isDiscovered(kind, id) {
    return !!this.discoveries[kind]?.[id];
  }
}
