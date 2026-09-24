// Sleeping in the ship's bunk: the explorer lies down under the blanket, the
// camera cuts to a shot of the cabin, the lights dim, time passes, and they
// wake up, sit up and step out of bed.
import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { h } from '../ui/dom.js';

const smooth = (x) => { const k = THREE.MathUtils.clamp(x, 0, 1); return k * k * (3 - 2 * k); };
const LIE = 1.8, FADE_IN = 3.4, BLACK = 4.4, WAKE_START = 5.6, END = 7.4;

export class SleepSequence {
  // skip(): advances the world clock (called once, while the screen is dark).
  constructor(game, skip, wakeKey = 'rest.woke_up') {
    this.game = game;
    this.skip = skip;
    this.wakeKey = wakeKey;
    this.t = 0;
    this.skipped = false;
    const p = game.player;
    const bunk = game.ship.model.bunk;
    this.bunk = bunk;
    this.from = p.pos.clone();
    this.fromFwd = p.forward.clone();
    // Lying: feet towards the corridor end, head on the pillow (-Z).
    this.lie = bunk.position.clone().add(new THREE.Vector3(0.05, 0.64, 0.86));
    this.stand = bunk.position.clone().add(new THREE.Vector3(1.25, 0, 0.3));
    this.overlay = h('div', { class: 'sleep-fade' }, h('div', { class: 'zzz' }, 'Z', h('span', {}, 'z'), h('i', {}, 'z')), h('div', { class: 'wake' }));
    game.hud.root.append(this.overlay);
    game.menus.closeAll();
    game.audio?.play('ui_back');
    // Cinematic camera in the cabin, looking at the bunk.
    const cam = game.camera;
    game.player.fpArms.removeFromParent();
    game.ship.model.interior.add(cam);
    const interior = game.ship.model.interior;
    interior.updateMatrixWorld(true);
    cam.position.set(0.55, 1.75, -2.35);
    cam.rotation.set(0, 0, 0);
    // Keep the shot level with the ship's deck, not the planet's up.
    cam.up.set(0, 1, 0).transformDirection(interior.matrixWorld);
    cam.lookAt(interior.localToWorld(bunk.position.clone().add(new THREE.Vector3(0, 0.55, -0.45))));
    game.hud.root.classList.add('sleeping');
    document.body.classList.add('sleeping');
  }

  get done() { return this.t >= END; }

  update(dt) {
    const g = this.game, p = g.player;
    this.t += dt;
    const tt = this.t;
    // 0 standing … 1 lying down
    const k = tt < WAKE_START ? smooth(tt / LIE) : 1 - smooth((tt - WAKE_START) / (END - WAKE_START - 0.3));
    const start = tt < WAKE_START ? this.from : this.stand;
    // Rise slightly over the mattress edge on the way in and out.
    const lift = Math.sin(k * Math.PI) * 0.25;
    p.pos.lerpVectors(start, this.lie, k);
    p.pos.y += lift;
    // Turn (shortest way) from the walking heading to face along the bunk.
    const f0 = tt < WAKE_START ? this.fromFwd : new THREE.Vector3(1, 0, 0);
    const a0 = Math.atan2(f0.x, f0.z), a1 = 0; // facing +Z: tipping back puts the head on the pillow
    let da = a1 - a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a = a0 + da * Math.min(1, k * 1.6);
    p.forward.set(Math.sin(a), 0, Math.cos(a));
    p.vel.set(0, 0, 0);
    p.syncObject();
    p.model.rotation.x = k * (Math.PI / 2 - 0.06); // tip back onto the mattress
    // Slow breathing while asleep.
    if (k > 0.98) p.model.position.y = Math.sin(tt * 1.4) * 0.008;
    else p.model.position.y = 0;
    // Dim to black, skip time, fade back into the morning.
    const dark = tt < FADE_IN ? 0 : tt < BLACK ? smooth((tt - FADE_IN) / (BLACK - FADE_IN)) : tt < WAKE_START ? 1 : 1 - smooth((tt - WAKE_START) / 1.2);
    this.overlay.style.setProperty('--dark', dark.toFixed(3));
    this.overlay.classList.toggle('asleep', tt > LIE && tt < WAKE_START + 0.6);
    if (!this.skipped && tt >= BLACK) {
      this.skipped = true;
      this.skip();
      this.overlay.lastChild.textContent = t(this.wakeKey, { name: g.state.profile.name });
      this.overlay.classList.add('morning');
    }
    if (this.done) this.finish();
  }

  finish() {
    const g = this.game, p = g.player;
    p.model.rotation.x = 0;
    p.model.position.y = 0;
    p.pos.copy(this.stand);
    p.forward.set(1, 0, 0);
    p.syncObject();
    this.overlay.remove();
    g.hud.root.classList.remove('sleeping');
    document.body.classList.remove('sleeping');
    g.camera.up.set(0, 1, 0);
    g.sleep = null;
    g.updateCameraParent();
    g.hud.toast(this.wakeKey, 'accent', { name: g.state.profile.name });
    g.audio?.play('ready');
  }
}
