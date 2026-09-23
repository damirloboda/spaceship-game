// Entry point: boot checks, error handling, title screen.
import { Game } from './game/game.js';
import { log } from './core/log.js';
import { t } from './i18n/index.js';
import { preloadModels } from './render/modelLib.js';

const boot = document.getElementById('boot');
const bootMsg = boot?.querySelector('.boot-msg');
const bootBar = boot?.querySelector('.boot-bar i');

function fatal(msg) {
  if (bootMsg) bootMsg.textContent = msg;
  boot?.classList.add('error');
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

window.addEventListener('error', (e) => log.error('window.error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => log.error('unhandledrejection', e.reason));

async function main() {
  if (!webglAvailable()) {
    fatal('WebGL is not available on this device/browser.');
    return;
  }
  if (bootBar) bootBar.style.width = '5%';
  if (bootMsg) bootMsg.textContent = 'Loading models…';
  // Models are optional: after a timeout the game falls back to procedural ones.
  await Promise.race([
    preloadModels(undefined, (p) => { if (bootBar) bootBar.style.width = `${5 + p * 70}%`; }),
    new Promise((r) => setTimeout(r, 30000)),
  ]);
  if (bootMsg) bootMsg.textContent = 'Generating galaxy…';
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game({ canvas: document.getElementById('game'), ui: document.getElementById('ui') });
  window.__game = game; // handy for debugging and automated tests
  if (bootBar) bootBar.style.width = '100%';
  document.documentElement.style.setProperty('--ui-scale', game.settings.uiScale);
  if (game.settings.highContrastUI) document.body.classList.add('hc');
  game.menus.open('main');
  game.start();
  // Pointer lock on click while playing (desktop only).
  document.getElementById('game').addEventListener('click', () => {
    if (game.state && !game.menus.current && !game.settings.touchControls) game.input.requestLock();
    game.audio.unlock();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state && !game.menus.current) {
      game.save(true);
      game.menus.open('pause');
    }
  });
  window.addEventListener('beforeunload', () => { if (game.state) game.save(true); });
  setTimeout(() => boot?.classList.add('done'), 200);
  setTimeout(() => boot?.remove(), 1200);
}

main().catch((err) => {
  log.error('boot failed', err);
  fatal(`Boot failed: ${err?.message || err}`);
});
