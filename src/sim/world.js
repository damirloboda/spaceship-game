/**
 * The living universe (§50, §81).
 *
 * The galaxy keeps running while the player is elsewhere. Rather than ticking
 * millions of systems (impossible), we tick:
 *   - everything the player has actually touched (visited systems, known
 *     markets, ecosystems they've disturbed), which is a bounded set, and
 *   - the faction layer, which is only ten actors and drives the headlines.
 *
 * Anything the player has never seen is generated fresh from its seed *plus*
 * the current galactic day when they finally arrive, so an untouched system
 * still shows the consequences of the intervening years.
 */
import { RNG, hashInts } from '../core/rng.js';
import { FactionState, describeFactionEvent } from './faction.js';
import { Market } from './economy.js';
import { Ecosystem } from './ecosystem.js';
import { worldEventFor, describeWorldEvent } from './weather.js';
import { CIV_BY_ID } from '../gen/civ.js';

/** In-game seconds per real second at normal speed. */
export const TIME_SCALE = 60;
const SECONDS_PER_DAY = 86400;

export class World {
  constructor(seed = 1, saved = null) {
    this.seed = seed;
    this.timeS = 0;                      // galactic time, seconds
    this.factions = new FactionState(seed);
    this.markets = new Map();            // id -> Market
    this.ecosystems = new Map();         // planetSeed -> Ecosystem
    this.news = [];                      // most recent first
    this.activeEvents = [];
    this.visited = new Set();            // system ids
    this.discoveries = { systems: 0, planets: 0, species: 0, flora: 0, ruins: 0 };
    this.lastSimDay = 0;

    if (saved) this.load(saved);
  }

  get day() {
    return this.timeS / SECONDS_PER_DAY;
  }

  /* ---------------------------------------------------------------- */
  /* Registries                                                        */
  /* ---------------------------------------------------------------- */

  /** Market for a station/city, created on first visit and then persisted. */
  market(id, seed, civId, opts) {
    let m = this.markets.get(id);
    if (!m) {
      m = new Market(id, seed, civId, opts);
      // A market discovered late should already reflect the elapsed years.
      m.tick(Math.max(0, this.day - m.lastTickDay), {});
      m.lastTickDay = this.day;
      this.markets.set(id, m);
    }
    return m;
  }

  /** Ecosystem for a planet, created on first landing. */
  ecosystem(planet) {
    let e = this.ecosystems.get(planet.seed);
    if (!e) {
      e = new Ecosystem(planet);
      this.ecosystems.set(planet.seed, e);
    }
    return e;
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Advance world time. Called every frame with the frame's delta, and with a
   * large delta after fast-travel, sleep, cryo or loading an old save.
   */
  advance(deltaSeconds) {
    if (!(deltaSeconds > 0)) return [];
    this.timeS += deltaSeconds;

    const day = this.day;
    const elapsedDays = day - this.lastSimDay;
    // Batch the expensive layers into whole-day steps.
    if (elapsedDays < 0.25) return [];
    this.lastSimDay = day;

    const news = [];

    // Factions: wars, treaties, territory.
    for (const ev of this.factions.tick(elapsedDays)) {
      const text = describeFactionEvent(ev);
      if (text) news.push({ day: ev.day, text, kind: ev.kind, scope: 'galactic' });
    }

    // Ecosystems the player has touched.
    for (const eco of this.ecosystems.values()) {
      eco.tick(elapsedDays);
    }

    // Markets, influenced by their planet's ecosystem health and any war.
    for (const m of this.markets.values()) {
      const wars = m.civ ? this.factions.warsOf(m.civ).length > 0 : false;
      m.tick(elapsedDays, { war: wars, ecosystemHealth: m.ecosystemHealth ?? 1 });
      m.lastTickDay = day;
    }

    /*
     * Planet-scale events on worlds the player knows about. Sampled across the
     * whole elapsed interval, not just the day we happen to land on: after a
     * two-year absence, checking a single day meant almost every storm,
     * eruption and outbreak in between silently never happened.
     */
    const firstDay = Math.floor(day - elapsedDays) + 1;
    const lastDay = Math.floor(day);
    const span = Math.max(0, lastDay - firstDay);
    const samples = Math.min(60, span + 1);
    const stride = samples > 0 ? span / samples : 1;
    for (const eco of this.ecosystems.values()) {
      for (let i = 0; i < samples; i++) {
        const d = Math.floor(firstDay + i * stride);
        const ev = worldEventFor(eco.planet, d);
        if (!ev) continue;
        this.activeEvents.push(ev);
        news.push({ day: ev.day, text: describeWorldEvent(ev), kind: ev.kind, scope: 'local', planetSeed: ev.planetSeed });
      }
    }

    // Expire finished events.
    this.activeEvents = this.activeEvents.filter((e) => day < e.day + e.durationDays);

    if (news.length) {
      this.news = [...news.reverse(), ...this.news].slice(0, 120);
    }
    return news;
  }

  /** Latest headlines for the Galactic News Network panel (§81). */
  headlines(n = 8) {
    return this.news.slice(0, n);
  }

  /* ---------------------------------------------------------------- */
  /* Discovery                                                         */
  /* ---------------------------------------------------------------- */

  markVisited(systemId) {
    if (this.visited.has(systemId)) return false;
    this.visited.add(systemId);
    this.discoveries.systems++;
    return true;                          // true = first discovery
  }

  hasVisited(systemId) {
    return this.visited.has(systemId);
  }

  /**
   * A distress call, trade offer or rumour arriving over the radio (§80).
   * Deterministic per hour so it doesn't spam on reload.
   */
  radioTraffic(systemStub) {
    const hour = Math.floor(this.timeS / 3600);
    const rng = new RNG(hashInts(systemStub.seed, hour));
    if (!rng.chance(0.22)) return null;
    const kinds = ['distress', 'trade_offer', 'news', 'rumour', 'warning'];
    const kind = rng.weighted([['distress', 0.2], ['trade_offer', 0.3], ['news', 0.2], ['rumour', 0.2], ['warning', 0.1]]);
    const civ = CIV_BY_ID[systemStub.civilization] || null;
    switch (kind) {
      case 'distress':
        return { kind, urgent: true, text: `Mayday, mayday — hull breach, ${systemStub.name} outer system. Anyone on this band.` };
      case 'trade_offer':
        return { kind, text: `${civ ? civ.name : 'Independent hauler'} paying above list for medical supplies at ${systemStub.name}.` };
      case 'warning':
        return { kind, urgent: true, text: `Advisory: unregistered ships operating near ${systemStub.name}. Travel armed or travel elsewhere.` };
      case 'rumour':
        return { kind, text: rng.pick([
          `Somebody swears there's a structure out past the belt that wasn't on last year's charts.`,
          `A survey team went quiet three weeks ago. Their beacon is still transmitting.`,
          `They say one of the old arrays answers if you broadcast at it. They say a lot of things.`,
        ]) };
      default:
        return { kind, text: this.news[0] ? this.news[0].text : `All quiet on the ${systemStub.name} band.` };
    }
  }

  /* ---------------------------------------------------------------- */
  /* Persistence                                                       */
  /* ---------------------------------------------------------------- */

  save() {
    const markets = {};
    for (const [id, m] of this.markets) markets[id] = { ...m.save(), seed: m.seed, civ: m.civ };
    const ecos = {};
    for (const [seed, e] of this.ecosystems) ecos[seed] = e.save();
    return {
      seed: this.seed,
      timeS: this.timeS,
      lastSimDay: this.lastSimDay,
      factions: this.factions.save(),
      markets,
      ecosystems: ecos,
      news: this.news.slice(0, 40),
      activeEvents: this.activeEvents,
      visited: [...this.visited],
      discoveries: this.discoveries,
    };
  }

  load(d) {
    if (!d) return;
    this.seed = d.seed ?? this.seed;
    this.timeS = d.timeS || 0;
    this.lastSimDay = d.lastSimDay || 0;
    this.factions = new FactionState(this.seed, d.factions);
    this.news = d.news || [];
    this.activeEvents = d.activeEvents || [];
    this.visited = new Set(d.visited || []);
    this.discoveries = d.discoveries || this.discoveries;

    this.markets = new Map();
    for (const [id, md] of Object.entries(d.markets || {})) {
      const m = new Market(id, md.seed, md.civ);
      m.load(md);
      this.markets.set(id, m);
    }
    // Ecosystems are rebuilt from their planet seeds when the planet is next
    // loaded; we keep the saved population state until then.
    this._pendingEcosystems = d.ecosystems || {};
    this.ecosystems = new Map();
  }

  /** Restore saved ecosystem state for a planet as it comes into play. */
  restoreEcosystem(planet) {
    const saved = this._pendingEcosystems && this._pendingEcosystems[planet.seed];
    const e = new Ecosystem(planet, saved);
    this.ecosystems.set(planet.seed, e);
    return e;
  }
}
