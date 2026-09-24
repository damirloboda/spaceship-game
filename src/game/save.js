// Versioned save format with migration, a rolling backup and safe fallback:
// a corrupt save never crashes the game, it falls back to the backup.
import { GameState } from './state.js';
import { Inventory } from './inventory.js';
import { Jetpack } from './jetpack.js';
import { ShipSystems } from './shipSystems.js';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'ultracosmos.save';

export function serialize(state) {
  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    data: {
      profile: state.profile,
      credits: state.credits,
      suit: state.suit.toJSON(),
      cargo: state.cargo.toJSON(),
      jetpack: state.jetpack.toJSON(),
      ship: state.ship.toJSON(),
      vitals: state.vitals,
      skills: state.skills,
      reputation: state.reputation,
      discoveries: state.discoveries,
      minedDeposits: [...state.minedDeposits].slice(-4000),
      bases: state.bases.map((b) => ({ ...b, storage: b.storage.toJSON() })),
      tutorial: state.tutorial,
      location: state.location,
      time: state.time,
      story: state.story,
      quests: state.quests,
      markets: state.markets,
      museum: state.museum,
      owned: state.owned,
      stats: state.stats,
      news: state.news.slice(-30),
    },
  };
}

// Upgrades older payloads step by step.
export function migrate(payload) {
  let p = payload;
  if (!p || typeof p !== 'object') throw new Error('save: not an object');
  if (!p.version) p = { version: 1, savedAt: 0, data: p };
  if (p.version === 1) {
    // v1 had a single `inventory` and no cargo split.
    const d = { ...p.data };
    if (d.inventory && !d.suit) {
      d.suit = d.inventory;
      d.cargo = { slots: 24, items: [] };
      delete d.inventory;
    }
    d.owned = d.owned || { skimmer: false };
    p = { version: 2, savedAt: p.savedAt, data: d };
  }
  if (p.version > SAVE_VERSION) throw new Error(`save: version ${p.version} is newer than supported ${SAVE_VERSION}`);
  return p;
}

export function deserialize(payload) {
  const { data: d } = migrate(payload);
  const s = new GameState();
  s.newGame = false;
  if (d.profile) s.profile = { ...s.profile, ...d.profile };
  if (Number.isFinite(d.credits)) s.credits = Math.max(0, Math.floor(d.credits));
  s.suit = Inventory.fromJSON(d.suit, 18);
  s.cargo = Inventory.fromJSON(d.cargo, 24);
  s.jetpack = Jetpack.fromJSON(d.jetpack);
  s.ship = ShipSystems.fromJSON(d.ship);
  if (d.vitals) s.vitals = { ...s.vitals, ...d.vitals };
  if (d.skills) s.skills = { ...s.skills, ...d.skills };
  if (d.reputation) s.reputation = { ...s.reputation, ...d.reputation };
  if (d.discoveries) s.discoveries = { ...s.discoveries, ...d.discoveries };
  s.minedDeposits = new Set(Array.isArray(d.minedDeposits) ? d.minedDeposits : []);
  s.bases = (d.bases || []).map((b) => ({ ...b, storage: Inventory.fromJSON(b.storage, 30) }));
  if (d.tutorial) s.tutorial = d.tutorial;
  if (d.location?.systemId) s.location = { ...s.location, ...d.location };
  if (Number.isFinite(d.time)) s.time = d.time;
  if (d.story) s.story = d.story;
  if (d.quests) s.quests = d.quests;
  if (d.markets) s.markets = d.markets;
  if (Array.isArray(d.museum)) s.museum = d.museum;
  if (d.owned) s.owned = { ...s.owned, ...d.owned };
  if (d.stats) s.stats = { ...s.stats, ...d.stats };
  if (Array.isArray(d.news)) s.news = d.news;
  return s;
}

export class SaveManager {
  constructor(storage, key = SAVE_KEY) {
    this.storage = storage;
    this.key = key;
    this.lastError = null;
  }

  save(state) {
    try {
      const json = JSON.stringify(serialize(state));
      const prev = this.storage.get(this.key);
      if (prev) this.storage.set(`${this.key}.bak`, prev);
      this.storage.set(this.key, json);
      return true;
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }

  hasSave() {
    return !!this.storage.get(this.key) || !!this.storage.get(`${this.key}.bak`);
  }

  // Returns { state, source } or null. Tries main save then backup.
  load() {
    for (const k of [this.key, `${this.key}.bak`]) {
      const raw = this.storage.get(k);
      if (!raw) continue;
      try {
        return { state: deserialize(JSON.parse(raw)), source: k };
      } catch (err) {
        this.lastError = err;
      }
    }
    return null;
  }

  meta() {
    try {
      const raw = this.storage.get(this.key);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return { savedAt: p.savedAt, name: p.data?.profile?.name, system: p.data?.location?.systemId };
    } catch {
      return null;
    }
  }

  clear() {
    this.storage.remove(this.key);
    this.storage.remove(`${this.key}.bak`);
  }

  exportString(state) {
    const json = JSON.stringify(serialize(state));
    return btoa(unescape(encodeURIComponent(json)));
  }

  importString(str) {
    const json = decodeURIComponent(escape(atob(str.trim())));
    return deserialize(JSON.parse(json));
  }
}
