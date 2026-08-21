/**
 * Touchscreen controls (§55, §110). A left-side virtual stick for movement
 * and right-side buttons for jump/interact/sprint, all writing into the same
 * InputManager the keyboard uses.
 */
export function mountTouchControls(root, input) {
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const wrap = document.createElement('div');
  wrap.className = 'touch-ui' + (isTouch ? ' active' : '');
  wrap.innerHTML = `
    <div class="touch-stick" id="touch-stick"><div class="touch-stick-nub" id="touch-nub"></div></div>
    <div class="touch-btn jump" id="touch-jump">JUMP</div>
    <div class="touch-btn interact" id="touch-interact">USE</div>
    <div class="touch-btn sprint" id="touch-sprint">RUN</div>`;
  root.appendChild(wrap);
  if (!isTouch) return;

  const stick = wrap.querySelector('#touch-stick');
  const nub = wrap.querySelector('#touch-nub');
  let stickId = null, stickOrigin = { x: 0, y: 0 };

  stick.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    stickId = t.identifier;
    const r = stick.getBoundingClientRect();
    stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      const dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
      const max = 42;
      const len = Math.hypot(dx, dy) || 1;
      const cl = Math.min(1, len / max);
      const nx = (dx / len) * cl, ny = (dy / len) * cl;
      nub.style.transform = `translate(${nx * max}px, ${ny * max}px)`;
      input.setTouchMove(nx, -ny);
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      stickId = null;
      nub.style.transform = 'translate(0,0)';
      input.setTouchMove(0, 0);
    }
  });

  // Look: drag anywhere on the right half of the screen.
  let lookId = null, lastLook = { x: 0, y: 0 };
  window.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth / 2) continue;
      if (lookId !== null) continue;
      lookId = t.identifier;
      lastLook = { x: t.clientX, y: t.clientY };
    }
  });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId) continue;
      input.setTouchLook((t.clientX - lastLook.x) * 2.2, (t.clientY - lastLook.y) * 2.2);
      lastLook = { x: t.clientX, y: t.clientY };
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  });

  const bindHold = (id, name) => {
    const el = wrap.querySelector(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); input.setTouchButton(name, true); });
    el.addEventListener('touchend', (e) => { e.preventDefault(); input.setTouchButton(name, false); });
  };
  bindHold('#touch-jump', 'jump');
  bindHold('#touch-jump', 'jet');
  bindHold('#touch-interact', 'interact');
  bindHold('#touch-sprint', 'sprint');
}
