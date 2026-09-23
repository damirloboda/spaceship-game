// Photo mode: free camera, FOV, exposure, screen-space focus blur, UI toggle.
import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { h } from './dom.js';

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.opts = { fov: 60, exposure: 1, blur: 0, hideUI: false, speed: 6 };
    this.yaw = 0;
    this.pitch = 0;
    this.panel = null;
  }

  toggle(on) {
    const g = this.game;
    if (on === this.active) return;
    this.active = on;
    const cam = g.camera;
    if (on) {
      // Detach the camera into the current frame so the planet can keep turning.
      const frame = g.player.mode === 'body' ? g.player.body.spin : g.ship.root.parent || g.scene;
      frame.attach(cam);
      this.frame = frame;
      // Yaw around the local "up" so the horizon stays level on planets.
      this.base = new THREE.Quaternion();
      if (g.player.mode === 'body') this.base.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cam.position.clone().normalize());
      const rel = this.base.clone().invert().multiply(cam.quaternion);
      const e = new THREE.Euler().setFromQuaternion(rel, 'YXZ');
      this.yaw = e.y; this.pitch = e.x; this.roll = e.z;
      this.opts.fov = cam.fov;
      this.buildPanel();
      g.hud.root.classList.add('photo');
    } else {
      this.panel?.remove();
      this.panel = null;
      g.renderer.toneMappingExposure = 1;
      g.canvas.style.filter = '';
      g.hud.root.classList.remove('photo', 'hideall');
      g.updateCameraParent();
    }
  }

  buildPanel() {
    const g = this.game;
    const o = this.opts;
    const slider = (key, min, max, step, apply) => h('label', {}, t(`photo.${key}`), h('input', { type: 'range', min, max, step, value: o[key], oninput: (e) => { o[key] = Number(e.target.value); apply?.(); } }));
    this.panel = h('div', { class: 'photopanel' },
      h('b', {}, t('photo.title')),
      slider('fov', 15, 110, 1, () => { g.camera.fov = o.fov; g.camera.updateProjectionMatrix(); }),
      slider('exposure', 0.3, 2.5, 0.05, () => { g.renderer.toneMappingExposure = o.exposure; }),
      slider('blur', 0, 6, 0.5, () => { g.canvas.style.filter = o.blur ? `blur(${o.blur * 0.25}px)` : ''; }),
      slider('speed', 1, 60, 1),
      h('button', { class: 'btn', onclick: () => { o.hideUI = !o.hideUI; g.hud.root.classList.toggle('hideall', o.hideUI); this.panel.classList.toggle('ghost', o.hideUI); } }, t('photo.toggle_ui')),
      h('button', { class: 'btn', onclick: () => this.snapshot() }, t('photo.capture')),
      h('button', { class: 'btn primary', onclick: () => this.toggle(false) }, t('photo.exit')),
      h('p', { class: 'muted' }, t('photo.help')));
    document.getElementById('ui').append(this.panel);
  }

  snapshot() {
    const g = this.game;
    try {
      g.render();
      const url = g.canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `ultra-cosmos-${Date.now()}.png`;
      a.click();
      g.state.museum.push({ id: 'photo', t: g.state.time });
    } catch { g.hud.toast('hud.photo_failed', 'warn'); }
  }

  update(dt, input) {
    const cam = this.game.camera;
    const look = input.lookDelta(dt);
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.5, 1.5);
    cam.quaternion.copy(this.base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')));
    const mv = input.move();
    const v = new THREE.Vector3(mv.x, (input.held('jump') ? 1 : 0) - (input.held('crouch') ? 1 : 0), -mv.y).multiplyScalar(this.opts.speed * dt * (input.held('sprint') ? 4 : 1));
    cam.position.add(v.applyQuaternion(cam.quaternion));
  }
}
