/**
 * Factions and diplomacy (§20, §50, §67).
 *
 * Civilizations hold territory, drift in and out of alliances, fight wars and
 * lose systems while the player is elsewhere. The player's reputation with
 * each is tracked separately and gates real access, not just a label.
 */
import { RNG, hashInts } from '../core/rng.js';
import { CIVILIZATIONS, CIV_BY_ID, BASE_RELATIONS, reputationTier, TIER_ACCESS } from '../gen/civ.js';

export class FactionState {
  constructor(seed = 1, saved = null) {
    this.seed = seed;
    this.rng = new RNG(hashInts(seed, 0xFAC));

    /** Pairwise relations, -1..1, drifting from the seeded starting matrix. */
    this.relations = {};
    for (const a of CIVILIZATIONS) {
      this.relations[a.id] = { ...BASE_RELATIONS[a.id] };
    }

    /** Player standing per faction, -100..100. */
    this.reputation = {};
    for (const c of CIVILIZATIONS) this.reputation[c.id] = 0;

    /** Rough territory size, in systems. Wars move these numbers. */
    this.territory = {};
    for (const c of CIVILIZATIONS) {
      this.territory[c.id] = this.rng.int(40, 400);
    }

    this.wars = [];         // [{a, b, startedDay, intensity}]
    this.treaties = [];     // [{a, b, kind, day}]
    this.day = 0;

    if (saved) this.load(saved);
  }

  relation(a, b) {
    if (a === b) return 1;
    return this.relations[a]?.[b] ?? 0;
  }

  setRelation(a, b, v) {
    const clamped = Math.max(-1, Math.min(1, v));
    if (this.relations[a]) this.relations[a][b] = clamped;
    if (this.relations[b]) this.relations[b][a] = clamped;
  }

  atWar(a, b) {
    return this.wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }

  /** Every war a faction is currently in. */
  warsOf(id) {
    return this.wars.filter((w) => w.a === id || w.b === id);
  }

  /* ---------------------------------------------------------------- */
  /* Player reputation                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Adjust standing with a faction. Their allies and enemies notice: helping
   * someone's enemy costs you with them, which is what makes §20's diplomacy
   * a real choice rather than a set of independent sliders.
   */
  addReputation(civId, amount, spillover = true) {
    if (this.reputation[civId] === undefined) return;
    this.reputation[civId] = Math.max(-100, Math.min(100, this.reputation[civId] + amount));
    if (!spillover) return;
    for (const other of CIVILIZATIONS) {
      if (other.id === civId) continue;
      const rel = this.relation(civId, other.id);
      if (Math.abs(rel) < 0.3) continue;
      const share = amount * rel * 0.35;
      this.reputation[other.id] = Math.max(-100, Math.min(100, this.reputation[other.id] + share));
    }
  }

  tier(civId) {
    return reputationTier(this.reputation[civId] ?? 0);
  }

  /** What the player may currently do with this faction (§67). */
  access(civId) {
    return TIER_ACCESS[this.tier(civId)] || TIER_ACCESS.NEUTRAL;
  }

  /** Price multiplier at this faction's markets. */
  priceMultiplier(civId) {
    return this.access(civId).priceMul;
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Advance galactic politics by `days`. Returns the events that happened, so
   * the news network (§81) can report them.
   */
  tick(days) {
    const events = [];
    if (days <= 0) return events;
    // One political "turn" per 30 days, capped so a century away doesn't
    // become a hundred thousand rolls.
    const turns = Math.min(120, Math.floor(days / 30));
    for (let t = 0; t < turns; t++) {
      this.day += 30;
      events.push(...this._politicalTurn());
    }
    return events;
  }

  _politicalTurn() {
    const events = [];
    const rng = this.rng;

    // Relations drift toward each civ's natural disposition.
    for (const a of CIVILIZATIONS) {
      for (const b of CIVILIZATIONS) {
        if (a.id >= b.id) continue;
        const cur = this.relation(a.id, b.id);
        const pull = BASE_RELATIONS[a.id][b.id];
        const hostilityDrag = -(a.hostility + b.hostility) * 0.15;
        const target = Math.max(-1, Math.min(1, pull + hostilityDrag));
        const next = cur + (target - cur) * 0.04 + rng.range(-0.05, 0.05);
        this.setRelation(a.id, b.id, next);
      }
    }

    // War declarations: deeply hostile pairs eventually fight.
    for (const a of CIVILIZATIONS) {
      for (const b of CIVILIZATIONS) {
        if (a.id >= b.id) continue;
        if (this.atWar(a.id, b.id)) continue;
        const rel = this.relation(a.id, b.id);
        if (rel < -0.55 && rng.chance(0.06 + (a.hostility + b.hostility) * 0.05)) {
          this.wars.push({ a: a.id, b: b.id, startedDay: this.day, intensity: rng.range(0.3, 1) });
          events.push({ kind: 'war_declared', a: a.id, b: b.id, day: this.day });
        }
      }
    }

    // Wars burn territory and eventually end.
    for (let i = this.wars.length - 1; i >= 0; i--) {
      const w = this.wars[i];
      const swing = Math.round(rng.range(-4, 4) * w.intensity);
      this.territory[w.a] = Math.max(5, this.territory[w.a] + swing);
      this.territory[w.b] = Math.max(5, this.territory[w.b] - swing);
      if (swing !== 0) {
        events.push({ kind: 'territory', winner: swing > 0 ? w.a : w.b, loser: swing > 0 ? w.b : w.a, systems: Math.abs(swing), day: this.day });
      }
      // Attrition pushes both sides back toward talking.
      this.setRelation(w.a, w.b, this.relation(w.a, w.b) + 0.02);
      const duration = this.day - w.startedDay;
      if (duration > 360 && rng.chance(0.12 + duration / 20000)) {
        this.wars.splice(i, 1);
        this.setRelation(w.a, w.b, Math.max(this.relation(w.a, w.b), -0.35));
        this.treaties.push({ a: w.a, b: w.b, kind: 'ceasefire', day: this.day });
        events.push({ kind: 'peace', a: w.a, b: w.b, day: this.day });
      }
    }

    // Alliances between warm pairs.
    for (const a of CIVILIZATIONS) {
      for (const b of CIVILIZATIONS) {
        if (a.id >= b.id) continue;
        if (this.relation(a.id, b.id) > 0.72
          && !this.treaties.some((t) => t.kind === 'alliance' && ((t.a === a.id && t.b === b.id) || (t.a === b.id && t.b === a.id)))
          && rng.chance(0.05)) {
          this.treaties.push({ a: a.id, b: b.id, kind: 'alliance', day: this.day });
          events.push({ kind: 'alliance', a: a.id, b: b.id, day: this.day });
        }
      }
    }

    // Peacetime expansion.
    for (const c of CIVILIZATIONS) {
      if (!this.warsOf(c.id).length && rng.chance(0.25)) {
        this.territory[c.id] += rng.int(1, 3);
        if (rng.chance(0.08)) events.push({ kind: 'expansion', civ: c.id, day: this.day });
      }
    }

    return events;
  }

  save() {
    return {
      rel: this.relations, rep: this.reputation, terr: this.territory,
      wars: this.wars, treaties: this.treaties, day: this.day,
    };
  }

  load(d) {
    if (!d) return;
    if (d.rel) this.relations = d.rel;
    if (d.rep) Object.assign(this.reputation, d.rep);
    if (d.terr) Object.assign(this.territory, d.terr);
    this.wars = d.wars || [];
    this.treaties = d.treaties || [];
    this.day = d.day || 0;
  }
}

/** Human-readable line for the galactic news feed. */
export function describeFactionEvent(ev) {
  const n = (id) => (CIV_BY_ID[id] || {}).name || id;
  switch (ev.kind) {
    case 'war_declared': return `${n(ev.a)} and ${n(ev.b)} are at war.`;
    case 'peace': return `${n(ev.a)} and ${n(ev.b)} have agreed a ceasefire.`;
    case 'alliance': return `${n(ev.a)} and ${n(ev.b)} have signed a mutual accord.`;
    case 'territory': return `${n(ev.winner)} has taken ${ev.systems} system${ev.systems > 1 ? 's' : ''} from ${n(ev.loser)}.`;
    case 'expansion': return `${n(ev.civ)} has chartered new settlements on its frontier.`;
    default: return '';
  }
}
