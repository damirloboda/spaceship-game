/**
 * Minimal sci-fi HUD (§109). Plain DOM/CSS overlay — cheap, accessible,
 * trivially responsive, and it never competes with the 3D view for draw calls.
 */
export function mountHUD(root) {
  root.innerHTML = `
    <div id="hud" class="hud">
      <div class="hud-top-left">
        <div id="hud-location" class="hud-location">—</div>
        <div id="hud-weather" class="hud-weather"></div>
      </div>
      <div class="hud-top-right">
        <div id="hud-news" class="hud-news"></div>
      </div>
      <div class="hud-bars">
        <div class="bar"><span class="bar-label">HP</span><div class="bar-track"><div id="bar-health" class="bar-fill bar-health"></div></div></div>
        <div class="bar"><span class="bar-label">O₂</span><div class="bar-track"><div id="bar-oxygen" class="bar-fill bar-oxygen"></div></div></div>
        <div class="bar"><span class="bar-label">EN</span><div class="bar-track"><div id="bar-energy" class="bar-fill bar-energy"></div></div></div>
        <div class="bar" id="bar-jet-row"><span class="bar-label">JET</span><div class="bar-track"><div id="bar-jetfuel" class="bar-fill bar-jetfuel"></div></div></div>
      </div>
      <div id="hud-warnings" class="hud-warnings"></div>
      <div id="hud-prompt" class="hud-prompt"></div>
      <div id="hud-ship" class="hud-ship hidden">
        <div class="ship-row">HULL <div class="bar-track"><div id="bar-hull" class="bar-fill bar-hull"></div></div></div>
        <div class="ship-row">SHIELD <div class="bar-track"><div id="bar-shield" class="bar-fill bar-shield"></div></div></div>
        <div class="ship-row">FUEL <div class="bar-track"><div id="bar-fuel" class="bar-fill bar-fuel"></div></div></div>
        <div id="hud-nitro" class="ship-tag"></div>
        <div id="hud-lightbreak" class="ship-tag"></div>
      </div>
      <div id="hud-discovery" class="hud-discovery hidden"></div>
      <div class="hud-crosshair"></div>
    </div>`;
}

/*
 * The HUD is plain DOM over the canvas, which is cheap to build and trivially
 * responsive — but only if it is left alone. Writing every bar width and
 * innerHTML on every frame made Chromium spend ~780 ms per frame in style and
 * layout recalculation *outside* our JS (measured: 4.5 ms of script, then a
 * 782 ms gap before the next animation frame), pinning the whole game at 1.9
 * fps while the 3D scene itself rendered in 2 ms.
 *
 * So: cache what was last written and touch the DOM only when a value actually
 * changes. Bars are quantised to whole percent, which is well under one pixel
 * of movement and stops sub-pixel jitter from causing a write every frame.
 */
const els = {};
const last = {};

function el(id) {
  if (!(id in els)) els[id] = document.getElementById(id);
  return els[id];
}

/** Set a bar's width, but only when the rounded percentage has moved. */
function pct(id, value, max = 100) {
  const node = el(id);
  if (!node) return;
  const p = Math.round(Math.max(0, Math.min(100, (value / (max || 1)) * 100)));
  if (last[id] === p) return;
  last[id] = p;
  node.style.width = `${p}%`;
}

/** Set text content only when it differs from what is already displayed. */
function text(id, value) {
  const node = el(id);
  if (!node) return;
  const v = value || '';
  if (last[id] === v) return;
  last[id] = v;
  node.textContent = v;
}

function display(id, visible) {
  const node = el(id);
  if (!node) return;
  const key = `${id}:vis`;
  if (last[key] === visible) return;
  last[key] = visible;
  node.style.display = visible ? '' : 'none';
}

function toggleClass(id, cls, on) {
  const node = el(id);
  if (!node) return;
  const key = `${id}:${cls}`;
  if (last[key] === on) return;
  last[key] = on;
  node.classList.toggle(cls, on);
}

export function updateHUD(state) {
  const { player, ship, mode, locationLabel, weather, news, warnings, prompt, discovery } = state;

  text('hud-location', locationLabel);
  text('hud-weather', weather ? `${weather.label} · wind ${weather.windSpeed.toFixed(0)} m/s` : '');

  if (player) {
    pct('bar-health', player.health);
    pct('bar-oxygen', player.oxygen);
    pct('bar-energy', player.energy);
    const hasJet = !!(player.jetpack && player.jetpack.installed);
    display('bar-jet-row', hasJet);
    if (hasJet) pct('bar-jetfuel', player.jetpack.fuelFraction * 100);
  }

  const shipVisible = !!(ship && mode !== 'surface');
  toggleClass('hud-ship', 'hidden', !shipVisible);
  if (shipVisible) {
    pct('bar-hull', ship.condition.hull * 100);
    pct('bar-shield', ship.shieldHp, ship.stats.shield || 1);
    pct('bar-fuel', ship.fuel, ship.fuelCapacity || 1);
    text('hud-nitro', ship.nitro.part
      ? `NITRO ${ship.nitroReady ? 'READY' : 'CHARGING'} ${ship.nitro.charge.toFixed(0)}`
      : '');
    text('hud-lightbreak', ship.hasLightbreak
      ? (ship.lightbreak.engaged
        ? `LIGHTBREAK ${(ship.lightbreak.speed / 299792458).toFixed(2)}c`
        : ship.lightbreakReady ? 'LIGHTBREAK READY' : `LIGHTBREAK ${(ship.lightbreak.charge * 100).toFixed(0)}%`)
      : '');
  }

  // Warnings are the one list that changes shape; compare the joined string
  // before rebuilding any nodes.
  const warnKey = (warnings || []).join('|');
  if (last['warn-key'] !== warnKey) {
    last['warn-key'] = warnKey;
    const node = el('hud-warnings');
    if (node) node.innerHTML = (warnings || []).map((w) => `<div class="warn">${w}</div>`).join('');
  }

  text('hud-prompt', prompt);
  text('hud-news', news);

  const discEl = el('hud-discovery');
  if (discEl) {
    toggleClass('hud-discovery', 'hidden', !discovery);
    if (discovery) text('hud-discovery', discovery);
  }
}
