// The Director runs everything that makes the galaxy feel alive: the
// action-based tutorial, NPC side stories, the Precursor mystery, random
// events (signals, distress calls, meteor showers, migrations, outages),
// radio chatter and the Galactic News Network, navigation targets and bases.
import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { RNG, hashString } from '../core/rng.js';
import { offsetOnSphere, tangentFrame } from '../world/planetGen.js';
import { colorize, merge } from '../render/models.js';
import { systemsNear, systemPosition, summarizeSystem, HOME_SYSTEM_ID } from '../world/galaxy.js';

export const TUTORIAL = [
  { id: 'move', check: (g) => g.state.stats.distance > 12 },
  { id: 'scan', check: (g) => g.state.stats.scans > 0 },
  { id: 'mine', check: (g) => g.state.stats.mined >= 3 },
  { id: 'city', check: (g) => g.director.distToCity() < 320 },
  { id: 'sell', check: (g) => g.state.story.flags.sold },
  { id: 'jetpack', check: (g) => g.state.jetpack.owned },
  { id: 'fly_jetpack', check: (g) => (g.state.story.flags.jetTime || 0) > 2 },
  { id: 'nitro', check: (g) => g.state.count('nitro') > 0 || g.state.ship.nitro.installed },
  { id: 'install', check: (g) => g.state.ship.nitro.installed },
  { id: 'takeoff', check: (g) => g.state.story.flags.tookOff },
  { id: 'orbit', check: (g) => g.state.story.flags.reachedSpace },
  { id: 'overdrive', check: (g) => (g.state.story.flags.overdriveTime || 0) > 2 },
  { id: 'lightbreak', check: (g) => g.state.ship.lightbreak.state === 'ready' || g.state.stats.jumps > 0 },
  { id: 'jump', check: (g) => g.state.stats.jumps > 0 },
  { id: 'land_new', check: (g) => g.state.story.flags.landedElsewhere },
];

const RADIO = ['radio.traffic', 'radio.weather', 'radio.market', 'radio.music', 'radio.pilgrims', 'radio.static'];

export class Director {
  constructor(game) {
    this.game = game;
    this.radioTimer = 40;
    this.eventTimer = 120;
    this.questObjects = [];
    this.baseMeshes = [];
    this.signalAnnounced = new Set();
    this.meteorShower = null;
  }

  get state() {
    return this.game.state;
  }

  onGameStart(isNew) {
    const g = this.game;
    const st = this.state;
    if (isNew) {
      st.story.flags = {};
      setTimeout(() => g.hud.banner('hud.welcome', 'accent', { name: st.profile.name }, 'hud.welcome_sub'), 800);
      this.news('news.welcome', {});
    }
    const bus = g.events;
    if (!this.bound) {
      this.bound = true;
      bus.on('trade:sell', () => { st.story.flags.sold = true; });
      bus.on('ship:takeoff', () => { st.story.flags.tookOff = true; });
      bus.on('ship:landed', ({ body }) => {
        if (body && !body.def.home && body.id !== 'home/tessa') st.story.flags.landedElsewhere = true;
        if (body) g.tools.discoverPlanet(body);
        g.save(true);
      });
      bus.on('ship:docked', (station) => { g.hud.banner('hud.docked', 'accent', { name: station.name }); g.save(true); });
      bus.on('weather:storm', ({ body }) => { if (body === g.activeBody) g.hud.radio('radio.storm_warning', { planet: body.def.name }); });
    }
  }

  onSystemLoaded(sys) {
    this.questObjects.forEach((o) => o.mesh.removeFromParent());
    this.questObjects = [];
    this.baseMeshes.forEach((m) => m.removeFromParent());
    this.baseMeshes = [];
    for (const b of this.state.bases) if (b.system === sys.id) this.buildBaseVisual(b);
    this.state.discover('systems', sys.id, { name: sys.name, star: sys.star.type });
    this.game.navTarget = null;
    if (sys.id === HOME_SYSTEM_ID) this.spawnQuestObjects();
  }

  // ---------------- tutorial ----------------
  currentObjective() {
    const tut = this.state.tutorial;
    if (tut.done) return null;
    return TUTORIAL[tut.step] || null;
  }

  updateTutorial() {
    const tut = this.state.tutorial;
    if (tut.done) return;
    // Steps can be completed out of order; skip past any already satisfied.
    let advanced = false;
    while (TUTORIAL[tut.step] && TUTORIAL[tut.step].check(this.game)) {
      tut.step++;
      advanced = true;
    }
    if (advanced) {
      this.game.audio.play('ui');
      if (tut.step >= TUTORIAL.length) {
        tut.done = true;
        this.game.hud.banner('hud.tutorial_done', 'accent', {}, 'hud.tutorial_done_sub');
        this.state.credits += 500;
      }
    }
  }

  distToCity() {
    const g = this.game;
    const body = g.player.body;
    if (!body?.city || g.player.mode !== 'body') return Infinity;
    return new THREE.Vector3(...body.city.dir).multiplyScalar(body.city.groundR).distanceTo(g.player.pos);
  }

  // ---------------- per frame ----------------
  update(dt) {
    const g = this.game;
    const st = this.state;
    const f = st.story.flags;
    if (g.player.jetActive) f.jetTime = (f.jetTime || 0) + dt;
    if (g.ship.overdrive && g.mode === 'pilot') f.overdriveTime = (f.overdriveTime || 0) + dt;
    if (g.mode === 'pilot' && g.ship.body && !g.ship.inAtmosphere() && !f.reachedSpace) {
      f.reachedSpace = true;
      g.hud.banner('hud.orbit_reached', 'accent');
      if (st.location.systemId === HOME_SYSTEM_ID) setTimeout(() => this.distressCall(), 6000);
    }
    this.updateTutorial();
    this.radioTimer -= dt;
    if (this.radioTimer <= 0) {
      this.radioTimer = 70 + Math.random() * 80;
      this.radioChatter();
    }
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 150 + Math.random() * 200;
      this.randomEvent();
    }
    this.updateSignals(dt);
    this.updateMeteorShower(dt);
    for (const o of this.questObjects) {
      if (o.light) o.light.visible = Math.sin(performance.now() / 250) > 0;
    }
    for (const m of this.baseMeshes) if (m.userData.beacon) m.userData.beacon.visible = Math.sin(performance.now() / 400) > -0.3;
    // Hazard warnings for black holes
    if (g.ship.hazard === 'gravity' && g.mode === 'pilot') {
      this.hazardTimer = (this.hazardTimer || 0) - dt;
      if (this.hazardTimer <= 0) {
        this.hazardTimer = 6;
        g.hud.banner('hud.gravity_extreme', 'danger', {}, 'hud.systems_stress');
        g.audio.play('alarm');
      }
    }
  }

  radioChatter() {
    const g = this.game;
    if (g.state.location.systemId !== HOME_SYSTEM_ID && Math.random() < 0.6) {
      g.hud.radio('radio.static', {});
      return;
    }
    const key = RADIO[Math.floor(Math.random() * RADIO.length)];
    g.hud.radio(key, { station: 'Meridian', planet: 'Aurel' });
  }

  randomEvent() {
    const g = this.game;
    const body = g.activeBody;
    const r = Math.random();
    if (body && body.def.atmosphere && g.player.mode === 'body' && (g.localHour > 19 || g.localHour < 4) && r < 0.45) {
      this.startMeteorShower(body);
    } else if (body?.city && r < 0.6) {
      const kind = ['outage', 'epidemic', 'festival', 'migration'][Math.floor(Math.random() * 4)];
      this.worldEvent(body, kind);
    } else if (r < 0.8) {
      const m = g.market(`${body?.id || 'x'}/city`);
      m.eventMod = 0.8 + Math.random() * 0.5;
      this.news(m.eventMod > 1 ? 'news.shortage' : 'news.surplus', { planet: body?.def.name || '—' });
    } else if (g.mode === 'pilot' && !g.ship.body) {
      this.distressCall();
    }
  }

  worldEvent(body, kind) {
    const g = this.game;
    if (kind === 'outage') {
      const mat = body.city.glowMat;
      const prev = mat.emissive.clone();
      mat.emissive.setRGB(0.05, 0.02, 0.02);
      setTimeout(() => mat.emissive.copy(prev), 60000);
      this.news('news.outage', { city: body.city.name });
      g.hud.radio('radio.outage', { city: body.city.name });
    } else if (kind === 'epidemic') {
      g.market(`${body.id}/city`).entry('medkit').pressure = 0.8;
      this.news('news.epidemic', { city: body.city.name });
    } else if (kind === 'festival') {
      g.state.reputation.veyari = (g.state.reputation.veyari || 0) + 2;
      this.news('news.festival', { city: body.city.name });
    } else if (kind === 'migration' && g.player.mode === 'body' && g.player.body === body) {
      const herb = body.faunaSpecies.filter((s) => s.tier === 1);
      if (herb.length) {
        const sp = herb[Math.floor(Math.random() * herb.length)];
        const up = g.player.pos.clone().normalize();
        const dir = up.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(up).normalize().multiplyScalar(90 / body.radius)).normalize();
        body.fauna.spawnNear(dir.multiplyScalar(body.groundRadius(dir)), sp, 8, new RNG(Date.now()));
        g.hud.radio('radio.migration', { species: sp.name });
      }
    }
  }

  startMeteorShower(body) {
    this.meteorShower = { body, t: 60, next: 0 };
    this.game.hud.radio('radio.meteors', { planet: body.def.name });
    this.news('news.meteors', { planet: body.def.name });
  }

  updateMeteorShower(dt) {
    const m = this.meteorShower;
    if (!m) return;
    const g = this.game;
    m.t -= dt;
    m.next -= dt;
    if (m.t <= 0 || g.player.body !== m.body) { this.meteorShower = null; return; }
    if (m.next <= 0) {
      m.next = 0.4 + Math.random() * 1.5;
      const p = g.player.pos;
      const up = p.clone().normalize();
      const f = tangentFrame([up.x, up.y, up.z]);
      const rand = (s) => offsetOnSphere([up.x, up.y, up.z], f, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s, m.body.radius);
      const from = new THREE.Vector3(...rand(3000)).multiplyScalar(m.body.radius + 2500);
      const impact = Math.random() < 0.18;
      const toDir = new THREE.Vector3(...rand(impact ? 900 : 5000));
      const to = impact ? toDir.clone().multiplyScalar(m.body.groundRadius(toDir)) : toDir.multiplyScalar(m.body.radius + 600);
      g.effects.meteor(m.body, from, to, impact);
    }
  }

  // ---------------- signals & mysteries ----------------
  updateSignals(dt) {
    const g = this.game;
    const p = g.player;
    if (p.mode !== 'body' || !p.body?.ruin) return;
    const d = p.body.ruin.localPos.distanceTo(p.pos);
    g.hud.setSignal(d < 2500 && !this.state.story.flags.ruinVisited ? 1 - d / 2500 : 0);
    if (d < 2500 && !this.signalAnnounced.has(p.body.id)) {
      this.signalAnnounced.add(p.body.id);
      g.hud.banner('hud.unknown_signal', 'accent', {}, 'hud.unknown_signal_sub');
      g.audio.play('signal');
    }
  }

  onSignalScanned() {
    this.state.story.flags.signalTriangulated = true;
  }

  useRuinTerminal(body) {
    const g = this.game;
    const st = this.state;
    const first = !st.story.flags.ruinVisited;
    st.story.flags.ruinVisited = true;
    g.menus.open('log', {
      title: t('ruin.title'),
      lines: [t('ruin.l1'), t('ruin.l2'), t('ruin.l3'), first ? t('ruin.found_shard') : t('ruin.empty')],
      warning: t('ruin.active'),
    });
    if (first) {
      st.addItem('precursor_shard', 1);
      st.discover('sites', `${body.id}/ruin`, { name: t('ruin.title') });
      st.addXP('exploration', 120);
      st.addXP('science', 60);
      st.credits += 300;
      this.news('news.ruin', { planet: body.def.name });
      g.audio.play('discovery');
      body.ruin.core.material.color.setRGB(2, 0.3, 0.3);
    }
  }

  onDecoded() {
    // The shard points to a far system: the next step of the main story.
    const st = this.state;
    const near = systemsNear(systemPosition(HOME_SYSTEM_ID), 70).filter((s) => !s.unknownRegion);
    const target = near[Math.min(near.length - 1, 9)];
    st.story.flags.precursorTarget = target?.id || null;
    this.game.menus.open('log', { title: t('story.decoded_title'), lines: [t('story.decoded_l1'), t('story.decoded_l2', { name: target?.name || '???' })], warning: t('story.decoded_warn') });
  }

  // ---------------- distress / derelict / wormhole ----------------
  distressCall() {
    const g = this.game;
    const d = g.universe.anomalies.find((a) => a.def.type === 'derelict' && !this.state.story.flags[`rescued:${a.def.id}`]);
    if (!d) return;
    d.def.hidden = false;
    g.tools.addMarker({ kind: 'distress', label: t('marker.distress'), world: d.group.position.clone(), color: '#ff5d5d', ttl: 900 });
    g.hud.banner('hud.distress', 'danger', {}, 'hud.distress_sub');
    g.audio.play('alarm');
    g.navTarget = { kind: 'distress', label: t('marker.distress'), world: () => d.group.position.clone(), arrive: 400 };
  }

  derelictNear() {
    const g = this.game;
    const w = g.ship.worldPosition(new THREE.Vector3());
    return g.universe.anomalies.find((a) => a.def.type === 'derelict' && !this.state.story.flags[`rescued:${a.def.id}`] && a.group.position.distanceTo(w) < 450 && g.ship.speed < 120) || null;
  }

  rescue(d) {
    const g = this.game;
    const st = this.state;
    st.story.flags[`rescued:${d.def.id}`] = true;
    const [item, n] = g.tools.randomLoot(hashString(d.def.id));
    st.addItem(item, n);
    st.credits += 400;
    st.reputation.veyari = (st.reputation.veyari || 0) + 8;
    st.addXP('piloting', 40);
    g.hud.banner('hud.rescued', 'accent', { item: t(`item.${item}`), n, credits: 400 });
    this.news('news.rescue', { pilot: st.profile.name });
    if (d.beacon) d.beacon.material.color.set(0x30ff60);
  }

  wormholeNear() {
    const g = this.game;
    const w = g.ship.worldPosition(new THREE.Vector3());
    return g.universe.anomalies.find((a) => a.def.type === 'wormhole' && a.group.position.distanceTo(w) < a.def.radius * 6) || null;
  }

  enterWormhole(wh) {
    const g = this.game;
    // Wormholes lead somewhere far and unpredictable.
    const rng = new RNG(hashString(wh.def.id) ^ Math.floor(this.state.time / 600));
    const here = systemPosition(this.state.location.systemId);
    const far = systemsNear([here[0] + rng.range(-400, 400), here[1], here[2] + rng.range(-400, 400)], 40);
    const dest = far[0] || { id: HOME_SYSTEM_ID };
    const sys = g.state.ship;
    sys.lightbreak.state = 'ready';
    // Wormholes do not cost fuel.
    const fuel = sys.fuel;
    sys.fuel = 1e6;
    g.ship.engageLightbreak({ systemId: dest.id, via: 'wormhole' });
    sys.fuel = fuel;
    g.hud.banner('hud.wormhole_entered', 'accent');
  }

  // ---------------- navigation ----------------
  navCandidates() {
    const g = this.game;
    const out = [];
    for (const b of g.universe.bodies) {
      out.push({ kind: b.def.kind, label: g.state.isDiscovered('planets', b.id) || b.def.home ? b.def.name : t('marker.unknown_world'), world: () => b.anchor.getWorldPosition(new THREE.Vector3()), arrive: b.atmoTop * 1.4 + 3000, body: b });
      if (b.station) out.push({ kind: 'station', label: b.station.name, world: () => b.station.dockWorld(new THREE.Vector3()), arrive: 1200 });
    }
    for (const m of g.tools.markers) if (m.world) out.push({ kind: m.kind, label: m.label, world: () => m.world.clone(), arrive: 500 });
    return out;
  }

  cycleTarget() {
    const list = this.navCandidates();
    if (!list.length) return;
    const i = list.findIndex((c) => c.label === this.game.navTarget?.label);
    this.game.navTarget = list[(i + 1) % list.length];
    this.game.hud.toast('hud.target_set', 'accent', { name: this.game.navTarget.label });
  }

  setInterstellarTarget(summary) {
    const g = this.game;
    const here = systemPosition(this.state.location.systemId);
    const dir = new THREE.Vector3(summary.position[0] - here[0], summary.position[1] - here[1], summary.position[2] - here[2]).normalize();
    g.navTarget = { kind: 'system', systemId: summary.id, label: summary.name, direction: dir, world: null, distance: Math.hypot(summary.position[0] - here[0], summary.position[1] - here[1], summary.position[2] - here[2]) };
    g.hud.toast('hud.jump_target', 'accent', { name: summary.name });
  }

  // ---------------- quests ----------------
  spawnQuestObjects() {
    const g = this.game;
    const home = g.homeBody();
    if (!home?.city) return;
    const q = this.state.quests;
    if (!q.done.lost_drone && !this.state.count('drone_part')) {
      const s = home.surface;
      const city = home.city;
      const dir = offsetOnSphere(city.dir, city.frame, -700, 420, home.radius);
      const up = new THREE.Vector3(...dir);
      const r = home.groundRadius(up);
      const parts = [];
      const body = new THREE.BoxGeometry(1.2, 0.4, 1.2);
      parts.push(colorize(body, [0.8, 0.8, 0.85]));
      for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        const rotor = new THREE.CylinderGeometry(0.45, 0.45, 0.05, 10);
        rotor.translate(x, 0.25, z);
        parts.push(colorize(rotor, [0.2, 0.2, 0.22]));
      }
      const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
      mesh.position.copy(up).multiplyScalar(r + 0.2);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      mesh.rotateZ(0.4);
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
      light.position.y = 0.4;
      mesh.add(light);
      home.spin.add(mesh);
      this.questObjects.push({ id: 'lost_drone', mesh, light, local: mesh.position.clone(), body: home });
    }
    // Ecosystem-aware: no marker unless the quest is active.
  }

  questPickupNear(body, pos) {
    for (const o of this.questObjects) {
      if (o.body === body && o.local.distanceTo(pos) < 3) {
        return {
          key: 'prompt.pick_up_drone',
          action: () => {
            this.state.addItem('drone_part', 1);
            o.mesh.removeFromParent();
            this.questObjects.splice(this.questObjects.indexOf(o), 1);
            this.game.hud.toast('hud.drone_found', 'accent');
          },
        };
      }
    }
    return null;
  }

  questMarkers() {
    const out = [];
    const q = this.state.quests.active;
    if (q.lost_drone) for (const o of this.questObjects) out.push({ label: t('marker.lost_drone'), frame: o.body, local: o.local, color: '#6bd6ff' });
    return out;
  }

  // Dialogue options for a citizen, including their side story.
  dialogFor(npc) {
    const c = npc.c;
    const st = this.state;
    const lines = [t(`npc.greet.${c.personality}`, { name: st.profile.name }), t(`npc.job.${c.profession}`)];
    const options = [];
    const story = c.story;
    if (story) {
      const q = st.quests;
      if (story.id === 'lost_drone') {
        if (q.done.lost_drone) lines.push(t('quest.lost_drone.thanks'));
        else if (st.count('drone_part')) options.push({ key: 'quest.lost_drone.return', action: () => this.completeDrone(npc) });
        else if (q.active.lost_drone) lines.push(t('quest.lost_drone.remind'));
        else options.push({ key: 'quest.lost_drone.accept', action: () => { q.active.lost_drone = { t: st.time }; this.game.hud.toast('hud.quest_accepted', 'accent'); } });
      } else if (story.id === 'sample_request') {
        if (q.done.sample_request) lines.push(t('quest.sample.thanks'));
        else if (st.count('cobalt') >= story.count) options.push({ key: 'quest.sample.deliver', action: () => { st.removeItem('cobalt', story.count); st.credits += story.reward; q.done.sample_request = true; st.reputation.veyari += 6; this.game.hud.toast('hud.quest_done', 'accent', { credits: story.reward }); } });
        else lines.push(t('quest.sample.ask', { n: story.count }));
      } else if (story.id === 'moon_signal') {
        lines.push(t('quest.moon_signal'));
      } else if (story.id === 'old_pilot') {
        lines.push(t('quest.old_pilot'));
      } else if (story.id === 'merchant_price') {
        lines.push(t('quest.merchant_tip'));
      }
    }
    if (c.profession === 'merchant') options.push({ key: 'dialog.trade', action: () => this.game.menus.open('shop_market', { market: this.game.market(`${this.game.player.body.id}/city`) }) });
    if (c.profession === 'mechanic' || c.profession === 'engineer') options.push({ key: 'dialog.equipment', action: () => this.game.menus.open('shop_equipment', { market: this.game.market(`${this.game.player.body.id}/city`) }) });
    options.push({ key: 'dialog.rumor', action: () => this.game.hud.radio(`rumor.${Math.floor(Math.random() * 6)}`, {}) });
    options.push({ key: 'dialog.hire', action: () => this.game.hud.toast('hud.no_crew_berth', 'warn') });
    st.reputation.veyari = (st.reputation.veyari || 0) + 0.2;
    st.addXP('diplomacy', 1);
    npc.talkTimer = 8;
    return { lines, options };
  }

  completeDrone() {
    const st = this.state;
    st.removeItem('drone_part', 1);
    st.quests.done.lost_drone = true;
    delete st.quests.active.lost_drone;
    st.addItem('nitro', 1);
    st.credits += 200;
    st.reputation.veyari = (st.reputation.veyari || 0) + 10;
    this.game.hud.banner('hud.nitro_reward', 'accent');
  }

  // ---------------- bases ----------------
  buildBaseVisual(base) {
    const g = this.game;
    const body = g.universe.body(base.body);
    if (!body) return;
    const up = new THREE.Vector3(...base.pos).normalize();
    const parts = [];
    const dome = new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    parts.push(colorize(dome, [0.9, 0.92, 0.95]));
    const ring = new THREE.CylinderGeometry(4.3, 4.3, 0.6, 16);
    ring.translate(0, 0.3, 0);
    parts.push(colorize(ring, [0.95, 0.5, 0.15]));
    const mast = new THREE.CylinderGeometry(0.1, 0.15, 7, 6);
    mast.translate(5, 3.5, 0);
    parts.push(colorize(mast, [0.4, 0.4, 0.42]));
    const garage = new THREE.BoxGeometry(5, 3, 6);
    garage.translate(-7, 1.5, 0);
    parts.push(colorize(garage, [0.6, 0.62, 0.66]));
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
    mesh.position.copy(up).multiplyScalar(body.groundRadius(up) - 0.2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), new THREE.MeshBasicMaterial({ color: 0x39d0ff }));
    beacon.position.set(5, 7.2, 0);
    mesh.add(beacon);
    mesh.userData.beacon = beacon;
    body.spin.add(mesh);
    this.baseMeshes.push(mesh);
  }

  // ---------------- news ----------------
  news(key, params) {
    const st = this.state;
    st.news.push({ t: st.time, key, params });
    if (st.news.length > 40) st.news.shift();
  }

  onFaunaEvent(body, ev) {
    if (ev.type === 'attack') this.game.damagePlayer(ev.damage, 'creature');
    if (ev.type === 'predation' && Math.random() < 0.05) this.news('news.predation', { predator: ev.predator.name, prey: ev.prey.name, planet: body.def.name });
  }
}
