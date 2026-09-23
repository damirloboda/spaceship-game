// On-screen controls for phones and tablets: a floating move stick on the
// left, drag-to-look on the right, and context buttons per mode.
import { t } from '../i18n/index.js';
import { h } from './dom.js';

const LAYOUTS = {
  foot: [['jump', 'touch.jump'], ['interact', 'touch.use'], ['scan', 'touch.scan'], ['mine', 'touch.mine'], ['sprint', 'touch.sprint'], ['crouch', 'touch.crouch']],
  interior: [['jump', 'touch.jump'], ['interact', 'touch.use'], ['sprint', 'touch.sprint']],
  pilot: [['boost', 'touch.boost'], ['lightbreak', 'touch.lightbreak'], ['interact', 'touch.use'], ['scan', 'touch.scan'], ['jump', 'touch.up'], ['crouch', 'touch.down'], ['autopilot', 'touch.auto'], ['cutThrottle', 'touch.stop']],
  vehicle: [['interact', 'touch.use'], ['jump', 'touch.jump'], ['sprint', 'touch.boost'], ['scan', 'touch.scan']],
  docked: [['interact', 'touch.use']],
};

export class TouchControls {
  constructor(game, root) {
    this.game = game;
    this.root = h('div', { id: 'touch', class: 'hidden' });
    this.stick = h('div', { class: 'stick' }, h('i'));
    this.buttons = h('div', { class: 'tbuttons' });
    this.top = h('div', { class: 'ttop' },
      h('button', { onclick: () => game.menus.open('pause') }, '☰'),
      h('button', { onclick: () => game.menus.open('map') }, t('touch.map')),
      h('button', { onclick: () => game.menus.open('inventory') }, t('touch.bag')),
      h('button', { onclick: () => game.toggleView() }, t('touch.view')),
      h('button', { onclick: () => game.photo.toggle(true) }, '📷'));
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
      for (const tch of e.changedTouches) {
        if (tch.target.closest('button')) continue;
        if (tch.clientX < window.innerWidth * 0.42 && this.moveId === null) {
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
      e.preventDefault();
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
      const down = (e) => { e.preventDefault(); e.stopPropagation(); inp.touch.held.add(action); inp.touch.edges.add(action); b.classList.add('on'); this.game.audio.unlock(); };
      const up = (e) => { e.preventDefault(); inp.touch.held.delete(action); b.classList.remove('on'); };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
      b.addEventListener('mousedown', down);
      b.addEventListener('mouseup', up);
      return b;
    }));
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
