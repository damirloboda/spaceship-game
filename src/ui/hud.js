// Minimal sci-fi HUD. The game comes first: small, edge-anchored elements
// that appear only when relevant.
import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { h, fmtDistance, fmtSpeed } from './dom.js';
import { itemDef } from '../game/items.js';
import { TUTORIAL } from '../game/director.js';

const KEYS = {
  keyboard: { move: 'WASD', look: 'MOUSE', jump: 'SPACE', jet: 'HOLD SPACE', scan: 'F', mine: 'LMB / R', fire: 'LMB / R', interact: 'E', map: 'M', inventory: 'I', boost: 'SHIFT', lightbreak: 'B', throttle: 'W/S', view: 'V', autopilot: 'L', target: 'T', photo: 'P' },
  gamepad: { move: 'L-STICK', look: 'R-STICK', jump: 'A', jet: 'HOLD A', scan: 'Y', mine: 'RT', fire: 'RT', interact: 'X', map: 'SELECT', inventory: 'D-UP', boost: 'RB', lightbreak: 'R3', throttle: 'LT/RT', view: 'LB', autopilot: 'D-RIGHT', target: '—', photo: 'D-DOWN' },
  touch: { move: '◎', look: '⇆', jump: 'JUMP', jet: 'HOLD JUMP', scan: 'SCAN', mine: 'MINE', fire: 'FIRE', interact: 'USE', map: 'MAP', inventory: 'BAG', boost: 'BOOST', lightbreak: 'LB', throttle: '◎ ↕', view: 'VIEW', autopilot: 'AUTO', target: '—', photo: '📷' },
};

export class Hud {
  constructor(game, root) {
    this.game = game;
    this.root = h('div', { id: 'hud', class: 'hidden' });
    root.append(this.root);
    this.el = {};
    const E = this.el;
    E.markers = h('div', { class: 'markers' });
    E.compass = h('div', { class: 'compass' }, h('div', { class: 'compass-strip' }));
    E.objective = h('div', { class: 'objective' });
    E.radio = h('div', { class: 'radio' });
    E.vitals = h('div', { class: 'vitals' });
    E.ship = h('div', { class: 'shiphud' });
    E.warnings = h('div', { class: 'warnings' });
    E.crosshair = h('div', { class: 'crosshair' });
    // Tapping the prompt performs it (handy on touch screens).
    E.prompt = h('div', { class: 'prompt', onpointerdown: (e) => {
      const it = this.game.interaction;
      if (!it || !E.prompt.classList.contains('on')) return;
      e.preventDefault();
      e.stopPropagation();
      it.action();
      this.game.audio.play('ui');
    } });
    E.progress = h('div', { class: 'progress' }, h('i'));
    E.banner = h('div', { class: 'banner' });
    E.toasts = h('div', { class: 'toasts' });
    E.fps = h('div', { class: 'fps' });
    E.vignette = h('div', { class: 'vignette' });
    E.flash = h('div', { class: 'flash' });
    E.water = h('div', { class: 'underwater' });
    E.signal = h('div', { class: 'signal' });
    E.save = h('div', { class: 'saveicon' }, '◈');
    E.radar = h('canvas', { class: 'radar', width: 120, height: 120 });
    E.info = h('div', { class: 'locinfo' });
    E.flare = h('div', { class: 'flare' }, ...[0, 1, 2, 3, 4, 5].map((i) => h('i', { class: `f${i}` })));
    this.root.append(E.flare, E.water, E.vignette, E.flash, E.markers, E.compass, E.objective, E.radio, E.vitals, E.ship, E.warnings, E.crosshair, E.prompt, E.progress, E.banner, E.toasts, E.fps, E.signal, E.save, E.radar, E.info);
    this.markerPool = [];
    this.bannerQueue = [];
    this.bannerTimer = 0;
    this.progress = 0;
    this.visible = false;
    this.hurtAmt = 0;
  }

  show(v) {
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
  }

  setMode(mode) {
    this.root.dataset.mode = mode;
  }

  keys() {
    const g = this.game;
    const dev = g.settings.touchControls ? 'touch' : g.input.lastDevice === 'gamepad' ? 'gamepad' : 'keyboard';
    return KEYS[dev];
  }

  relabel() { /* texts are re-rendered every frame */ }

  // ---------------- messages ----------------
  toast(key, type = 'info', params) {
    const el = h('div', { class: `toast ${type}` }, t(key, params));
    this.el.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3800);
    while (this.el.toasts.children.length > 5) this.el.toasts.lastChild.remove();
  }

  banner(key, type = 'accent', params, subKey) {
    const text = t(key, params);
    if (this.bannerQueue.some((b) => b.text === text) || this.currentBanner === text) return;
    // Never let a backlog build up: keep only the latest few.
    if (this.bannerQueue.length > 2) this.bannerQueue.shift();
    this.bannerQueue.push({ text, sub: subKey ? t(subKey, params) : '', type });
    if (this.game.settings.subtitles && type === 'danger') this.game.audio.play('alarm');
  }

  discovery(key, params, credits) {
    this.bannerQueue.push({ text: t(key, params), sub: credits ? `+${credits} ◇` : '', type: 'discovery', short: true });
  }

  radio(key, params) {
    const el = h('div', { class: 'radio-msg' }, h('b', {}, t('hud.radio')), ' ', t(key, params));
    this.el.radio.prepend(el);
    setTimeout(() => el.classList.add('out'), 9000);
    setTimeout(() => el.remove(), 9800);
    while (this.el.radio.children.length > 3) this.el.radio.lastChild.remove();
  }

  pickup(id, n) {
    this.toast('hud.pickup', 'item', { n, item: t(`item.${id}`) });
  }

  hurt(amount) {
    this.hurtAmt = Math.min(1, this.hurtAmt + amount / 40);
  }

  setProgress(p) {
    this.progress = p;
  }

  setHazard(noAir, hazard) {
    this.hazard = { noAir, hazard };
  }

  setSignal(s) {
    this.signalStrength = s;
  }

  // Screen-space lens flare: ghosts along the line from the sun through the centre.
  setFlare(x, y, intensity) {
    const f = this.el.flare;
    if (intensity <= 0.01) { f.style.opacity = '0'; return; }
    const w = this.root.clientWidth, hgt = this.root.clientHeight;
    const sx = (x + 1) / 2 * w, sy = (1 - y) / 2 * hgt;
    const cx = w / 2, cy = hgt / 2;
    const k = [0, 0.35, 0.7, 1.15, 1.45, 1.8];
    [...f.children].forEach((el, i) => {
      el.style.transform = `translate(${sx + (cx - sx) * k[i]}px, ${sy + (cy - sy) * k[i]}px)`;
    });
    f.style.opacity = String(Math.min(1, intensity));
  }

  flashSaveIcon() {
    this.el.save.classList.remove('on');
    void this.el.save.offsetWidth;
    this.el.save.classList.add('on');
  }

  // ---------------- per frame ----------------
  update(dt) {
    if (!this.visible) return;
    const g = this.game;
    const st = g.state;
    const E = this.el;
    const mode = g.mode;
    const onFoot = mode === 'foot' || mode === 'interior' || mode === 'vehicle';
    // Banner queue
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) {
      E.banner.classList.remove('on');
      const b = this.bannerQueue.shift();
      if (b) {
        E.banner.className = `banner ${b.type}`;
        E.banner.replaceChildren(h('div', { class: 'b-main' }, b.text), b.sub ? h('div', { class: 'b-sub' }, b.sub) : '');
        void E.banner.offsetWidth;
        E.banner.classList.add('on');
        this.currentBanner = b.text;
        this.bannerTimer = (b.short ? 2.4 : 3.6) * (this.bannerQueue.length ? 0.6 : 1);
      } else this.currentBanner = null;
    }
    // Prompt
    const it = g.interaction;
    if (it) {
      const k = this.keys().interact;
      E.prompt.textContent = `[${k}] ${t(it.key, it.params)}`;
      E.prompt.classList.add('on');
    } else E.prompt.classList.remove('on');
    E.progress.classList.toggle('on', this.progress > 0.01 && g.tools.mining);
    E.progress.firstChild.style.width = `${Math.min(100, this.progress * 100)}%`;
    if (!g.tools.mining) this.progress = 0;
    // Vitals
    const v = st.vitals;
    const jp = st.jetpack;
    const rows = [
      this.row('hud.health', v.health, v.health < 30 ? 'bad' : ''),
      this.row('hud.oxygen', v.oxygen, v.oxygen < 25 ? 'bad' : 'oxy'),
      this.row('hud.suit', v.suitEnergy, v.suitEnergy < 25 ? 'bad' : 'energy'),
    ];
    if (jp.owned) {
      rows.push(this.row('hud.jetfuel', jp.fuelPct * 100, 'jet'));
      rows.push(this.row(jp.overheated ? 'hud.overheat' : 'hud.heat', jp.heatPct * 100, jp.overheated ? 'bad blink' : 'heat'));
    }
    E.vitals.replaceChildren(...rows, h('div', { class: 'credits' }, `◇ ${st.credits.toLocaleString('en-US')}`));
    E.vitals.style.display = mode === 'pilot' || mode === 'docked' ? 'none' : '';
    // Ship panel
    const sys = st.ship;
    const ship = g.ship;
    if (mode === 'pilot' || mode === 'docked') {
      const lbState = sys.lightbreak.state;
      const lbLabel = ship.lb.phase !== 'none' ? t('hud.lb_active') : lbState === 'ready' ? t('hud.lightbreak_ready') : sys.nitro.installed ? `${t('hud.lightbreak')} ${Math.round(sys.lightbreak.charge)}%` : t('hud.lb_needs_nitro');
      E.ship.replaceChildren(
        h('div', { class: 'big' }, fmtSpeed(ship.speed)),
        h('div', { class: 'sub' }, ship.body ? `${t('hud.alt')} ${fmtDistance(Math.max(0, ship.altitude))}` : t('hud.deep_space')),
        this.row('hud.throttle', ship.throttle * 100, 'thr'),
        this.row('hud.fuel', (sys.fuel / sys.fuelCapacity) * 100, sys.fuel < 15 ? 'bad' : 'fuel'),
        this.row('hud.nitro', sys.nitro.installed ? sys.nitro.charge : 0, ship.overdrive ? 'nitro on' : 'nitro'),
        h('div', { class: `lb ${lbState === 'ready' ? 'ready' : ''} ${ship.lb.phase !== 'none' ? 'active' : ''}` }, lbLabel),
        this.row('hud.hull', sys.modules.hull.hp, sys.modules.hull.hp < 30 ? 'bad' : ''),
        this.row(g.weapons?.overheated ? 'hud.overheat' : 'hud.weapons', g.weapons?.heat || 0, g.weapons?.overheated ? 'bad blink' : 'heat'),
        this.row('hud.shield', sys.shieldCharge, 'shield'),
        ship.overdrive ? h('div', { class: 'od' }, t('hud.overdrive')) : '',
        ship.autopilot ? h('div', { class: 'ap' }, t(ship.autopilot.mode === 'land' ? 'hud.autoland' : 'hud.autopilot_on')) : '',
        ship.emergency ? h('div', { class: 'emg blink' }, t('hud.emergency_landing')) : '',
      );
      E.ship.style.display = '';
    } else E.ship.style.display = 'none';
    // Warnings
    const warns = mode === 'pilot' ? sys.warnings() : [];
    if (onFoot && this.hazard?.noAir && v.oxygen < 35) warns.push("oxygen_low");
    if (this.hazard?.hazard && v.suitEnergy < 40) warns.push('hazard');
    E.warnings.replaceChildren(...warns.map((w) => h('div', { class: 'warn blink' }, t(`warn.${w}`))));
    // Objective
    const obj = g.director.currentObjective();
    if (obj) {
      const k = this.keys();
      E.objective.replaceChildren(h('div', { class: 'label' }, t('hud.objective'), h('span', {}, ` ${g.state.tutorial.step + 1}/${TUTORIAL.length}`)), h('div', { class: 'text' }, t(`tut.${obj.id}`, k)));
      E.objective.style.display = '';
    } else E.objective.style.display = 'none';
    // Overlays
    this.hurtAmt = Math.max(0, this.hurtAmt - dt * 0.8);
    const low = Math.max(0, (35 - v.health) / 35);
    E.vignette.style.opacity = String(Math.max(this.hurtAmt, low * 0.6));
    E.flash.style.opacity = String(g.weather.flash * 0.5);
    E.water.style.opacity = g.player.underwater ? '1' : '0';
    E.signal.style.opacity = String(this.signalStrength || 0);
    E.signal.textContent = this.signalStrength ? `${t('hud.signal')} ${'▮'.repeat(Math.ceil((this.signalStrength || 0) * 8))}` : '';
    E.fps.textContent = g.settings.showFps ? `${Math.round(g.fps)} FPS · ${Math.round(g.dynScale * 100)}%` : '';
    E.crosshair.style.display = mode === 'foot' || mode === 'interior' || mode === 'pilot' ? '' : 'none';
    E.crosshair.classList.toggle('ship', mode === 'pilot');
    // Location line
    const body = g.player.mode === 'body' ? g.player.body : g.ship.body;
    const sysName = g.universe.system?.name || '';
    const hour = g.localHour;
    E.info.textContent = `${sysName}${body ? ` · ${st.isDiscovered('planets', body.id) || body.def.home ? body.def.name : t('marker.unknown_world')}` : ''}${body && hour !== undefined ? ` · ${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}` : ''}`;
    this.updateMarkers();
    this.updateCompass();
    this.drawRadar();
  }

  row(key, pct, cls) {
    const b = h('div', { class: `hrow ${cls || ''}` }, h('span', {}, t(key)), h('div', { class: 'bar' }, h('i')));
    b.querySelector('i').style.width = `${Math.max(0, Math.min(100, pct))}%`;
    return b;
  }

  collectMarkers() {
    const g = this.game;
    const out = [];
    const st = g.state;
    const mode = g.mode;
    const ship = g.ship;
    if (mode === 'foot' || mode === 'vehicle') out.push({ label: t('marker.ship'), world: ship.worldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0)), color: '#39d0ff', icon: '▲' });
    const body = g.player.mode === 'body' ? g.player.body : ship.body;
    if (body?.city && (mode === 'foot' || mode === 'vehicle' || (mode === 'pilot' && ship.body === body))) {
      out.push({ label: body.city.name, world: body.toWorld(body.city.origin), color: '#ffd28a', icon: '◆' });
    }
    if (mode === 'pilot') {
      for (const b of g.universe.bodies) {
        if (b === ship.body && ship.inAtmosphere()) continue;
        const known = st.isDiscovered('planets', b.id) || b.def.home;
        out.push({ label: known ? b.def.name : t('marker.unknown_world'), world: b.anchor.getWorldPosition(new THREE.Vector3()), color: '#cfe6ff', icon: '○', offset: b.radius });
        if (b.station && ship.body === b) out.push({ label: b.station.name, world: b.station.dockWorld(new THREE.Vector3()), color: '#6bffda', icon: '⌂' });
      }
    }
    for (const b of st.bases) {
      if (b.system !== st.location.systemId) continue;
      const bb = g.universe.body(b.body);
      if (bb && (mode !== 'pilot' || ship.body === bb)) out.push({ label: b.name, world: bb.toWorld(new THREE.Vector3(...b.pos)), color: '#39d0ff', icon: '⌂' });
    }
    for (const m of g.tools.markers) {
      const w = m.world ? m.world.clone() : m.frame ? m.frame.toWorld(m.ref ? m.ref.pos : m.local) : null;
      if (w) out.push({ label: m.label, world: w, color: m.color, icon: '◇', small: m.kind === 'deposit' || m.kind === 'fauna' });
    }
    for (const q of g.director.questMarkers()) out.push({ label: q.label, world: q.frame.toWorld(q.local), color: q.color, icon: '!' });
    const nt = g.navTarget;
    if (nt?.world) out.push({ label: nt.label, world: nt.world(), color: '#ffffff', icon: '⊕', target: true });
    return out;
  }

  updateMarkers() {
    const g = this.game;
    if (g.photo.active) { this.el.markers.style.display = 'none'; return; }
    this.el.markers.style.display = '';
    const cam = g.camera;
    const list = this.collectMarkers();
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const w = this.root.clientWidth, hgt = this.root.clientHeight;
    while (this.markerPool.length < list.length) {
      const el = h('div', { class: 'marker' }, h('b'), h('span'), h('em'));
      this.el.markers.append(el);
      this.markerPool.push(el);
    }
    this.markerPool.forEach((el, i) => {
      const m = list[i];
      if (!m) { el.style.display = 'none'; return; }
      const d = m.world.distanceTo(camPos) - (m.offset || 0);
      if (m.small && d > 350) { el.style.display = 'none'; return; }
      const p = m.world.clone().project(cam);
      let x = p.x, y = p.y;
      const behind = p.z > 1;
      if (behind) { x = -x; y = -y; }
      let edge = false;
      const lim = 0.92;
      if (behind || Math.abs(x) > lim || Math.abs(y) > lim) {
        const k = lim / Math.max(Math.abs(x), Math.abs(y), 1e-6);
        x *= k; y *= k;
        edge = true;
      }
      el.style.display = '';
      el.style.transform = `translate(${((x + 1) / 2) * w}px, ${((1 - y) / 2) * hgt}px)`;
      el.style.color = m.color;
      el.classList.toggle('edge', edge);
      el.classList.toggle('target', !!m.target);
      el.children[0].textContent = m.icon;
      el.children[1].textContent = edge && !m.target ? '' : m.label;
      el.children[2].textContent = fmtDistance(d);
    });
  }

  updateCompass() {
    const g = this.game;
    const strip = this.el.compass.firstChild;
    const p = g.player;
    const show = (g.mode === 'foot' || g.mode === 'vehicle') && p.body;
    this.el.compass.style.display = show ? '' : 'none';
    if (!show) return;
    const body = g.mode === 'vehicle' ? g.skimmer.body : p.body;
    const local = g.mode === 'vehicle' ? g.skimmer.pos : p.pos;
    const up = local.clone().normalize();
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new THREE.Vector3().crossVectors(north, up).negate();
    const camDir = g.camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(body.spin.getWorldQuaternion(new THREE.Quaternion()).invert());
    const heading = Math.atan2(camDir.dot(east), camDir.dot(north));
    const deg = ((heading * 180) / Math.PI + 360) % 360;
    strip.style.transform = `translateX(${-deg * 3}px)`;
    if (!strip.childElementCount) {
      for (let k = -1; k <= 1; k++) {
        for (let a = 0; a < 360; a += 15) {
          const lbl = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || (a % 45 === 0 ? '·' : '|');
          const s = h('i', { class: lbl.length === 1 && lbl !== '|' && lbl !== '·' ? 'card' : '' }, lbl);
          s.style.left = `${(a + k * 360) * 3}px`;
          strip.append(s);
        }
      }
    }
  }

  drawRadar() {
    const g = this.game;
    const c = this.el.radar;
    const show = (g.mode === 'foot' || g.mode === 'vehicle') && g.player.body;
    c.style.display = show ? '' : 'none';
    if (!show) return;
    const ctx = c.getContext('2d');
    const W = c.width, R = W / 2 - 4, range = 150;
    ctx.clearRect(0, 0, W, W);
    ctx.strokeStyle = 'rgba(160,220,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, W / 2, R / 2, 0, Math.PI * 2); ctx.stroke();
    const body = g.mode === 'vehicle' ? g.skimmer.body : g.player.body;
    const pos = g.mode === 'vehicle' ? g.skimmer.pos : g.player.pos;
    const up = pos.clone().normalize();
    const camDir = g.camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(body.spin.getWorldQuaternion(new THREE.Quaternion()).invert());
    const fwd = camDir.addScaledVector(up, -camDir.dot(up)).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, up);
    const plot = (p, color, size = 2.5) => {
      const d = p.clone().sub(pos);
      const x = d.dot(right), y = d.dot(fwd);
      const r = Math.hypot(x, y);
      if (r > range) return;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(W / 2 + (x / range) * R, W / 2 - (y / range) * R, size, 0, Math.PI * 2); ctx.fill();
    };
    for (const cr of body.fauna.creatures) plot(cr.pos, cr.sp.tier >= 3 ? '#ff5d5d' : '#72e08a', cr.sp.giant ? 4 : 2.5);
    if (body.city) for (const n of body.city.npcs) if (n.model.visible) plot(n.model.position, '#8fc7ff', 1.8);
    for (const m of g.tools.markers) if (m.kind === 'deposit' && m.frame === body) plot(m.local, '#ffd24d', 1.8);
    if (g.ship.body === body) plot(g.ship.root.position, '#39d0ff', 3.5);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(W / 2, W / 2 - 6); ctx.lineTo(W / 2 - 4, W / 2 + 4); ctx.lineTo(W / 2 + 4, W / 2 + 4); ctx.fill();
  }
}
