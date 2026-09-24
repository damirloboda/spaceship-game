// Points of interest in play: builds the nearby sites lazily, animates them,
// discovers them as the player (or low-flying ship) arrives, hands out loot
// and logs, and provides HUD markers and "E" interactions.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { t } from '../i18n/index.js';
import { POI_BUILDERS, poiContext } from '../render/poiModels.js';
import { mergeStatic } from '../render/mergeStatic.js';

const BUILD_RANGE = 5000;
const DROP_RANGE = 8000;
const COLORS = { ruins: '#7fe8ff', crash: '#ff8a5d', outpost: '#39d0ff', camp: '#ffc070', monolith: '#c78bff', fossil: '#e8dcc0', crystals: '#9fe8ff' };
const ICONS = { ruins: '⌂', crash: '✦', outpost: '⌂', camp: '▲', monolith: '▮', fossil: '☗', crystals: '◆' };
const tv = new THREE.Vector3();

export class POISystem {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.revealed = new Set();
  }

  get st() { return this.game.state; }

  record(id) {
    const s = this.st.story;
    if (!s.poi) s.poi = {};
    if (!s.poi[id]) s.poi[id] = { d: 0, l: {} };
    return s.poi[id];
  }

  isFound(p) { return !!this.st.story.poi?.[p.id]?.d; }

  name(p) { return t(`poi.name.${p.kind}`); }

  // Body-local position of a site's origin on the ground.
  place(body, p) {
    if (p.local) return p.local;
    const up = new THREE.Vector3(...p.dir);
    const r = body.surface.radius + body.surface.heightAt(up.x, up.y, up.z);
    p.local = up.clone().multiplyScalar(r);
    return p.local;
  }

  build(body, p) {
    const builder = POI_BUILDERS[p.kind];
    if (!builder) return;
    const obj = builder(new RNG(p.seed), poiContext(body.def));
    const up = new THREE.Vector3(...p.dir);
    obj.group.position.copy(this.place(body, p));
    obj.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    obj.group.rotateY(p.heading);
    obj.group.name = `poi:${p.kind}`;
    mergeStatic(obj.group);
    body.spin.add(obj.group);
    obj.group.updateMatrix();
    // Loot points in body-local coordinates.
    obj.lootLocal = obj.loot.map((l) => ({ ...l, local: l.pos.clone().applyMatrix4(obj.group.matrix) }));
    p.obj = obj;
  }

  unbuild(p) {
    const o = p.obj;
    if (!o) return;
    o.dispose?.();
    o.group.removeFromParent();
    o.group.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
    p.obj = null;
  }

  // Where the player's attention is: walker, rider or low-flying ship.
  focus() {
    const g = this.game;
    if (g.mode === 'pilot' && g.ship.body) return { body: g.ship.body, pos: g.ship.root.position, flying: true };
    if (g.mode === 'vehicle' && g.skimmer.body) return { body: g.skimmer.body, pos: g.skimmer.pos, flying: false };
    if (g.player?.mode === 'body' && g.player.body) return { body: g.player.body, pos: g.player.pos, flying: false };
    return null;
  }

  update(dt) {
    this.time += dt;
    const f = this.focus();
    if (this.lastBody && (!f || f.body !== this.lastBody)) {
      for (const p of this.lastBody.pois || []) this.unbuild(p);
    }
    this.lastBody = f?.body || null;
    if (!f || !f.body.pois) return;
    const body = f.body;
    for (const p of body.pois) {
      const d = this.place(body, p).distanceTo(f.pos);
      if (!p.obj && d < BUILD_RANGE) this.build(body, p);
      else if (p.obj && d > DROP_RANGE) this.unbuild(p);
      if (!p.obj) continue;
      if (d < 3500) p.obj.update(dt, this.time, d < 500);
      // Discovery on arrival (on foot, or flying low over it).
      const alt = f.flying ? this.game.ship.altitude : 0;
      if (!this.isFound(p) && (f.flying ? d < 400 && alt < 250 : d < 90)) this.discover(p);
    }
  }

  discover(p) {
    const rec = this.record(p.id);
    rec.d = 1;
    const g = this.game;
    const name = this.name(p);
    this.st.discover('sites', p.id, { name, kind: p.kind });
    g.tools.reward('poi.discovered', { name }, 60, 'exploration', 40);
  }

  // Scanner pulse: nearby unknown sites become markers.
  reveal(body, pos, radius) {
    let n = 0;
    for (const p of body.pois || []) {
      if (this.place(body, p).distanceTo(pos) < radius && !this.revealed.has(p.id)) { this.revealed.add(p.id); n++; }
    }
    if (n) this.game.hud.toast('poi.revealed', 'accent', { n });
    return n;
  }

  revealAll(body) {
    for (const p of body.pois || []) this.revealed.add(p.id);
  }

  markers() {
    const f = this.focus();
    if (!f || !f.body.pois) return [];
    const out = [];
    for (const p of f.body.pois) {
      const local = this.place(f.body, p);
      const d = local.distanceTo(f.pos);
      const found = this.isFound(p);
      if (!found && !this.revealed.has(p.id) && d > 2500) continue;
      if (d > (f.flying ? 30000 : 6000)) continue;
      const w = f.body.toWorld(tv.copy(local).addScaledVector(local.clone().normalize(), 8));
      out.push({ label: found ? this.name(p) : t('poi.unknown'), world: w.clone(), color: found ? COLORS[p.kind] : '#ffd27a', icon: found ? ICONS[p.kind] : '?' });
    }
    return out;
  }

  // "E" on foot next to a loot point.
  interaction(body, pos) {
    for (const p of body.pois || []) {
      if (!p.obj) continue;
      for (const l of p.obj.lootLocal) {
        if (l.local.distanceTo(pos) > 4) continue;
        const done = this.record(p.id).l[l.key];
        const repeat = l.key === 'trade';
        if (done && !repeat) return { key: 'poi.searched', action: () => this.game.hud.toast('poi.empty', 'info') };
        return { key: `poi.act.${l.key}`, action: () => this.use(body, p, l) };
      }
    }
    return null;
  }

  use(body, p, l) {
    const g = this.game, st = this.st;
    const rec = this.record(p.id);
    if (!rec.d) this.discover(p);
    const rng = new RNG(p.seed ^ l.key.length * 131);
    const v = rng.int(1, 3);
    const got = [];
    const give = (id, n) => { if (n > 0) { st.addItem(id, n); got.push(`${t(`item.${id}`)} ×${n}`); } };
    const log = (kind) => g.menus.open('log', { title: this.name(p), lines: [t(`poi.log.${kind}${v}a`), t(`poi.log.${kind}${v}b`), got.length ? t('poi.found', { items: got.join(', ') }) : ''].filter(Boolean) });
    switch (l.key) {
      case 'trade':
        g.menus.open('shop_market', { market: g.market(`${p.id}/camp`) });
        return;
      case 'altar': give('relic', 1); give('precursor_shard', rng.next() < 0.25 ? 1 : 0); st.credits += 250; st.addXP('exploration', 80); log('ruins'); break;
      case 'blackbox': st.credits += 150; st.addXP('exploration', 40); log('crash'); break;
      case 'salvage': give('ferrite', rng.int(12, 26)); give('cobalt', rng.int(3, 8)); give('fuel_cell', rng.int(0, 1)); give('repair_kit', rng.int(0, 1)); g.hud.toast('poi.found', 'accent', { items: got.join(', ') }); break;
      case 'supplies': give('medkit', 1); give('energy_cell', rng.int(1, 3)); give('ration', rng.int(2, 4)); give('water', rng.int(2, 4)); g.hud.toast('poi.found', 'accent', { items: got.join(', ') }); break;
      case 'datalog': st.credits += 120; st.addXP('science', 40); log('outpost'); break;
      case 'totem': {
        const vt = st.vitals;
        vt.health = 100; vt.oxygen = 100; vt.suitEnergy = 100;
        st.addXP('exploration', 30);
        log('camp');
        break;
      }
      case 'touch': this.revealAll(body); st.addXP('science', 150); st.addXP('exploration', 100); log('monolith'); g.hud.banner('poi.monolith_banner', 'accent'); break;
      case 'fossil': give('fossil', 1); give('mineral_sample', 2); st.addXP('science', 80); log('fossil'); break;
      case 'crystal': give('crystal_core', rng.int(2, 4)); give('aurum', rng.int(1, 3)); st.addXP('exploration', 40); g.hud.toast('poi.found', 'accent', { items: got.join(', ') }); break;
      default: break;
    }
    rec.l[l.key] = 1;
    g.audio.play('discovery');
  }
}
