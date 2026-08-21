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

function pct(el, value, max = 100) {
  if (!el) return;
  el.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
}

export function updateHUD(state) {
  const { player, ship, mode, locationLabel, weather, news, warnings, prompt, discovery } = state;

  const loc = document.getElementById('hud-location');
  if (loc) loc.textContent = locationLabel || '';
  const w = document.getElementById('hud-weather');
  if (w) w.textContent = weather ? `${weather.label} · wind ${weather.windSpeed.toFixed(0)} m/s` : '';

  if (player) {
    pct(document.getElementById('bar-health'), player.health);
    pct(document.getElementById('bar-oxygen'), player.oxygen);
    pct(document.getElementById('bar-energy'), player.energy);
    const jetRow = document.getElementById('bar-jet-row');
    if (player.jetpack && player.jetpack.installed) {
      jetRow.style.display = '';
      pct(document.getElementById('bar-jetfuel'), player.jetpack.fuelFraction * 100);
    } else if (jetRow) jetRow.style.display = 'none';
  }

  const shipPanel = document.getElementById('hud-ship');
  if (ship && mode === 'ship') {
    shipPanel.classList.remove('hidden');
    pct(document.getElementById('bar-hull'), ship.condition.hull * 100);
    pct(document.getElementById('bar-shield'), ship.shieldHp, ship.stats.shield || 1);
    pct(document.getElementById('bar-fuel'), ship.fuel, ship.fuelCapacity || 1);
    const nitroEl = document.getElementById('hud-nitro');
    nitroEl.textContent = ship.nitro.part
      ? `NITRO ${ship.nitroReady ? 'READY' : 'CHARGING'} ${ship.nitro.charge.toFixed(0)}`
      : '';
    const lbEl = document.getElementById('hud-lightbreak');
    lbEl.textContent = ship.hasLightbreak
      ? (ship.lightbreak.engaged ? `LIGHTBREAK ${(ship.lightbreak.speed / 299792458).toFixed(2)}c`
        : ship.lightbreakReady ? 'LIGHTBREAK READY' : `LIGHTBREAK ${(ship.lightbreak.charge * 100).toFixed(0)}%`)
      : '';
  } else {
    shipPanel.classList.add('hidden');
  }

  const warnEl = document.getElementById('hud-warnings');
  if (warnEl) {
    const all = [...(warnings || [])];
    warnEl.innerHTML = all.map((w2) => `<div class="warn">${w2}</div>`).join('');
  }

  const promptEl = document.getElementById('hud-prompt');
  if (promptEl) promptEl.textContent = prompt || '';

  const newsEl = document.getElementById('hud-news');
  if (newsEl && news) newsEl.textContent = news;

  const discEl = document.getElementById('hud-discovery');
  if (discEl) {
    if (discovery) {
      discEl.classList.remove('hidden');
      discEl.textContent = discovery;
    } else {
      discEl.classList.add('hidden');
    }
  }
}
