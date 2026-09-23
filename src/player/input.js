// Unified input: keyboard + mouse (pointer lock with drag-look fallback),
// gamepads (standard mapping) and on-screen touch controls.
export const BINDINGS = {
  forward: { keys: ['KeyW', 'ArrowUp'] },
  back: { keys: ['KeyS', 'ArrowDown'] },
  left: { keys: ['KeyA', 'ArrowLeft'] },
  right: { keys: ['KeyD', 'ArrowRight'] },
  jump: { keys: ['Space'], pad: [0] },
  sprint: { keys: ['ShiftLeft', 'ShiftRight'], pad: [10] },
  crouch: { keys: ['ControlLeft', 'KeyC'], pad: [1] },
  interact: { keys: ['KeyE'], pad: [2] },
  scan: { keys: ['KeyF'], pad: [3] },
  mine: { keys: ['KeyR'], mouse: [0], pad: [7] },
  boost: { keys: ['ShiftLeft', 'ShiftRight'], pad: [5] },
  lightbreak: { keys: ['KeyB'], pad: [11] },
  map: { keys: ['KeyM'], pad: [8] },
  inventory: { keys: ['KeyI', 'Tab'], pad: [12] },
  view: { keys: ['KeyV'], pad: [4] },
  photo: { keys: ['KeyP'], pad: [13] },
  pause: { keys: ['Escape'], pad: [9] },
  cutThrottle: { keys: ['KeyX'], pad: [14] },
  autopilot: { keys: ['KeyL'], pad: [15] },
  target: { keys: ['KeyT'] },
  journal: { keys: ['KeyJ'] },
  help: { keys: ['KeyH', 'F1'] },
  dev: { keys: ['Backquote'] },
  rollLeft: { keys: ['KeyQ'], pad: [] },
  rollRight: { keys: ['KeyZ'], pad: [] },
};

export class Input {
  constructor(target, settings) {
    this.target = target;
    this.settings = settings;
    this.keys = new Set();
    this.edges = new Set();
    this.mouseButtons = new Set();
    this.mouseEdges = new Set();
    this.look = { x: 0, y: 0 };
    this.wheel = 0;
    this.locked = false;
    this.dragging = false;
    this.enabled = true;
    this.padPrev = [];
    this.padButtons = [];
    this.padAxes = [0, 0, 0, 0];
    this.padConnected = false;
    this.touch = { move: { x: 0, y: 0 }, look: { x: 0, y: 0 }, held: new Set(), edges: new Set() };
    this.lastDevice = 'keyboard';
    this.bind();
  }

  bind() {
    const t = this.target;
    window.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (!this.keys.has(e.code)) this.edges.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Tab', 'Space', 'F1', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });
    t.addEventListener('mousedown', (e) => {
      if (!this.mouseButtons.has(e.button)) this.mouseEdges.add(e.button);
      this.mouseButtons.add(e.button);
      this.dragging = true;
      this.lastDevice = 'keyboard';
    });
    window.addEventListener('mouseup', (e) => { this.mouseButtons.delete(e.button); this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || (this.dragging && !this.settings.touchControls)) {
        this.look.x += e.movementX || 0;
        this.look.y += e.movementY || 0;
      }
    });
    t.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    t.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === t; });
    window.addEventListener('gamepadconnected', () => { this.padConnected = true; });
  }

  requestLock() {
    if (this.settings.touchControls) return;
    try {
      const r = this.target.requestPointerLock?.();
      if (r && r.catch) r.catch(() => { /* sandboxed frames refuse: drag-look fallback */ });
    } catch { /* fallback */ }
  }

  releaseLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* ignore */ }
  }

  pollGamepad() {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; } catch { pads = []; }
    const pad = pads[0];
    this.padPrev = this.padButtons;
    if (!pad) { this.padButtons = []; this.padAxes = [0, 0, 0, 0]; return; }
    this.padConnected = true;
    this.padButtons = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.padAxes = [dz(pad.axes[0] || 0), dz(pad.axes[1] || 0), dz(pad.axes[2] || 0), dz(pad.axes[3] || 0)];
    this.padTriggers = [pad.buttons[6]?.value || 0, pad.buttons[7]?.value || 0];
    if (this.padButtons.some(Boolean) || this.padAxes.some((a) => a !== 0)) this.lastDevice = 'gamepad';
  }

  held(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    if (!b) return false;
    if (b.keys?.some((k) => this.keys.has(k))) return true;
    if (b.mouse?.some((m) => this.mouseButtons.has(m)) && this.locked) return true;
    if (b.pad?.some((i) => this.padButtons[i])) return true;
    if (this.touch.held.has(action)) return true;
    return false;
  }

  pressed(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    if (!b) return false;
    if (b.keys?.some((k) => this.edges.has(k))) return true;
    if (b.mouse?.some((m) => this.mouseEdges.has(m)) && this.locked) return true;
    if (b.pad?.some((i) => this.padButtons[i] && !this.padPrev[i])) return true;
    if (this.touch.edges.has(action)) return true;
    return false;
  }

  // Movement axes in [-1, 1]: x = strafe, y = forward.
  move() {
    let x = 0, y = 0;
    if (this.held('forward')) y += 1;
    if (this.held('back')) y -= 1;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    x += this.padAxes[0];
    y -= this.padAxes[1];
    x += this.touch.move.x;
    y += this.touch.move.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  // Look deltas in radians for this frame.
  lookDelta(dt) {
    const s = this.settings.sensitivity || 1;
    const inv = this.settings.invertY ? -1 : 1;
    const dx = this.look.x * 0.0022 * s + this.padAxes[2] * dt * 2.6 * s + this.touch.look.x * 0.005 * s;
    const dy = (this.look.y * 0.0022 * s + this.padAxes[3] * dt * 2.2 * s + this.touch.look.y * 0.005 * s) * inv;
    return { x: dx, y: dy };
  }

  endFrame() {
    this.edges.clear();
    this.mouseEdges.clear();
    this.look.x = 0;
    this.look.y = 0;
    this.wheel = 0;
    this.touch.look.x = 0;
    this.touch.look.y = 0;
    this.touch.edges.clear();
  }
}
