// Player tools and item actions: scanner, mining beam, crafting, research,
// base deployment, consumables, trading helpers and the expedition check.
import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { JET_FUEL_PER_CANISTER } from './jetpack.js';
import { checkExpedition } from './expedition.js';
import { DEPOSIT_TYPES } from '../render/models.js';
import { Inventory } from './inventory.js';
import { reputationDiscount, reputationTier } from './economy.js';
import { RNG } from '../core/rng.js';

export const RECIPES = [
  { id: 'jet_fuel', out: 'jet_fuel', n: 1, cost: { carbon: 10, oxyite: 4 }, skill: 'engineering' },
  { id: 'repair_kit', out: 'repair_kit', n: 1, cost: { ferrite: 25, cobalt: 6 }, skill: 'engineering' },
  { id: 'nitro_cell', out: 'nitro_cell', n: 1, cost: { cobalt: 12, oxyite: 10 }, skill: 'engineering' },
  { id: 'fuel_cell', out: 'fuel_cell', n: 1, cost: { ferrite: 20, oxyite: 12, carbon: 8 }, skill: 'engineering' },
  { id: 'medkit', out: 'medkit', n: 1, cost: { carbon: 12, biosample: 1 }, skill: 'science' },
  { id: 'water', out: 'water', n: 2, cost: { ice: 6 }, skill: 'survival' },
  { id: 'base_kit', out: 'base_kit', n: 1, cost: { ferrite: 60, cobalt: 15, carbon: 20 }, skill: 'engineering' },
  { id: 'energy_cell', out: 'energy_cell', n: 1, cost: { cobalt: 6, carbon: 6 }, skill: 'engineering' },
];

// Blueprints researched in the ship's lab from samples.
export const RESEARCH = [
  { id: 'jetpack_mk2', cost: { biosample: 3, mineral_sample: 3, aurum: 2 }, unlocks: 'jetpack_mk2' },
  { id: 'scanner_mk2', cost: { biosample: 2, mineral_sample: 2 }, unlocks: 'scanner_mk2' },
  { id: 'engine_mk2', cost: { mineral_sample: 4, aurum: 4, cobalt: 20 }, unlocks: 'engine_mk2' },
  { id: 'precursor_decoder', cost: { precursor_shard: 1, aurum: 3 }, unlocks: 'precursor_decoder' },
];

export class Tools {
  constructor(game) {
    this.game = game;
    this.mining = null;
    this.scanCooldown = 0;
    this.markers = [];
  }

  get state() {
    return this.game.state;
  }

  update(dt, input) {
    const g = this.game;
    this.scanCooldown = Math.max(0, this.scanCooldown - dt);
    for (const m of this.markers) m.ttl -= dt;
    this.markers = this.markers.filter((m) => m.ttl > 0);
    if (input.pressed('scan') && (g.mode === 'foot' || g.mode === 'pilot' || g.mode === 'vehicle')) this.scan();
    if (g.mode === 'foot') this.updateMining(dt, input);
    else { this.mining = null; g.effects.hideBeam(); }
  }

  // ---------------- scanner ----------------
  scan() {
    const g = this.game;
    if (this.scanCooldown > 0) { g.hud.toast('hud.scanner_cooling', 'warn'); return; }
    this.scanCooldown = 4;
    g.audio.play('scan');
    const st = this.state;
    st.stats.scans++;
    if (g.mode === 'pilot') return this.systemScan();
    const p = g.player;
    const body = g.mode === 'vehicle' ? g.skimmer.body : p.body;
    const pos = g.mode === 'vehicle' ? g.skimmer.pos : p.pos;
    if (!body) return;
    const radius = st.owned.scanner_mk2 ? 320 : 170;
    g.effects.scanPulse(body.spin, pos, radius);
    let found = 0;
    // Planet itself
    this.discoverPlanet(body);
    // Creatures
    for (const c of body.fauna.near(pos, radius)) {
      this.addMarker({ kind: 'fauna', label: c.sp.name, frame: body, local: c.pos, ref: c, color: c.sp.tier >= 3 ? '#ff5d5d' : '#72e08a' });
      if (st.discover('species', c.sp.id, { name: c.sp.name, kind: 'fauna', body: body.id, diet: c.sp.diet })) {
        found++;
        this.reward('hud.new_species', { name: c.sp.name }, 60, 'science', 25);
        st.addItem('biosample', 1);
      }
    }
    // Plants (unique species within range)
    const seen = new Set();
    for (const pl of body.scatter.plantsNear(pos, Math.min(radius, 120))) {
      if (seen.has(pl.species.id)) continue;
      seen.add(pl.species.id);
      if (st.discover('species', pl.species.id, { name: pl.species.name, kind: 'flora', body: body.id, form: pl.species.form })) {
        found++;
        this.reward('hud.new_plant', { name: pl.species.name }, 35, 'science', 15);
        if (pl.species.medicinal || Math.random() < 0.4) st.addItem('biosample', 1);
      }
    }
    // Deposits
    for (const d of body.scatter.activeDeposits) {
      if (d.pos.distanceTo(pos) > radius) continue;
      this.addMarker({ kind: 'deposit', label: t(`item.${d.type}`), frame: body, local: d.pos, color: '#ffd24d', ttl: 40 });
    }
    // Hidden sites are only revealed by scanning nearby.
    if (body.ruin && body.ruin.localPos.distanceTo(pos) < radius * 4) {
      this.addMarker({ kind: 'signal', label: t('marker.unknown_signal'), frame: body, local: body.ruin.localPos, color: '#c78bff', ttl: 120 });
      g.director.onSignalScanned(body);
    }
    if (!found) g.hud.toast('hud.scan_complete', 'accent');
    g.events.emit('tool:scan', { body, found });
  }

  systemScan() {
    const g = this.game;
    const uni = g.universe;
    const shipWorld = g.ship.worldPosition(new THREE.Vector3());
    g.hud.toast('hud.system_scan', 'accent');
    for (const b of uni.bodies) {
      const d = shipWorld.distanceTo(b.anchor.position);
      if (d < b.radius * 60) this.discoverPlanet(b);
    }
    for (const a of uni.anomalies) {
      const d = shipWorld.distanceTo(a.group.position);
      if (d < 4e6 || !a.def.hidden) {
        this.addMarker({ kind: a.def.type, label: t(`anomaly.${a.def.type}`), world: a.group.position.clone(), color: a.def.type === 'black_hole' ? '#ff7b3d' : '#c78bff', ttl: 180 });
      }
    }
  }

  discoverPlanet(body) {
    const st = this.state;
    if (st.discover('planets', body.id, { name: body.def.name, type: body.def.type, system: st.location.systemId })) {
      this.reward(body.def.home ? 'hud.planet_logged' : 'hud.first_discovery_named', { name: body.def.name }, body.def.home ? 20 : 150, 'exploration', 40);
      if (!body.def.home) this.game.director.news('news.planet_discovered', { name: body.def.name, pilot: st.profile.name });
    }
  }

  reward(key, params, credits, skill, xp) {
    const st = this.state;
    st.credits += credits;
    const lvl = st.addXP(skill, xp);
    this.game.hud.discovery(key, params, credits);
    this.game.audio.play('discovery');
    if (lvl) this.game.hud.toast('hud.skill_up', 'accent', { skill: t(`skill.${skill}`), level: lvl });
  }

  addMarker(m) {
    this.markers = this.markers.filter((x) => !(x.ref && x.ref === m.ref) && !(x.local && m.local && x.local.distanceTo(m.local) < 0.5));
    this.markers.push({ ttl: 30, ...m });
  }

  // ---------------- mining ----------------
  updateMining(dt, input) {
    const g = this.game;
    const p = g.player;
    const body = p.body;
    if (!body || p.mode !== 'body') return;
    const holding = input.held('mine');
    if (!holding) {
      this.mining = null;
      g.effects.hideBeam();
      return;
    }
    const eye = body.spin.worldToLocal(p.eyeWorld(new THREE.Vector3()));
    const aimW = p.aimWorld(new THREE.Vector3());
    const aim = aimW.applyQuaternion(body.spin.getWorldQuaternion(new THREE.Quaternion()).invert());
    const dep = body.scatter.findDeposit(eye, aim, 8);
    // No deposit in reach: the multitool doubles as a defence beam.
    const foe = dep ? null : body.fauna.inAim(eye, aim, 45, g.settings.touchControls ? 0.16 : 0.08);
    if (foe) {
      this.mining = null;
      g.hud.setProgress(0);
      const tip = body.spin.worldToLocal(p.toolTip.getWorldPosition(new THREE.Vector3()));
      const target = foe.pos.clone().addScaledVector(foe.pos.clone().normalize(), foe.sp.size * 0.45);
      g.effects.showBeam(body.spin, g.cameraMode === 'third' ? eye : tip, target);
      if (Math.random() < dt * 25) g.effects.burst(body.spin, target, { count: 3, color: 0xff7a50, size: 0.08, speed: 4, life: 0.4 });
      if (body.fauna.damage(foe, dt * 40, eye)) {
        g.audio.play('explosion');
        g.touch?.buzz(30);
        g.effects.burst(body.spin, target, { count: 18, color: 0xffb070, size: 0.14, speed: 6, life: 0.8, up: target.clone().normalize(), gravity: 5 });
        const left = this.state.addItem('biosample', 1);
        if (!left) g.hud.pickup('biosample', 1);
        this.state.addXP('survival', 4);
      } else if (Math.random() < dt * 6) g.audio.play('hit');
      return;
    }
    if (!dep) {
      this.mining = null;
      g.effects.hideBeam();
      if (input.pressed('mine')) g.hud.toast('hud.nothing_to_mine', 'warn');
      return;
    }
    if (!this.mining || this.mining.dep !== dep) this.mining = { dep, t: 0 };
    this.mining.t += dt;
    const tipW = p.toolTip.getWorldPosition(new THREE.Vector3());
    const tip = body.spin.worldToLocal(tipW);
    const target = dep.pos.clone().addScaledVector(dep.pos.clone().normalize(), 0.5);
    g.effects.showBeam(body.spin, g.cameraMode === 'third' ? eye : tip, target);
    if (Math.random() < dt * 20) g.effects.burst(body.spin, target, { count: 2, color: DEPOSIT_TYPES[dep.type].glow ? 0x9fd8ff : 0xffb070, size: 0.06, speed: 3, life: 0.5 });
    const dur = dep.type === 'aurum' ? 2.4 : 1.4;
    g.hud.setProgress(this.mining.t / dur);
    if (this.mining.t >= dur) {
      const [a, b] = DEPOSIT_TYPES[dep.type].yield;
      const n = a + Math.floor(Math.random() * (b - a + 1)) + this.state.skillLevel('survival');
      const left = this.state.addItem(dep.type, n);
      if (left >= n) { g.hud.toast('hud.inventory_full', 'warn'); this.mining = null; return; }
      this.state.minedDeposits.add(dep.id);
      body.scatter.removeDeposit(dep);
      this.state.stats.mined++;
      if (Math.random() < 0.15) this.state.addItem('mineral_sample', 1);
      const lvl = this.state.addXP('survival', 6);
      if (lvl) g.hud.toast('hud.skill_up', 'accent', { skill: t('skill.survival'), level: lvl });
      g.hud.pickup(dep.type, n - left);
      g.audio.play('mine_done');
      g.effects.burst(body.spin, target, { count: 14, color: 0xcccccc, size: 0.12, speed: 5, life: 0.9, up: target.clone().normalize(), gravity: 6 });
      g.events.emit('tool:mined', { type: dep.type, n: n - left });
      this.mining = null;
      g.effects.hideBeam();
      g.hud.setProgress(0);
    }
  }

  // ---------------- items ----------------
  autoRefuelJetpack() {
    const st = this.state;
    if (!st.count('jet_fuel')) return false;
    st.removeItem('jet_fuel', 1);
    st.jetpack.refuel(JET_FUEL_PER_CANISTER);
    this.game.hud.toast('hud.jetpack_refueled', 'accent');
    return true;
  }

  useItem(id) {
    const st = this.state;
    const g = this.game;
    const v = st.vitals;
    switch (id) {
      case 'medkit': if (!st.removeItem(id)) return false; v.health = Math.min(100, v.health + 50); break;
      case 'ration': if (!st.removeItem(id)) return false; v.health = Math.min(100, v.health + 15); v.suitEnergy = Math.min(100, v.suitEnergy + 20); break;
      case 'water': if (!st.removeItem(id)) return false; v.suitEnergy = Math.min(100, v.suitEnergy + 15); break;
      case 'energy_cell': if (!st.removeItem(id)) return false; v.suitEnergy = 100; v.oxygen = Math.min(100, v.oxygen + 40); break;
      case 'jet_fuel':
        if (!st.jetpack.owned) { g.hud.toast('hud.no_jetpack', 'warn'); return false; }
        if (!st.removeItem(id)) return false; st.jetpack.refuel(JET_FUEL_PER_CANISTER); break;
      case 'fuel_cell': if (!st.removeItem(id)) return false; st.ship.refuel(50); break;
      case 'nitro_cell': {
        const r = st.ship.refillNitro(st.combined);
        if (!r.ok) { g.hud.toast(`hud.nitro_${r.reason}`, 'warn'); return false; }
        break;
      }
      case 'jetpack': case 'jetpack_mk2':
        if (!st.removeItem(id)) return false;
        st.jetpack.owned = true;
        st.jetpack.setModel(id === 'jetpack_mk2' ? 'mk2' : 'basic');
        st.jetpack.fuel = st.jetpack.spec.fuelCapacity;
        g.hud.banner('hud.jetpack_equipped', 'accent');
        g.events.emit('item:jetpack');
        break;
      case 'scanner_mk2': if (!st.removeItem(id)) return false; st.owned.scanner_mk2 = true; break;
      case 'engine_mk2': if (!st.removeItem(id)) return false; st.ship.engineTier = 2; break;
      case 'cargo_ext': if (!st.removeItem(id)) return false; st.cargo.slots += 12; break;
      case 'skimmer': if (!st.removeItem(id)) return false; st.owned.skimmer = true; g.hud.toast('hud.skimmer_owned', 'accent'); break;
      case 'base_kit': return this.deployBase();
      default: return false;
    }
    g.audio.play('buy');
    return true;
  }

  deployBase() {
    const g = this.game;
    const st = this.state;
    const p = g.player;
    if (g.mode !== 'foot' || !p.body || !p.grounded) { g.hud.toast('hud.base_need_ground', 'warn'); return false; }
    if (p.body.city && p.body.city.toCity(p.pos) && Math.hypot(p.body.city.toCity(p.pos).x, p.body.city.toCity(p.pos).z) < 400) { g.hud.toast('hud.base_too_close_city', 'warn'); return false; }
    if (!st.removeItem('base_kit')) return false;
    const id = `base-${Date.now().toString(36)}`;
    const base = { id, system: st.location.systemId, body: p.body.id, pos: p.pos.toArray(), name: t('base.default_name', { n: st.bases.length + 1 }), storage: new Inventory(30), modules: ['core'] };
    st.bases.push(base);
    g.director.buildBaseVisual(base);
    g.hud.banner('hud.base_deployed', 'accent');
    st.addXP('engineering', 40);
    g.events.emit('base:deployed', base);
    return true;
  }

  craft(recipe) {
    const st = this.state;
    for (const [id, n] of Object.entries(recipe.cost)) if (st.count(id) < n) return { ok: false, reason: 'missing' };
    for (const [id, n] of Object.entries(recipe.cost)) st.removeItem(id, n);
    const left = st.addItem(recipe.out, recipe.n);
    st.addXP(recipe.skill, 10);
    return { ok: left === 0, reason: left ? 'full' : null };
  }

  research(r) {
    const st = this.state;
    st.story.research = st.story.research || {};
    if (st.story.research[r.id]) return { ok: false, reason: 'done' };
    for (const [id, n] of Object.entries(r.cost)) if (st.count(id) < n) return { ok: false, reason: 'missing' };
    for (const [id, n] of Object.entries(r.cost)) st.removeItem(id, n);
    st.story.research[r.id] = st.time;
    st.addXP('science', 60);
    if (r.unlocks === 'precursor_decoder') {
      st.story.flags.decoded = true;
      this.game.director.onDecoded();
    } else {
      st.addItem(r.unlocks, 1);
    }
    return { ok: true };
  }

  analyzeSamples() {
    const st = this.state;
    const bio = st.count('biosample'), min = st.count('mineral_sample');
    if (!bio && !min) return { ok: false };
    // Keep samples needed for research; analyse extras into data credits.
    const credits = bio * 45 + min * 30;
    st.removeItem('biosample', bio);
    st.removeItem('mineral_sample', min);
    st.credits += credits;
    st.addXP('science', (bio + min) * 8);
    return { ok: true, credits };
  }

  // ---------------- trade ----------------
  discount() {
    return reputationDiscount(this.state.reputation.veyari || 0);
  }

  canTrade() {
    return reputationTier(this.state.reputation.veyari || 0) !== 'hostile';
  }

  buy(market, id, n = 1) {
    const st = this.state;
    const price = market.price(id, 'buy', this.discount()) * n;
    if (st.credits < price) return { ok: false, reason: 'credits' };
    if (!st.suit.canAdd(id, n) && !st.cargo.canAdd(id, n)) return { ok: false, reason: 'full' };
    st.credits -= price;
    st.addItem(id, n);
    market.recordPurchase(id, n);
    st.addXP('diplomacy', 2);
    st.reputation.veyari = (st.reputation.veyari || 0) + 0.3 * n;
    this.game.events.emit('trade:buy', { id, n });
    return { ok: true, price };
  }

  sell(market, id, n = 1) {
    const st = this.state;
    n = Math.min(n, st.count(id));
    if (!n) return { ok: false };
    const price = market.price(id, 'sell', this.discount()) * n;
    st.removeItem(id, n);
    st.credits += price;
    market.recordSale(id, n);
    st.addXP('diplomacy', 1 + Math.floor(n / 10));
    st.reputation.veyari = (st.reputation.veyari || 0) + 0.1 * Math.min(n, 20);
    this.game.events.emit('trade:sell', { id, n, price });
    return { ok: true, price };
  }

  // ---------------- misc ----------------
  expeditionCheck() {
    const st = this.state;
    return checkExpedition({ ship: st.ship, jetpack: st.jetpack, count: (id) => st.count(id), cargoFree: st.cargo.freeSlots() }, st.ship.lightbreakCost(true, this.game.navTarget?.distance));
  }

  nearShelter() {
    const g = this.game;
    const p = g.player;
    if (!p.body) return false;
    if (p.body.city && p.body.city.buildingAt(p.pos, 10)) return true;
    for (const b of this.state.bases) {
      if (b.body === p.body.id && new THREE.Vector3(...b.pos).distanceTo(p.pos) < 12) return true;
    }
    return false;
  }

  randomLoot(seed) {
    const rng = new RNG(seed);
    return rng.pick([['aurum', 3], ['cobalt', 15], ['nitro_cell', 1], ['repair_kit', 2], ['fuel_cell', 1]]);
  }
}
