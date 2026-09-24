// On-screen controls for phones and tablets: a floating move stick on the
// left, drag-to-look on the right, and context buttons per mode.
import { t } from '../i18n/index.js';
import { h } from './dom.js';

const LAYOUTS = {
  foot: [['jump', 'touch.jump'], ['interact', 'touch.use'], ['scan', 'touch.scan'], ['mine', 'touch.mine'], ['sprint', 'touch.sprint'], ['crouch', 'touch.crouch']],
  interior: [['jump', 'touch.jump'], ['interact', 'touch.use'], ['sprint', 'touch.sprint']],
  pilot: [['mine', 'touch.fire'], ['boost', 'touch.boost'], ['lightbreak', 'touch.lightbreak'], ['interact', 'touch.use'], ['scan', 'touch.scan'], ['jump', 'touch.up'], ['crouch', 'touch.down'], ['autopilot', 'touch.auto'], ['cutThrottle', 'touch.stop']],
  vehicle: [['interact', 'touch.use'], ['jump', 'touch.jump'], ['sprint', 'touch.boost'], ['scan', 'touch.scan']],
  docked: [['interact', 'touch.use']],
};

export class TouchControls {
  constructor(game, root) {
    this.game = game;
    this.root = h('div', { id: 'touch', class: 'hidden' });
    this.stick = h('div', { class: 'stick' }, h('i'));
    this.buttons = h('div', { class: 'tbuttons' });
    // Top bar buttons fire on touchend themselves: the stick/look layer
    // cancels default touch behaviour, which would swallow their clicks.
    const tap = (label, fn) => {
      const b = h('button', {}, label);
      let touched = false;
      b.addEventListener('touchstart', (e) => { e.stopPropagation(); touched = true; b.classList.add('on'); }, { passive: true });
      b.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.remove('on'); if (touched) { touched = false; this.game.audio.play('ui'); this.buzz(8); fn(); } });
      b.addEventListener('touchcancel', () => { touched = false; b.classList.remove('on'); });
      b.addEventListener('click', () => fn());
      return b;
    };
    this.top = h('div', { class: 'ttop' },
      tap('☰', () => game.menus.open('pause')),
      tap(t('touch.map'), () => game.menus.open('map')),
      tap(t('touch.bag'), () => game.menus.open('inventory')),
      tap(t('touch.view'), () => game.toggleView()),
      tap('📷', () => game.photo.toggle(true)));
    this.root.append(this.stick, this.buttons, this.top);
    root.append(this.root);
    this.moveId = null;
    this.lookId = null;
    this.origin = { x: 0, y: 0 };
    this.last = { x: 0, y: 0 };
    this.mode = 'foot';
    this.bind();
  }

  bind() {
    const el = this.root;
    const inp = this.game.input;
    el.addEventListener('touchstart', (e) => {
      this.game.audio.unlock();
      let onButton = true;
      for (const tch of e.changedTouches) {
        if (tch.target.closest('button')) continue;
        onButton = false;
        if (tch.clientX < window.innerWidth * 0.45 && this.moveId === null) {
          this.moveId = tch.identifier;
          this.origin = { x: tch.clientX, y: tch.clientY };
          this.stick.style.left = `${tch.clientX}px`;
          this.stick.style.top = `${tch.clientY}px`;
          this.stick.classList.add('on');
        } else if (this.lookId === null) {
          this.lookId = tch.identifier;
          this.last = { x: tch.clientX, y: tch.clientY };
        }
      }
      if (!onButton) e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === this.moveId) {
          const dx = tch.clientX - this.origin.x, dy = tch.clientY - this.origin.y;
          const r = 55;
          const l = Math.hypot(dx, dy);
          const k = l > r ? r / l : 1;
          inp.touch.move.x = (dx * k) / r;
          inp.touch.move.y = -(dy * k) / r;
          this.stick.firstChild.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        } else if (tch.identifier === this.lookId) {
          inp.touch.look.x += tch.clientX - this.last.x;
          inp.touch.look.y += tch.clientY - this.last.y;
          this.last = { x: tch.clientX, y: tch.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const tch of e.changedTouches) {
        if (tch.identifier === this.moveId) {
          this.moveId = null;
          inp.touch.move.x = 0;
          inp.touch.move.y = 0;
          this.stick.classList.remove('on');
          this.stick.firstChild.style.transform = '';
        } else if (tch.identifier === this.lookId) this.lookId = null;
      }
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  setMode(mode) {
    this.mode = mode;
    this.root.dataset.mode = mode;
    const inp = this.game.input;
    inp.touch.held.clear();
    const layout = LAYOUTS[mode] || [];
    this.buttons.replaceChildren(...layout.map(([action, key]) => {
      const b = h('button', { class: `tb tb-${action}` }, t(key));
      const down = (e) => { e.preventDefault(); e.stopPropagation(); inp.touch.held.add(action); inp.touch.edges.add(action); b.classList.add('on'); this.game.audio.unlock(); this.buzz(8); };
      const up = (e) => { e.preventDefault(); inp.touch.held.delete(action); b.classList.remove('on'); };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      return b;
    }));
  }

  // Called every frame: the USE button pulses and shows what it will do.
  setInteraction(it) {
    const b = this.buttons.querySelector('.tb-interact');
    if (!b) return;
    const label = it ? t(it.key, it.params) : '';
    if (b.dataset.label === label) return;
    b.dataset.label = label;
    b.classList.toggle('ready', !!it);
    b.classList.toggle('land', it?.key === 'prompt.autoland');
    b.replaceChildren(h('span', {}, t('touch.use')), label ? h('small', {}, label) : '');
  }

  // Short vibration on phones that support it.
  buzz(ms = 12) {
    if (!this.game.settings.touchControls || this.game.settings.reducedMotion) return;
    try { navigator.vibrate?.(ms); } catch { /* not supported */ }
  }

  relabel() {
    this.setMode(this.mode);
  }

  refresh() {
    const on = !!this.game.settings.touchControls && !!this.game.state;
    this.root.classList.toggle('hidden', !on);
    document.body.classList.toggle('touch', on);
  }
}
