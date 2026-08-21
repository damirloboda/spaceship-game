/**
 * Unified input (§55-58, §110, §113).
 *
 * Keyboard+mouse, touch (on-screen stick + buttons) and gamepad all write
 * into the same flat state object, so the rest of the game never has to know
 * which device produced an action.
 */
export class InputState {
  constructor() {
    this.move = { x: 0, y: 0 };      // strafe, forward
    this.look = { x: 0, y: 0 };      // per-frame mouse/touch delta
    this.jump = false;
    this.sprint = false;
    this.crouch = false;
    this.jetThrottle = 0;
    this.interact = false;
    this.throttle = 0;               // ship
    this.pitch = 0; this.yaw = 0; this.roll = 0;
    this.nitro = false;
    this.lightbreakHold = false;
    this.toggleView = false;
    this.menu = false;
    this.map = false;
    this.scan = false;
  }
}

export class InputManager {
  constructor(dom, state = new InputState()) {
    this.dom = dom;
    this.state = state;
    this.keys = new Set();
    this.pointerLocked = false;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.dom.addEventListener('click', () => {
      if (this.dom.requestPointerLock) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this._lookDX = (this._lookDX || 0) + e.movementX;
      this._lookDY = (this._lookDY || 0) + e.movementY;
    });

    // Gamepad: polled in update(), nothing to bind.

    // Touch: on-screen stick + buttons are wired by ui/touch.js, which calls
    // setTouch* methods below directly.
    this._touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, jump: false, sprint: false, jet: 0, interact: false };
  }

  setTouchMove(x, y) { this._touch.move.x = x; this._touch.move.y = y; }
  setTouchLook(dx, dy) { this._touch.look.x += dx; this._touch.look.y += dy; }
  setTouchButton(name, val) { this._touch[name] = val; }

  /** Call once per frame. Returns the shared InputState, mutated in place. */
  update() {
    const s = this.state;
    const k = this.keys;

    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let my = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    if (this._touch.move.x || this._touch.move.y) { mx += this._touch.move.x; my += this._touch.move.y; }
    s.move.x = Math.max(-1, Math.min(1, mx));
    s.move.y = Math.max(-1, Math.min(1, my));

    s.look.x = (this._lookDX || 0) + this._touch.look.x;
    s.look.y = (this._lookDY || 0) + this._touch.look.y;
    this._lookDX = 0; this._lookDY = 0; this._touch.look.x = 0; this._touch.look.y = 0;

    s.jump = k.has('Space') || this._touch.jump;
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || this._touch.sprint;
    s.crouch = k.has('ControlLeft') || k.has('KeyC');
    s.jetThrottle = (k.has('Space') ? 1 : 0) || this._touch.jet || 0;
    s.interact = k.has('KeyE') || this._touch.interact;
    s.nitro = k.has('KeyN');
    s.lightbreakHold = k.has('KeyB');
    s.toggleView = k.has('KeyV');
    s.menu = k.has('Escape');
    s.map = k.has('KeyM');
    s.scan = k.has('KeyF');

    // Ship axes (used only in flight mode).
    s.throttle = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0) * 0.5;
    s.pitch = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    s.yaw = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    s.roll = (k.has('KeyQ') ? 1 : 0) - (k.has('KeyE') ? 1 : 0);

    this._applyGamepad(s);
    return s;
  }

  _applyGamepad(s) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    s.move.x = Math.max(-1, Math.min(1, s.move.x + dz(gp.axes[0] || 0)));
    s.move.y = Math.max(-1, Math.min(1, s.move.y - dz(gp.axes[1] || 0)));
    s.look.x += dz(gp.axes[2] || 0) * 6;
    s.look.y += dz(gp.axes[3] || 0) * 6;
    if (gp.buttons[0]?.pressed) s.jump = true;
    if (gp.buttons[1]?.pressed) s.interact = true;
    if (gp.buttons[10]?.pressed) s.sprint = true;
    if (gp.buttons[7]) s.jetThrottle = Math.max(s.jetThrottle, gp.buttons[7].value || (gp.buttons[7].pressed ? 1 : 0));
  }
}
