// Game orchestrator: renderer, main loop, modes (on foot, ship interior,
// piloting, vehicle, docked, photo), camera rig, sky/fog, saving.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bus } from '../core/events.js';
import { log, guard } from '../core/log.js';
import { storage } from '../core/storage.js';
import { loadSettings, saveSettings, presetFor, isMobileDevice } from '../config/settings.js';
import { setLanguage, t } from '../i18n/index.js';
import { Universe } from '../world/universe.js';
import { HOME_SYSTEM_ID, generateSystem, summarizeSystem, systemPosition } from '../world/galaxy.js';
import { GameState } from './state.js';
import { SaveManager } from './save.js';
import { Market } from './economy.js';
import { Ship } from '../player/ship.js';
import { Player } from '../player/player.js';
import { Skimmer } from '../player/skimmer.js';
import { Input } from '../player/input.js';
import { AudioSystem } from './audio.js';
import { Effects } from '../render/effects.js';
import { Weather } from '../render/weather.js';
import { createGalaxyBackground, createStarfield, createStreaks, createTunnel } from '../render/sky.js';
import { GEAR_HEIGHT, RAMP_EXIT } from '../render/shipModel.js';
import { Tools } from './tools.js';
import { Director } from './director.js';
import { findInteraction } from './interactions.js';
import { Hud } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { TouchControls } from '../ui/touch.js';
import { PhotoMode } from '../ui/photo.js';

const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();

export class Game {
  constructor({ canvas, ui }) {
    this.canvas = canvas;
    this.ui = ui;
    this.events = bus;
    this.settings = loadSettings();
    setLanguage(this.settings.language);
    this.mobile = isMobileDevice();
    this.quality = { ...presetFor(this.settings), budgetMs: this.settings.platform === 'mobile' ? 3 : 5 };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.mobile, logarithmicDepthBuffer: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.background = createGalaxyBackground(7, this.mobile ? 512 : 1024);
    this.scene.background = this.background;
    this.scene.backgroundIntensity = 1;
    this.scene.fog = new THREE.FogExp2(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 2e9);
    this.scene.add(this.camera);
    this.stars = createStarfield(this.mobile ? 3500 : 7000);
    this.scene.add(this.stars);
    this.streaks = createStreaks(this.mobile ? 700 : 1400);
    this.tunnel = createTunnel();
    this.camera.add(this.streaks, this.tunnel);
    this.streaks.position.set(0, 0, 0);
    this.tunnel.position.set(0, 0, 0);
    this.input = new Input(canvas, this.settings);
    this.audio = new AudioSystem(this.settings);
    this.effects = new Effects(this);
    this.weather = new Weather(this, this.quality.weather);
    this.saves = new SaveManager(storage);
    this.hud = new Hud(this, ui);
    this.menus = new Menus(this, ui);
    this.touch = new TouchControls(this, ui);
    this.photo = new PhotoMode(this);
    this.tools = new Tools(this);
    this.director = new Director(this);
    this.mode = 'menu';
    this.cameraMode = this.settings.thirdPerson ? 'third' : 'first';
    this.running = false;
    this.paused = true;
    this.frameTimes = [];
    this.dynScale = 1;
    this.autosaveTimer = 90;
    this.elapsed = 0;
    this.fovKick = 0;
    this.applyGraphics();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    log.onError((msg) => this.hud?.toast('hud.error_recovered', 'warn'));
  }

  // ---------------- graphics ----------------
  applyGraphics() {
    const q = { ...presetFor(this.settings), budgetMs: this.settings.platform === 'mobile' ? 3 : 5 };
    this.quality = q;
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.pixelRatioBase = Math.min(q.pixelRatio, Math.max(1, Math.min(window.devicePixelRatio || 1, 2)));
    this.dynScale = 1;
    this.renderer.setPixelRatio(this.pixelRatioBase);
    this.stars.material.uniforms.uPixelRatio.value = this.pixelRatioBase;
    if (q.bloom && !this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.useComposer = !!q.bloom;
    if (this.universe) for (const b of this.universe.bodies) b.setQuality(q);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setPixelScale(scale) {
    this.dynScale = scale;
    const pr = this.pixelRatioBase * scale;
    this.renderer.setPixelRatio(pr);
    this.composer?.setPixelRatio(pr);
    this.resize();
  }

  // ---------------- lifecycle ----------------
  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      requestAnimationFrame(loop);
      const cap = this.quality.fpsCap;
      if (cap && now - this.last < 1000 / cap - 1) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (!(dt > 0)) dt = 1 / 60;
      this.realDt = dt;
      dt = Math.min(dt, 0.066);
      this.frame(dt, now);
    };
    requestAnimationFrame(loop);
  }

  newGame(profile) {
    const state = new GameState();
    state.profile = { ...state.profile, ...profile };
    state.newGame = true;
    state.addItem('ration', 2);
    state.addItem('water', 2);
    this.begin(state);
  }

  continueGame() {
    const loaded = this.saves.load();
    if (!loaded) return false;
    if (loaded.source.endsWith('.bak')) this.hud.toast('hud.save_recovered', 'warn');
    this.begin(loaded.state);
    return true;
  }

  begin(state) {
    this.teardown();
    this.state = state;
    this.markets = {};
    this.ctx = {
      quality: this.quality,
      isMined: (id) => state.minedDeposits.has(id),
      ecosystem: (id) => {
        state.story.eco = state.story.eco || {};
        state.story.eco[id] = state.story.eco[id] || {};
        return state.story.eco[id];
      },
    };
    this.universe = new Universe(this.scene, this.ctx);
    this.universe.time = state.time;
    this.ship = new Ship(this);
    this.player = new Player(this);
    this.skimmer = new Skimmer(this);
    this.loadSystem(state.location.systemId);
    const placed = !state.newGame && this.restoreLocation();
    if (!placed) this.spawnAtHome(state.newGame);
    this.director.onGameStart(state.newGame);
    this.warmup();
    this.paused = false;
    this.menus.closeAll();
    this.hud.show(true);
    this.touch.refresh();
    this.start();
    state.newGame = false;
    this.save();
  }

  teardown() {
    this.effects?.clearParticles();
    this.effects?.clearFootprints();
    this.universe?.unload();
    if (this.universe) this.scene.remove(this.universe.root, this.universe.sun, this.universe.sun.target, this.universe.ambient);
  }

  loadSystem(systemId) {
    this.effects.clearParticles();
    this.effects.clearFootprints();
    this.weather.group.removeFromParent();
    const sys = this.universe.load(systemId);
    this.state.location.systemId = systemId;
    for (const b of this.universe.bodies) {
      if (b.city) this.market(`${b.id}/city`);
      if (b.station) this.market(`${b.id}/station`);
    }
    this.director.onSystemLoaded(sys);
    return sys;
  }

  market(id) {
    if (!this.markets[id]) {
      const m = new Market(id, id.length * 977 + 13, id.endsWith('station') ? { fuel_cell: 0.9, nitro: 0.95, repair_kit: 0.9 } : { jetpack: 0.95, ration: 0.9, water: 0.9 });
      m.load(this.state.markets[id]);
      this.markets[id] = m;
    }
    return this.markets[id];
  }

  homeBody() {
    return this.universe.bodies.find((b) => b.def.home) || this.universe.bodies[0];
  }

  spawnAtHome(isNew) {
    if (this.state.location.systemId !== HOME_SYSTEM_ID) this.loadSystem(HOME_SYSTEM_ID);
    const body = this.homeBody();
    const sites = body.sites;
    const shipDir = new THREE.Vector3(...sites.shipPad.dir);
    const cityDir = new THREE.Vector3(...sites.city.dir);
    const toCity = cityDir.clone().sub(shipDir).normalize();
    this.ship.placeLanded(body, sites.shipPad.dir, toCity);
    const spawnDir = new THREE.Vector3(...sites.spawn.dir);
    const toShip = shipDir.clone().sub(spawnDir).normalize();
    this.player.placeOnBody(body, spawnDir.multiplyScalar(body.radius + 50), toShip);
    this.setMode('foot');
  }

  restoreLocation() {
    const loc = this.state.location;
    try {
      const s = loc.ship;
      if (s) {
        const body = s.frame ? this.universe.body(s.frame) : null;
        if (s.frame && !body) return false;
        this.ship.placeInSpace(body, new THREE.Vector3(...s.pos), new THREE.Quaternion(...s.quat), new THREE.Vector3(...(s.vel || [0, 0, 0])));
        this.ship.landed = !!s.landed;
        this.ship.gear = s.landed ? 1 : 0;
        this.ship.throttle = s.throttle || 0;
        if (s.docked && body?.station) {
          this.ship.docked = body.station;
          this.ship.dockAnim = { t: 1 };
          this.ship.root.position.copy(body.spin.worldToLocal(body.station.bayWorld()));
          this.ship.root.quaternion.copy(body.station.group.quaternion);
        }
      } else return false;
      const p = loc.player;
      if (!p) return false;
      const fwd = new THREE.Vector3(...(p.forward || [0, 0, -1]));
      this.universe.root.updateMatrixWorld(true);
      if (p.mode === 'interior' || p.mode === 'pilot' || p.mode === 'docked') {
        this.player.placeInShip(this.ship, new THREE.Vector3(...(p.pos || [0, 0, -7])), fwd);
        this.player.pitch = p.pitch || 0;
        this.setMode(p.mode === 'pilot' ? (this.ship.docked ? 'docked' : 'pilot') : p.mode === 'docked' ? 'docked' : 'interior');
      } else {
        const body = this.universe.body(p.frame);
        if (!body) return false;
        this.player.placeOnBody(body, new THREE.Vector3(...p.pos), fwd);
        this.player.pitch = p.pitch || 0;
        this.setMode('foot');
      }
      return true;
    } catch (err) {
      log.error('restoreLocation failed, respawning at home', err);
      return false;
    }
  }

  // Build terrain around the start point synchronously (the only loading wait).
  warmup() {
    this.updateCamera(0);
    this.universe.updateSpin(0);
    this.scene.updateMatrixWorld(true);
    const camWorld = this.camera.getWorldPosition(new THREE.Vector3());
    for (const b of this.universe.bodies) {
      const local = b.spin.worldToLocal(camWorld.clone());
      if (local.length() < b.soi) {
        b.terrain.warmup(local, 3500);
        b.scatter.flush();
      } else {
        b.terrain.update(local, 2);
      }
    }
  }

  // ---------------- modes ----------------
  setMode(mode) {
    this.mode = mode;
    this.updateCameraParent();
    this.hud.setMode(mode);
    this.touch.setMode(mode);
  }

  updateCameraParent() {
    const cam = this.camera;
    const third = this.cameraMode === 'third';
    let parent, pos = new THREE.Vector3(), rotX = 0;
    if (this.photo.active) return;
    switch (this.mode) {
      case 'foot':
      case 'interior':
        parent = third ? this.player.tpCam : this.player.head;
        break;
      case 'pilot':
      case 'docked':
        parent = this.ship.root;
        if (third || this.mode === 'docked') { pos.set(0, 7.5, 32); rotX = -0.12; }
        else pos.copy(this.ship.model.cockpitEye);
        break;
      case 'vehicle':
        parent = this.skimmer.root;
        pos.set(0, 3.2, 8.5); rotX = -0.2;
        break;
      default:
        parent = this.scene;
    }
    parent.add(cam);
    cam.position.copy(pos);
    cam.rotation.set(rotX, 0, 0);
    this.cameraBase = { pos: pos.clone(), rotX };
    if (this.player) this.player.fpArms.removeFromParent();
    if ((this.mode === 'foot' || this.mode === 'interior') && !third) cam.add(this.player.fpArms);
  }

  toggleView() {
    this.cameraMode = this.cameraMode === 'third' ? 'first' : 'third';
    this.settings.thirdPerson = this.cameraMode === 'third';
    saveSettings(this.settings);
    this.updateCameraParent();
  }

  enterShipFromOutside() {
    this.player.placeInShip(this.ship, new THREE.Vector3(0, 0, 9.6), new THREE.Vector3(0, 0, -1));
    this.setMode('interior');
    this.audio.play('ui');
    this.events.emit('player:enteredShip');
  }

  exitShipToSurface() {
    const ship = this.ship;
    if (!ship.landed || !ship.body) {
      this.hud.toast(ship.docked ? 'hud.docked_use_menu' : 'hud.cannot_exit_flight', 'warn');
      return;
    }
    const world = ship.root.localToWorld(RAMP_EXIT.clone());
    const local = ship.body.spin.worldToLocal(world);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.root.getWorldQuaternion(new THREE.Quaternion()));
    const localBack = back.applyQuaternion(ship.body.spin.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.player.placeOnBody(ship.body, local.addScaledVector(local.clone().normalize(), 1), localBack);
    this.setMode('foot');
    this.events.emit('player:exitedShip', { body: ship.body });
  }

  sitInPilotSeat() {
    this.setMode(this.ship.docked ? 'docked' : 'pilot');
    this.events.emit('player:piloting');
    if (this.ship.docked) this.menus.open('station');
  }

  standUpFromSeat() {
    this.player.placeInShip(this.ship, new THREE.Vector3(0, 0, -7.9), new THREE.Vector3(0, 0, 1));
    this.setMode('interior');
  }

  // ---------------- travel ----------------
  // Called from inside the Lightbreak tunnel: swap the whole system.
  arriveInSystem(systemId, via) {
    const fromPos = systemPosition(this.state.location.systemId);
    const first = !this.state.isDiscovered('systems', systemId);
    this.state.stats.jumps++;
    this.ship.root.removeFromParent();
    this.player.object.removeFromParent();
    this.loadSystem(systemId);
    const sys = this.universe.system;
    const target = this.universe.bodies.find((b) => b.def.kind === 'planet') || this.universe.bodies[0];
    let arrival, look;
    if (target) {
      const tp = target.anchor.position;
      const outward = tp.clone().normalize().multiplyScalar(-1);
      const side = new THREE.Vector3(0, 1, 0).cross(outward).normalize();
      arrival = tp.clone().addScaledVector(outward, target.radius * 4.2).addScaledVector(side, target.radius * 1.6);
      look = tp.clone().sub(arrival).normalize();
    } else {
      arrival = new THREE.Vector3(2e6, 1e5, 0);
      look = arrival.clone().negate().normalize();
    }
    this.ship.setFrame(null);
    this.universe.root.add(this.ship.root);
    this.ship.root.position.copy(arrival);
    this.ship.root.quaternion.identity();
    this.ship.pointAtWorld(look, 1);
    this.ship.vel.copy(look).multiplyScalar(50);
    this.player.placeInShip(this.ship, new THREE.Vector3(0, 0, -8.9), new THREE.Vector3(0, 0, -1));
    this.ship.model.interior.add(this.player.object);
    this.updateCameraParent();
    this.state.discover('systems', systemId, { name: sys.name, star: sys.star.type });
    this.pendingArrival = { first, sys, target, fromPos, via };
    this.save();
  }

  onLightbreakExit(lb) {
    const a = this.pendingArrival;
    this.pendingArrival = null;
    if (a) {
      this.hud.banner(a.first ? 'hud.new_system' : 'hud.system_entered', 'accent', { name: a.sys.name });
      if (a.first) {
        this.state.credits += 250;
        this.state.addXP('exploration', 60);
        this.audio.play('discovery');
        this.director.news('news.system_discovered', { name: a.sys.name, pilot: this.state.profile.name });
      }
      if (a.target && !this.state.isDiscovered('planets', a.target.id)) {
        setTimeout(() => this.hud.banner('hud.unknown_world', 'accent', {}, 'hud.first_discovery'), 2600);
      }
      if (this.universe.system.star.type === 'black_hole') setTimeout(() => this.hud.banner('hud.black_hole_detected', 'danger'), 5000);
    }
    this.events.emit('ship:lightbreakExit', lb);
  }

  // ---------------- damage & vitals ----------------
  damagePlayer(amount, cause) {
    const v = this.state.vitals;
    v.health = Math.max(0, v.health - amount);
    this.hud.hurt(amount);
    this.audio.play('hurt');
    if (v.health <= 0) this.onPlayerDown(cause);
  }

  onPlayerDown() {
    // No perma-death: the suit's emergency beacon returns you to your ship.
    const v = this.state.vitals;
    v.health = 60;
    v.oxygen = 100;
    const lost = Math.floor(this.state.credits * 0.1);
    this.state.credits -= lost;
    this.hud.banner('hud.suit_recovery', 'danger', { credits: lost });
    if (this.ship.body && this.ship.landed) {
      this.player.placeInShip(this.ship, new THREE.Vector3(0, 0, -4), new THREE.Vector3(0, 0, -1));
      this.setMode('interior');
    } else {
      this.spawnAtHome(false);
    }
  }

  onShipDamaged(broken, impact) {
    this.audio.play('crash');
    this.hud.hurt(Math.min(30, impact));
    for (const id of broken) this.hud.banner(`warn.module_broken`, 'danger', { module: t(`module.${id}`) });
  }

  onMeteorImpact(body, local) {
    const up = local.clone().normalize();
    this.effects.burst(body.spin, local, { count: 20, color: 0xffa050, size: 0.8, speed: 25, life: 2, up, gravity: 8 });
    this.effects.smoke(body.spin, local, up, 6);
    this.audio.play('thunder');
    const pl = this.player.mode === 'body' ? this.player.pos : null;
    if (pl && pl.distanceTo(local) < 25) this.damagePlayer(20, 'meteor');
  }

  // ---------------- main frame ----------------
  frame(dt, now) {
    this.input.pollGamepad();
    const t0 = performance.now();
    if (this.state && !this.paused) {
      guard('update', () => this.update(dt));
    } else if (this.state) {
      guard('idle', () => this.idleUpdate(dt));
    } else {
      this.camera.rotation.y += dt * 0.01;
    }
    const t1 = performance.now();
    guard('render', () => this.render(dt));
    const t2 = performance.now();
    this.perf = { update: t1 - t0, render: t2 - t1 };
    this.input.endFrame();
    this.measure(this.realDt || dt);
  }

  // Developer/test helper: advance the simulation without rendering.
  simulate(seconds, step = 1 / 30) {
    let first = true;
    for (let t = 0; t < seconds; t += step) {
      this.update(step);
      if (first) { this.input.endFrame(); first = false; }
    }
  }

  idleUpdate(dt) {
    // Keep the world visible behind menus without simulating gameplay.
    this.handleGlobalInput();
    this.menus.update(dt);
    this.updateCamera(dt);
    this.updateWorldVisuals(0);
  }

  update(dt) {
    const input = this.input;
    const st = this.state;
    this.elapsed += dt;
    st.time += dt;
    st.stats.playTime += dt;
    this.handleGlobalInput();
    if (this.paused) return;
    if (this.photo.active) {
      this.photo.update(dt, input);
      this.universe.updateSpin(dt);
      this.updateWorldVisuals(dt);
      return;
    }
    const piloting = this.mode === 'pilot';
    switch (this.mode) {
      case 'foot':
      case 'interior':
        this.player.update(dt, input);
        break;
      case 'vehicle':
        this.skimmer.update(dt, input, true);
        break;
      default:
        break;
    }
    this.ship.update(dt, input, piloting);
    if (this.mode !== 'vehicle') this.skimmer.update(dt, input, false);
    this.universe.updateSpin(dt);
    this.tools.update(dt, input);
    this.interaction = guard('interact', () => findInteraction(this)) || null;
    if (this.interaction && input.pressed('interact')) {
      this.interaction.action();
      this.audio.play('ui');
    }
    this.updateVitals(dt);
    this.director.update(dt);
    for (const m of Object.values(this.markets)) m.update(dt);
    this.updateWorldVisuals(dt);
    this.updateCamera(dt);
    this.effects.update(dt);
    this.menus.update(dt);
    this.hud.update(dt);
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0) {
      this.autosaveTimer = 90;
      if (this.ship.lb.phase === 'none') this.save(true);
    }
  }

  handleGlobalInput() {
    const i = this.input;
    if (i.pressed('pause')) {
      if (this.photo.active) this.photo.toggle(false);
      else if (this.menus.current) this.menus.back();
      else this.menus.open('pause');
      return;
    }
    // Toggle keys also close the panel they opened.
    const toggles = { map: 'map', inventory: 'inventory', journal: 'journal', help: 'help' };
    if (this.menus.current) {
      for (const [action, panel] of Object.entries(toggles)) {
        if (i.pressed(action) && this.menus.current.name === panel) { this.menus.back(); return; }
      }
    }
    if (this.menus.current) return;
    if (i.pressed('map')) this.menus.open('map');
    else if (i.pressed('inventory')) this.menus.open('inventory');
    else if (i.pressed('journal')) this.menus.open('journal');
    else if (i.pressed('help')) this.menus.open('help');
    else if (i.pressed('photo')) this.photo.toggle(true);
    else if (i.pressed('view') && this.mode !== 'vehicle') this.toggleView();
    else if (i.pressed('dev') && this.menus.devAvailable) this.menus.open('dev');
    if (this.mode === 'pilot') {
      if (i.pressed('lightbreak')) this.tryLightbreak();
      if (i.pressed('autopilot')) {
        if (this.ship.autopilot) this.ship.disengageAutopilot('hud.autopilot_off');
        else if (this.navTarget && this.navTarget.world) this.ship.engageAutopilot('travel', this.navTarget);
        else this.hud.toast('hud.no_target', 'warn');
      }
      if (i.pressed('target')) this.director.cycleTarget();
    }
  }

  tryLightbreak() {
    const ship = this.ship;
    if (ship.lb.phase === 'cruise') return; // handled inside ship (drop out)
    const sys = this.state.ship;
    if (!sys.nitro.installed) { this.hud.toast('hud.need_nitro', 'warn'); return; }
    if (sys.lightbreak.state !== 'ready') { this.hud.toast('hud.lightbreak_charge', 'warn'); return; }
    const target = this.navTarget?.systemId ? this.navTarget : null;
    if (target) {
      const exp = this.tools.expeditionCheck();
      if (exp.blocked) { this.menus.open('expedition', { target }); return; }
    }
    const r = ship.engageLightbreak(target);
    if (!r.ok) this.hud.toast(`hud.lb_fail_${r.reason}`, 'warn');
    else this.events.emit('ship:lightbreak', { target });
  }

  updateVitals(dt) {
    const v = this.state.vitals;
    const p = this.player;
    let breathable = true, hazard = 0, shelter = false;
    if (this.mode === 'interior' || this.mode === 'pilot' || this.mode === 'docked') shelter = true;
    else if (this.mode === 'foot' || this.mode === 'vehicle') {
      const body = p.body || this.skimmer.body;
      if (body) {
        breathable = !!body.def.atmosphere?.breathable && !p.underwater;
        const temp = body.def.temperature;
        hazard = (temp > 60 ? (temp - 60) / 80 : temp < -40 ? (-40 - temp) / 80 : 0) + (['toxic', 'radioactive'].includes(body.def.type) ? 0.5 : 0);
        if (this.tools.nearShelter()) shelter = true;
      }
    }
    if (shelter) {
      v.oxygen = Math.min(100, v.oxygen + dt * 25);
      v.suitEnergy = Math.min(100, v.suitEnergy + dt * 10);
      if (!this.state.ship.isBroken('lifeSupport') || this.mode === 'foot') v.health = Math.min(100, v.health + dt * 0.6);
    } else {
      if (!breathable) v.oxygen = Math.max(0, v.oxygen - dt * (p.underwater ? 2.2 : 0.55));
      else v.oxygen = Math.min(100, v.oxygen + dt * 8);
      if (hazard > 0) v.suitEnergy = Math.max(0, v.suitEnergy - dt * hazard * 0.8);
      else v.suitEnergy = Math.min(100, v.suitEnergy + dt * 2);
      if (v.oxygen <= 0 || v.suitEnergy <= 0) this.damagePlayer(dt * 4, 'environment');
    }
    this.hud.setHazard(!breathable, hazard > 0 && !shelter);
  }

  // ---------------- camera ----------------
  updateCamera(dt) {
    if (!this.player || this.photo.active) return;
    const cam = this.camera;
    const base = this.cameraBase || { pos: new THREE.Vector3(), rotX: 0 };
    let shake = 0, fov = this.settings.fov;
    if (this.mode === 'foot' || this.mode === 'interior') {
      cam.position.copy(base.pos);
      cam.position.y += this.player.cameraOffset();
      if (this.player.jetActive) shake = 0.02;
      if (this.player.speed > 7) fov += 6;
      if (this.cameraMode === 'third') this.keepThirdPersonAboveGround();
    } else if (this.mode === 'pilot' || this.mode === 'docked') {
      cam.position.copy(base.pos);
      shake = this.ship.shake * 0.08;
      const lb = this.ship.lb.phase;
      if (this.ship.overdrive) fov += 12;
      if (lb === 'spool') fov += 20;
      if (lb === 'tunnel' || lb === 'cruise') fov += 32;
      if (lb === 'exit') fov += 10;
      if (this.cameraMode === 'third' || this.mode === 'docked') {
        // Chase camera leans with speed.
        cam.position.z += Math.min(12, this.ship.speed / 200);
      }
    } else if (this.mode === 'vehicle') {
      cam.position.copy(base.pos);
      shake = this.skimmer.speed > 25 ? 0.015 : 0;
    }
    if (this.settings.cameraShake && !this.settings.reducedMotion && shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
    }
    this.fovKick += (fov - this.fovKick) * Math.min(1, dt * 3 || 1);
    if (Math.abs(cam.fov - this.fovKick) > 0.05) {
      cam.fov = this.fovKick;
      cam.updateProjectionMatrix();
    }
  }

  keepThirdPersonAboveGround() {
    const p = this.player;
    if (p.mode !== 'body') { p.tpCam.position.set(0.5, 0.25, 2.2); return; }
    p.tpCam.position.set(0.7, 0.35, 4.2);
    p.object.updateMatrixWorld(true);
    const w = p.tpCam.getWorldPosition(tv);
    const local = p.body.spin.worldToLocal(w);
    const alt = p.body.altitude(local);
    if (alt < 0.6) p.tpCam.position.y += 0.6 - alt;
  }

  // ---------------- world visuals ----------------
  updateWorldVisuals(dt) {
    const uni = this.universe;
    if (!uni) return;
    this.scene.updateMatrixWorld();
    const camWorld = this.camera.getWorldPosition(tv);
    const active = uni.dominantBody(camWorld);
    this.activeBody = active;
    const focus = this.player?.worldPosition(new THREE.Vector3()) || camWorld;
    uni.update(dt, this.camera, this.mode === 'pilot' || this.mode === 'docked' ? camWorld : focus, active);
    const sunWorld = new THREE.Vector3(0, 0, 0);
    let daylight = 0, inAtmo = 0, altFrac = 1;
    for (const b of uni.bodies) {
      const local = b.spin.worldToLocal(camWorld.clone());
      const dist = local.length();
      const near = dist < b.soi * 1.2;
      guard('terrain', () => b.terrain.update(local, b === active ? this.quality.budgetMs : near ? 1.5 : 0.4));
      if (near) {
        guard('scatter', () => b.scatter.update(dt, b === active ? 2 : 0.5, local));
        b.station?.update(dt);
      }
      if (b.waterMaterial) b.waterMaterial.userData.uniforms.uTime.value += dt;
      // Sun direction in this body's frames.
      const sunSpin = b.spin.worldToLocal(sunWorld.clone()).normalize();
      const sunAnchor = b.anchor.worldToLocal(sunWorld.clone()).normalize();
      if (b.atmo) {
        const u = b.atmoMaterial.uniforms;
        const camA = b.anchor.worldToLocal(camWorld.clone());
        u.uCam.value.copy(camA);
        u.uSun.value.copy(sunAnchor);
        const inside = camA.length() < b.atmoTop * 0.999;
        b.atmoMaterial.side = inside ? THREE.BackSide : THREE.FrontSide;
        u.uStorm.value = b === active ? this.weather.stormAmount * 0.6 : 0;
      }
      if (b.clouds) {
        const u = b.cloudMaterial.uniforms;
        u.uSun.value.copy(sunSpin);
        u.uTime.value += dt;
        u.uStorm.value = b === active ? this.weather.stormAmount : 0;
        const camAlt = dist - b.cloudRadius;
        u.uFade.value = THREE.MathUtils.clamp(Math.abs(camAlt) / 150, 0.15, 1);
      }
      if (b.rings) {
        const rq = b.rings.getWorldQuaternion(new THREE.Quaternion()).invert();
        const sunR = sunWorld.clone().sub(b.anchor.getWorldPosition(new THREE.Vector3())).normalize().applyQuaternion(rq);
        b.ringMaterial.uniforms.uSun.value.copy(sunR);
      }
      if (b === active) {
        const up = local.clone().normalize();
        const sunUp = sunSpin.dot(up);
        const alt = dist - b.radius;
        if (b.def.atmosphere && alt < b.atmoHeight) {
          inAtmo = 1;
          altFrac = THREE.MathUtils.clamp(alt / b.atmoHeight, 0, 1);
        }
        daylight = THREE.MathUtils.smoothstep(sunUp, -0.12, 0.25);
        this.localHour = b.localHour(this.player?.mode === 'body' ? this.player.pos : local, sunSpin);
        if (b.city) guard('city', () => b.city.update(dt, b.localHour(new THREE.Vector3(...b.city.dir), sunSpin), this.player?.pos));
        const pl = this.player?.mode === 'body' && this.player.body === b ? this.player.pos : this.skimmer.body === b && this.mode === 'vehicle' ? this.skimmer.root.position : null;
        guard('fauna', () => {
          b.fauna.update(dt, pl, { hostile: b.def.danger !== 'SAFE' });
          for (const ev of b.fauna.events.splice(0)) this.director.onFaunaEvent(b, ev);
        });
        // Sun is below the horizon: dim the directional light (planet shadow).
        const occl = dist < b.radius * 3 ? THREE.MathUtils.smoothstep(sunUp, -0.18, 0.05) : 1;
        uni.sun.intensity = (2.4 + (uni.system.star.luminosity || 1) * 0.8) * Math.max(0.02, occl) * (1 - this.weather.stormAmount * 0.5 * inAtmo);
      }
      b.setFogEnabled(b === active && dist < b.atmoTop && !!b.def.atmosphere);
    }
    if (!active) uni.sun.intensity = 2.4 + (uni.system?.star.luminosity || 1) * 0.8;
    // Inside the hull the sun is mostly blocked; cabin lamps take over.
    const inside = this.mode === 'interior' || (this.mode === 'docked' && this.cameraMode !== 'third');
    if (inside) uni.sun.intensity *= 0.18;
    const cabin = this.mode === 'interior' || this.mode === 'pilot' || this.mode === 'docked';
    if (this.ship) for (const l of this.ship.model.lamps) l.intensity = cabin ? (this.mode === 'pilot' ? 2 : 9) : 0;
    if (!active || !inAtmo) this.localHour = this.localHour ?? 12;
    const w = this.weather.update(dt, active, this.player?.mode === 'body' ? this.player.pos : null);
    // Fog: aerial perspective inside atmospheres, heavy under water.
    const fog = this.scene.fog;
    if (active && inAtmo) {
      const c = active.def.atmosphere.color;
      const sky = new THREE.Color(c[0], c[1], c[2]);
      const sunset = new THREE.Color(1.0, 0.5, 0.25);
      const lowSun = 1 - Math.min(1, Math.abs(daylight - 0.5) * 2);
      sky.lerp(sunset, lowSun * 0.35).multiplyScalar(0.25 + daylight * 0.75);
      sky.lerp(new THREE.Color(0.35, 0.36, 0.4), this.weather.stormAmount * 0.6);
      fog.color.copy(sky).multiplyScalar(0.8);
      const base = (1 / 14000) * active.def.atmosphere.density * (w?.fog || 1);
      fog.density = base * (1 - altFrac * 0.9);
      this.stars.material.uniforms.uFade.value = 1 - THREE.MathUtils.smoothstep(daylight, 0.05, 0.35) * (1 - altFrac * altFrac);
      uni.ambient.color.copy(sky).lerp(new THREE.Color(1, 1, 1), 0.3);
      // Night keeps a faint blue skylight (starlight and ring-shine).
      uni.ambient.intensity = 0.22 + daylight * 0.4;
      if (daylight < 0.2) uni.ambient.color.lerp(new THREE.Color(0.45, 0.55, 0.9), 0.6);
    } else {
      fog.density = 0;
      this.stars.material.uniforms.uFade.value = 1;
      uni.ambient.color.set(0x8899bb);
      uni.ambient.intensity = 0.14;
    }
    if (this.player?.underwater) {
      fog.color.setRGB(0.02, 0.1, 0.16);
      fog.density = 0.06;
    }
    if (this.weather.flash > 0) uni.ambient.intensity += this.weather.flash * 3;
    this.scene.backgroundIntensity = 1 - (inAtmo ? daylight * (1 - altFrac) * 0.9 : 0);
    // Shadows follow the player on quality presets that allow them.
    if (this.quality.shadows && this.activeBody && this.player?.mode === 'body') {
      const s = uni.sun;
      s.castShadow = true;
      s.shadow.mapSize.set(this.quality.shadows, this.quality.shadows);
      const cam = s.shadow.camera;
      cam.left = -60; cam.right = 60; cam.top = 60; cam.bottom = -60; cam.near = 1; cam.far = 4500;
      cam.updateProjectionMatrix();
      s.shadow.bias = -0.0005;
    } else {
      uni.sun.castShadow = false;
    }
    this.updateSpeedEffects(dt);
  }

  updateSpeedEffects(dt) {
    const ship = this.ship;
    const lb = ship?.lb.phase || 'none';
    const piloting = this.mode === 'pilot';
    const od = piloting && ship.overdrive;
    const target = !piloting ? 0 : lb === 'tunnel' ? 1 : lb === 'cruise' ? 0.9 : lb === 'spool' ? 0.6 : lb === 'exit' ? 0.3 : od ? 0.35 : 0;
    const u = this.streaks.material.uniforms;
    u.uIntensity.value += (target - u.uIntensity.value) * Math.min(1, dt * 3);
    u.uStretch.value = u.uIntensity.value * (lb === 'tunnel' || lb === 'cruise' ? 1 : 0.4);
    u.uSpeed.value = 400 + u.uIntensity.value * 3000;
    u.uTime.value += dt;
    this.streaks.visible = u.uIntensity.value > 0.02;
    // Streaks point along the direction of travel.
    if (this.streaks.visible && ship.vel.lengthSq() > 1) {
      const worldVel = ship.vel.clone().applyQuaternion(ship.root.parent.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const camQ = this.camera.getWorldQuaternion(new THREE.Quaternion());
      const localVel = worldVel.applyQuaternion(camQ.invert());
      this.streaks.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), localVel);
    }
    const tu = this.tunnel.material.uniforms;
    tu.uIntensity.value += ((lb === 'tunnel' ? 1 : 0) - tu.uIntensity.value) * Math.min(1, dt * 2.5);
    tu.uTime.value += dt;
    this.tunnel.visible = tu.uIntensity.value > 0.02;
    this.tunnel.quaternion.copy(this.streaks.quaternion);
    if (this.bloom) this.bloom.strength = 0.35 + u.uIntensity.value * 0.6;
    const drive = lb !== 'none' ? 0.12 : od ? 0.07 : 0;
    this.audio.setLoop('drive', drive, 110 + u.uIntensity.value * 500);
    const eng = piloting || (this.mode === 'interior' && !ship.landed) ? 0.03 + ship.throttle * 0.05 : ship.landed ? 0 : 0.02;
    this.audio.setLoop('engine', eng, 45 + ship.throttle * 60);
    this.audio.setLoop('jet', this.player?.jetActive ? 0.14 : 0);
  }

  render() {
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    if (this.useComposer && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  measure(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    if (!this.settings.dynamicResolution || this.frameTimes.length < 60 || !this.state) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const target = 1 / (this.quality.fpsCap || 60);
    this.dynTimer = (this.dynTimer || 0) + dt;
    if (this.dynTimer < 1.5) return;
    this.dynTimer = 0;
    if (avg > target * 1.25 && this.dynScale > 0.55) this.setPixelScale(Math.max(0.55, this.dynScale - 0.1));
    else if (avg < target * 0.85 && this.dynScale < 1) this.setPixelScale(Math.min(1, this.dynScale + 0.05));
  }

  get fps() {
    const n = this.frameTimes.length;
    return n ? n / this.frameTimes.reduce((a, b) => a + b, 0) : 0;
  }

  // ---------------- saving ----------------
  captureLocation() {
    const st = this.state;
    const p = this.player;
    st.time = this.universe.time;
    st.location.ship = this.ship.toSave();
    const pm = this.mode === 'pilot' ? 'pilot' : this.mode === 'docked' ? 'docked' : p.mode === 'interior' ? 'interior' : 'foot';
    st.location.player = { mode: pm, frame: p.body?.id || null, pos: p.pos.toArray(), forward: p.forward.toArray(), pitch: p.pitch };
    if (this.mode === 'vehicle') {
      st.location.player = { mode: 'foot', frame: this.skimmer.body.id, pos: this.skimmer.root.position.toArray(), forward: [0, 0, -1], pitch: 0 };
    }
    st.location.mode = pm;
    for (const [id, m] of Object.entries(this.markets)) st.markets[id] = m.toJSON();
  }

  save(auto = false) {
    if (!this.state) return false;
    this.captureLocation();
    const ok = this.saves.save(this.state);
    if (!ok) this.hud.toast('hud.save_failed', 'warn');
    else if (!auto) this.hud.toast('hud.saved', 'accent');
    else this.hud.flashSaveIcon();
    return ok;
  }

  // ---------------- developer tools ----------------
  devRegenerate() {
    const body = this.player.body || this.activeBody;
    if (!body) return;
    body.def.seed = (body.def.seed * 16807 + 1) % 2147483647;
    const id = body.id;
    const dir = this.player.mode === 'body' ? this.player.pos.clone().normalize() : null;
    const sysId = this.state.location.systemId;
    const defs = this.universe.system.bodies;
    this.ship.root.removeFromParent();
    this.player.object.removeFromParent();
    this.universe.unload();
    // Rebuild with the edited definitions.
    const sys = generateSystem(sysId);
    sys.bodies = defs;
    this.universe.system = sys;
    this.universe.billboards = [];
    const Body = this.universe.constructor.BodyClass;
    this.universe.bodies = [];
    for (const def of defs) {
      const b = new Body(def, this.ctx);
      this.universe.root.add(b.anchor);
      this.universe.bodies.push(b);
    }
    this.universe.updateSpin(0);
    const nb = this.universe.body(id);
    if (dir && nb) {
      this.player.placeOnBody(nb, dir.multiplyScalar(nb.radius + nb.surface.maxHeight + 20), null);
      this.setMode('foot');
    }
    this.ship.placeLanded(nb, (dir || new THREE.Vector3(0, 1, 0)).clone().normalize().toArray(), null);
    this.warmup();
    this.hud.toast('hud.dev_regenerated', 'accent');
  }

  devSpawnPlanet() {
    const fwd = this.camera.getWorldDirection(new THREE.Vector3());
    const pos = this.camera.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 120000);
    const Body = this.universe.constructor.BodyClass;
    const def = this.universe.makeRandomPlanet(pos);
    const b = new Body(def, this.ctx);
    this.universe.root.add(b.anchor);
    this.universe.bodies.push(b);
    this.universe.system.bodies.push(def);
    this.hud.toast('hud.dev_spawned', 'accent', { name: def.name });
  }

  setLanguage(lang) {
    this.settings.language = lang;
    setLanguage(lang);
    saveSettings(this.settings);
    this.hud.relabel();
    this.touch.relabel();
  }

  saveSettings() {
    saveSettings(this.settings);
    this.audio.applyVolume();
  }
}
