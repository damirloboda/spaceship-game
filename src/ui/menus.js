// All menu panels. Kept compact on purpose: the game is primary, UI secondary.
import * as THREE from 'three';
import { t, LANGUAGES, getLanguage } from '../i18n/index.js';
import { ItemViewer } from './itemViewer.js';
import { CHARACTER_MODELS as CHARACTER_PORTRAITS } from '../render/modelLib.js';
import { h, fmtDistance, bar } from './dom.js';
import { ITEMS, itemDef } from '../game/items.js';
import { PC_PRESETS, MOBILE_PRESETS, saveSettings } from '../config/settings.js';
import { DEV, VERSION } from '../config/build.js';
import { SKILLS } from '../game/state.js';
import { RECIPES, RESEARCH } from '../game/tools.js';
import { MODULE_IDS } from '../game/shipSystems.js';
import { reputationTier } from '../game/economy.js';
import { systemsNear, systemPosition, summarizeSystem, generateSystem, STAR_TYPES, HOME_SYSTEM_ID, PLANET_PROFILES } from '../world/galaxy.js';
import { CIVILIZATIONS } from '../world/civGen.js';
import { guardStatus, log } from '../core/log.js';

const SUIT_COLORS = ['#e8eef5', '#f2a33a', '#3a7bf2', '#d94a4a', '#3fbf7f', '#8a5cf0', '#2b2f36', '#f2e14a'];
const VISOR_COLORS = ['#39d0ff', '#ffb13d', '#ff4f8b', '#7dff6b', '#ffffff', '#b58bff'];
const SELLABLE = ['ferrite', 'carbon', 'cobalt', 'oxyite', 'aurum', 'ice', 'biosample', 'mineral_sample', 'relic', 'fossil', 'crystal_core'];

export class Menus {
  constructor(game, root) {
    this.game = game;
    this.overlay = h('div', { id: 'overlay', class: 'hidden' });
    root.append(this.overlay);
    this.stack = [];
    this.current = null;
    this.devAvailable = DEV;
    this.mapState = { tab: 'sector', selected: null, zoom: 1 };
  }

  open(name, data = {}) {
    const g = this.game;
    if (this.current?.name === name) return;
    this.stack.push({ name, data });
    this.current = this.stack[this.stack.length - 1];
    if (g.state && name !== 'main' && name !== 'creator') g.paused = true;
    g.input.releaseLock();
    document.body.classList.add('menu-open');
    this.render();
    g.audio.play('ui');
  }

  back() {
    this.stack.pop();
    this.current = this.stack[this.stack.length - 1] || null;
    if (!this.current) this.closeAll();
    else this.render();
    this.game.audio.play('ui_back');
  }

  closeAll() {
    this.stack = [];
    this.current = null;
    this.overlay.classList.add('hidden');
    this.overlay.replaceChildren();
    document.body.classList.remove('menu-open');
    if (this.game.ship) this.game.ship.model.nitro.open = false;
    if (this.game.state) this.game.paused = false;
  }

  refresh() {
    if (this.current) this.render();
  }

  render() {
    const c = this.current;
    const fn = this[`p_${c.name}`];
    if (!fn) { log.warn(`missing panel ${c.name}`); this.back(); return; }
    this.overlay.classList.remove('hidden');
    this.overlay.dataset.panel = c.name;
    const scrollEl = this.overlay.querySelector('.panel-body');
    const scroll = scrollEl ? scrollEl.scrollTop : 0;
    this.overlay.replaceChildren(fn.call(this, c.data));
    const nb = this.overlay.querySelector('.panel-body');
    if (nb) nb.scrollTop = scroll;
  }

  update() {
    if (this.current?.name === 'map') this.drawMap();
  }

  // ---------------- building blocks ----------------
  panel(titleKey, body, { wide = false, noClose = false, cls = '', titleText } = {}) {
    return h('div', { class: `panel ${wide ? 'wide' : ''} ${cls}` },
      h('div', { class: 'panel-head' }, h('h2', {}, titleText || t(titleKey)), noClose ? '' : h('button', { class: 'x', onclick: () => this.back(), 'aria-label': t('ui.close') }, '✕')),
      h('div', { class: 'panel-body' }, body));
  }

  btn(key, onclick, { cls = '', disabled = false, params, text } = {}) {
    return h('button', { class: `btn ${cls}`, onclick: disabled ? null : (e) => { e.stopPropagation(); onclick(); }, disabled }, text || t(key, params));
  }

  itemChip(id, n) {
    const d = itemDef(id);
    return h('span', { class: 'chip', style: { '--c': d.color } }, h('b', {}, d.glyph), ` ${t(`item.${id}`)}${n !== undefined ? ` ×${n}` : ''}`);
  }

  // ---------------- title & creator ----------------
  p_main() {
    const g = this.game;
    const meta = g.saves.meta();
    return h('div', { class: 'title-screen' },
      h('div', { class: 'logo' }, h('span', {}, 'ULTRA'), h('span', { class: 'b' }, 'COSMOS')),
      h('div', { class: 'tagline' }, t('title.tagline')),
      h('div', { class: 'menu-col' },
        meta ? this.btn('title.continue', () => { g.audio.unlock(); if (!g.continueGame()) g.hud.toast('hud.load_failed', 'warn'); }, { cls: 'primary' }) : '',
        meta ? h('div', { class: 'meta' }, `${meta.name || ''} · ${new Date(meta.savedAt).toLocaleString()}`) : '',
        this.btn('title.new_game', () => { g.audio.unlock(); this.open('creator'); }, { cls: meta ? '' : 'primary' }),
        this.btn('title.settings', () => this.open('settings')),
        this.btn('title.import', () => this.open('import')),
        this.btn('title.help', () => this.open('help')),
      ),
      h('div', { class: 'version' }, `v${VERSION} · ${t('title.slice')}`));
  }

  p_creator() {
    const g = this.game;
    const d = this.current.data;
    d.name = d.name ?? t('creator.default_name');
    d.suit = d.suit || SUIT_COLORS[0];
    d.visor = d.visor || VISOR_COLORS[0];
    d.build = d.build || 'standard';
    d.character = d.character | 0;
    const swatches = (list, key) => h('div', { class: 'swatches' }, list.map((c) => h('button', { class: `sw ${d[key] === c ? 'on' : ''}`, style: { background: c }, onclick: () => { d[key] = c; this.refresh(); }, 'aria-label': c })));
    const input = h('input', { type: 'text', value: d.name, maxlength: 20, oninput: (e) => { d.name = e.target.value; } });
    return this.panel('creator.title', [
      h('label', {}, t('creator.name'), input),
      h('label', {}, t('creator.character')),
      h('div', { class: 'seg' }, ['🦩 Fernando', '🐸 Finn', '🐝 Barbara'].map((label, i) => h('button', { class: d.character === i ? 'on' : '', onclick: () => { d.character = i; this.refresh(); } }, label))),
      h('label', {}, t('creator.suit')), swatches(SUIT_COLORS, 'suit'),
      h('label', {}, t('creator.visor')), swatches(VISOR_COLORS, 'visor'),
      h('label', {}, t('creator.build')),
      h('div', { class: 'seg' }, ['compact', 'standard', 'tall'].map((b) => h('button', { class: d.build === b ? 'on' : '', onclick: () => { d.build = b; this.refresh(); } }, t(`creator.build_${b}`)))),
      h('div', { class: 'preview', style: { '--suit': d.suit, '--visor': d.visor } }, h('img', { class: 'portrait', src: `assets/ui/char-${d.character}.jpg`, alt: '' })),
      h('p', { class: 'muted' }, t('creator.intro')),
      this.btn('creator.begin', () => {
        const name = (d.name || '').trim() || t('creator.default_name');
        this.closeAll();
        g.newGame({ name, suit: d.suit, visor: d.visor, build: d.build, character: d.character });
      }, { cls: 'primary' }),
    ]);
  }

  p_import() {
    const g = this.game;
    const ta = h('textarea', { rows: 6, placeholder: t('import.placeholder') });
    return this.panel('import.title', [
      ta,
      this.btn('import.load', () => {
        try {
          const state = g.saves.importString(ta.value);
          this.closeAll();
          g.begin(state);
        } catch {
          g.hud.toast('hud.import_failed', 'warn');
        }
      }, { cls: 'primary' }),
    ]);
  }

  // ---------------- pause ----------------
  p_pause() {
    const g = this.game;
    return this.panel('pause.title', h('div', { class: 'menu-col' },
      this.btn('pause.resume', () => this.closeAll(), { cls: 'primary' }),
      this.btn('pause.save', () => { g.save(); }),
      this.btn('pause.inventory', () => this.open('inventory')),
      this.btn('pause.map', () => this.open('map')),
      this.btn('pause.journal', () => this.open('journal')),
      this.btn('pause.settings', () => this.open('settings')),
      this.btn('pause.help', () => this.open('help')),
      this.btn('pause.export', () => this.open('export')),
      this.devAvailable ? this.btn('pause.dev', () => this.open('dev')) : '',
      this.btn('pause.quit', () => { g.save(); location.reload(); }, { cls: 'danger' }),
    ));
  }

  p_export() {
    const str = this.game.saves.exportString(this.game.state);
    const ta = h('textarea', { rows: 6, readonly: true }, str);
    return this.panel('export.title', [h('p', { class: 'muted' }, t('export.info')), ta, this.btn('export.copy', () => { ta.select(); try { navigator.clipboard?.writeText(str); } catch { document.execCommand('copy'); } this.game.hud.toast('hud.copied', 'accent'); })]);
  }

  // ---------------- settings ----------------
  p_settings(data) {
    const g = this.game;
    const s = g.settings;
    const tab = data.tab || 'graphics';
    const tabs = ['graphics', 'audio', 'controls', 'accessibility', 'gameplay', 'language'];
    const set = (k, v, apply) => { s[k] = v; saveSettings(s); if (apply) apply(); this.refresh(); };
    const toggle = (k, apply) => h('button', { class: `toggle ${s[k] ? 'on' : ''}`, onclick: () => set(k, !s[k], apply) }, s[k] ? t('ui.on') : t('ui.off'));
    const slider = (k, min, max, step, apply) => h('input', { type: 'range', min, max, step, value: s[k], oninput: (e) => { s[k] = Number(e.target.value); saveSettings(s); apply?.(); }, onchange: () => this.refresh() });
    const row = (key, ctrl, val) => h('div', { class: 'srow' }, h('span', {}, t(key)), ctrl, val !== undefined ? h('em', {}, val) : '');
    let body;
    if (tab === 'graphics') {
      const presets = s.platform === 'mobile' ? MOBILE_PRESETS : PC_PRESETS;
      body = [
        row('settings.platform', h('div', { class: 'seg' }, ['pc', 'mobile'].map((p) => h('button', { class: s.platform === p ? 'on' : '', onclick: () => { s.platform = p; s.preset = p === 'mobile' ? 'BALANCED' : 'HIGH'; saveSettings(s); g.applyGraphics(); this.refresh(); } }, t(`settings.platform_${p}`))))),
        row('settings.preset', h('div', { class: 'seg wrap' }, Object.keys(presets).map((p) => h('button', { class: s.preset === p ? 'on' : '', onclick: () => set('preset', p, () => g.applyGraphics()) }, p.replace('_', ' '))))),
        row('settings.dynres', toggle('dynamicResolution')),
        row('settings.fov', slider('fov', 60, 100, 1, () => { g.fovKick = s.fov; }), `${s.fov}°`),
        row('settings.fps', toggle('showFps')),
        h('p', { class: 'muted' }, t('settings.graphics_note')),
      ];
    } else if (tab === 'audio') {
      body = [
        row('settings.master', slider('masterVolume', 0, 1, 0.05, () => g.audio.applyVolume()), `${Math.round(s.masterVolume * 100)}%`),
        row('settings.sfx', slider('sfxVolume', 0, 1, 0.05, () => g.audio.applyVolume()), `${Math.round(s.sfxVolume * 100)}%`),
        row('settings.subtitles', toggle('subtitles')),
      ];
    } else if (tab === 'controls') {
      body = [
        row('settings.sensitivity', slider('sensitivity', 0.2, 3, 0.05), s.sensitivity.toFixed(2)),
        row('settings.invert', toggle('invertY')),
        row('settings.touch', toggle('touchControls', () => g.touch.refresh())),
        row('settings.third', toggle('thirdPerson', () => { g.cameraMode = s.thirdPerson ? 'third' : 'first'; if (g.state) g.updateCameraParent(); })),
        this.btn('settings.show_controls', () => this.open('help')),
      ];
    } else if (tab === 'accessibility') {
      body = [
        row('settings.shake', toggle('cameraShake')),
        row('settings.reduced_motion', toggle('reducedMotion')),
        row('settings.contrast', toggle('highContrastUI', () => document.body.classList.toggle('hc', s.highContrastUI))),
        row('settings.ui_scale', slider('uiScale', 0.8, 1.4, 0.05, () => document.documentElement.style.setProperty('--ui-scale', s.uiScale)), `${Math.round(s.uiScale * 100)}%`),
      ];
    } else if (tab === 'gameplay') {
      body = [row('settings.auto_refuel', toggle('autoRefuelJetpack'))];
    } else {
      body = [h('div', { class: 'menu-col' }, Object.entries(LANGUAGES).map(([code, name]) => h('button', { class: `btn ${getLanguage() === code ? 'primary' : ''}`, onclick: () => { g.setLanguage(code); this.refresh(); } }, name)))];
    }
    return this.panel('settings.title', [
      h('div', { class: 'tabs' }, tabs.map((tb) => h('button', { class: tab === tb ? 'on' : '', onclick: () => { this.current.data.tab = tb; this.refresh(); } }, t(`settings.tab_${tb}`)))),
      h('div', { class: 'settings-body' }, body),
    ], { wide: true });
  }

  // ---------------- inventory ----------------
  p_inventory(data) {
    const g = this.game;
    const st = g.state;
    const sel = data.sel;
    const nearCargo = g.mode === 'interior' || g.mode === 'pilot' || g.mode === 'docked' || (g.ship.landed && g.player.body === g.ship.body && g.player.pos.distanceTo(g.ship.root.position) < 40);
    const grid = (inv, where) => h('div', { class: 'grid' },
      Array.from({ length: inv.slots }, (_, i) => {
        const s = inv.items[i];
        if (!s) return h('div', { class: 'slot empty' });
        const d = itemDef(s.id);
        return h('button', { class: `slot ${sel && sel.where === where && sel.index === i ? 'on' : ''}`, style: { '--c': d.color }, onclick: () => { data.sel = { where, index: i, id: s.id }; this.refresh(); }, title: t(`item.${s.id}`) }, h('b', {}, d.glyph), h('i', { class: 'slot-name' }, t(`item.${s.id}`)), h('em', {}, s.n));
      }));
    const actions = [];
    if (sel) {
      const inv = sel.where === 'suit' ? st.suit : st.cargo;
      const s = inv.items[sel.index];
      if (s) {
        actions.push(h('div', { class: 'sel-title' }, this.itemChip(s.id, s.n)), h('p', { class: 'muted' }, t(`desc.${s.id}`)));
        const usable = ['medkit', 'ration', 'water', 'energy_cell', 'jet_fuel', 'fuel_cell', 'nitro_cell', 'jetpack', 'jetpack_mk2', 'scanner_mk2', 'engine_mk2', 'cargo_ext', 'skimmer', 'base_kit'];
        if (usable.includes(s.id)) actions.push(this.btn('inv.use', () => { if (g.tools.useItem(s.id)) { data.sel = null; if (s.id === 'base_kit') this.closeAll(); else this.refresh(); } }, { cls: 'primary' }));
        if (s.id === 'nitro') actions.push(h('p', { class: 'hint' }, t('inv.nitro_hint')));
        if (nearCargo) actions.push(this.btn(sel.where === 'suit' ? 'inv.to_cargo' : 'inv.to_suit', () => { (sel.where === 'suit' ? st.suit : st.cargo).transfer(s.id, s.n, sel.where === 'suit' ? st.cargo : st.suit); data.sel = null; this.refresh(); }));
        actions.push(this.btn('inv.drop', () => { inv.remove(s.id, 1); this.refresh(); }, { cls: 'danger' }));
      }
    }
    const skillRows = SKILLS.map((sk) => {
      const lvl = st.skillLevel(sk);
      const xp = st.skills[sk] || 0;
      const cur = lvl * lvl * 40, next = (lvl + 1) * (lvl + 1) * 40;
      return h('div', { class: 'hrow' }, h('span', {}, `${t(`skill.${sk}`)} ${lvl}`), bar(((xp - cur) / (next - cur)) * 100));
    });
    const rep = st.reputation.veyari || 0;
    return this.panel('inv.title', [
      h('div', { class: 'cols' },
        h('div', {},
          h('h3', {}, t('inv.suit'), h('span', { class: 'muted' }, ` ${st.suit.items.length}/${st.suit.slots}`)), grid(st.suit, 'suit'),
          h('h3', {}, t('inv.cargo'), h('span', { class: 'muted' }, ` ${st.cargo.items.length}/${st.cargo.slots}${nearCargo ? '' : ` · ${t('inv.cargo_remote')}`}`)), grid(st.cargo, 'cargo')),
        h('div', { class: 'side' },
          actions.length ? h('div', { class: 'card' }, actions) : h('p', { class: 'muted' }, t('inv.select')),
          h('div', { class: 'card' },
            h('h3', {}, st.profile.name, h('span', { class: 'muted' }, ` · ${t(`profession.${st.primaryProfession()}`)}`)),
            h('div', {}, `◇ ${st.credits.toLocaleString('en-US')}`),
            h('div', {}, `${t('inv.jetpack')}: ${st.jetpack.owned ? t(`jetpack.${st.jetpack.model}`) : t('inv.none')}`),
            h('div', {}, `${t('inv.nitro')}: ${st.ship.nitro.installed ? t('inv.installed') : st.count('nitro') ? t('inv.in_inventory') : t('inv.none')}`),
            h('div', {}, `${t('inv.reputation')}: ${t(`rep.${reputationTier(rep)}`)} (${Math.round(rep)})`),
            ...skillRows))),
    ], { wide: true });
  }

  // ---------------- map ----------------
  p_map(data) {
    const g = this.game;
    const ms = this.mapState;
    if (data.tab) { ms.tab = data.tab; data.tab = null; }
    const tabs = ['galaxy', 'sector', 'system', 'planet', 'location'];
    const canvas = h('canvas', { class: 'mapcanvas', width: 900, height: 600, onclick: (e) => this.mapClick(e) });
    this.mapCanvas = canvas;
    const info = h('div', { class: 'mapinfo' });
    this.mapInfo = info;
    const panel = this.panel('map.title', [
      h('div', { class: 'tabs' }, tabs.map((tb) => h('button', { class: ms.tab === tb ? 'on' : '', onclick: () => { ms.tab = tb; ms.selected = null; this.refresh(); } }, t(`map.${tb}`)))),
      h('div', { class: 'mapwrap' }, canvas, info),
    ], { wide: true, cls: 'mappanel' });
    setTimeout(() => this.renderMapInfo(), 0);
    return panel;
  }

  mapData() {
    const g = this.game;
    const here = systemPosition(g.state.location.systemId);
    if (!this.sectorCache || this.sectorCache.id !== g.state.location.systemId) {
      this.sectorCache = { id: g.state.location.systemId, list: systemsNear(here, 36) };
    }
    return { here, list: this.sectorCache.list };
  }

  drawMap() {
    const c = this.mapCanvas;
    if (!c || !c.isConnected) return;
    const g = this.game;
    const ms = this.mapState;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(4,8,16,0.9)';
    ctx.fillRect(0, 0, W, H);
    const tnow = performance.now() / 1000;
    this.mapHits = [];
    if (ms.tab === 'galaxy') {
      // Stylised spiral galaxy, deterministic.
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < 2600; i++) {
        const arm = i % 4;
        const r = Math.pow((i * 7919) % 1000 / 1000, 0.6) * 270;
        const a = arm * (Math.PI / 2) + r * 0.022 + (((i * 104729) % 100) / 100 - 0.5) * 0.7;
        const x = cx + Math.cos(a) * r * 1.5, y = cy + Math.sin(a) * r * 0.8;
        ctx.fillStyle = `rgba(${180 + (i % 70)},${170 + (i % 60)},255,${0.25 + (i % 10) / 20})`;
        ctx.fillRect(x, y, 1.5, 1.5);
      }
      const here = systemPosition(g.state.location.systemId);
      const hx = cx + (here[0] - 2000) / 20, hy = cy + (here[2] - 800) / 20;
      ctx.strokeStyle = '#39d0ff';
      ctx.beginPath(); ctx.arc(hx, hy, 8 + Math.sin(tnow * 3) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#39d0ff'; ctx.font = '14px monospace';
      ctx.fillText(t('map.you_are_here'), hx + 12, hy + 4);
      ctx.fillStyle = 'rgba(200,220,255,0.6)';
      ctx.fillText(t('map.known_systems', { n: Object.keys(g.state.discoveries.systems).length }), 20, H - 20);
      return;
    }
    if (ms.tab === 'sector') {
      const { here, list } = this.mapData();
      const scale = (Math.min(W, H) / 2 - 30) / 36;
      const cx = W / 2, cy = H / 2;
      ctx.strokeStyle = 'rgba(100,160,220,0.15)';
      for (const r of [12, 24, 36]) { ctx.beginPath(); ctx.arc(cx, cy, r * scale, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = 'rgba(120,170,220,0.4)'; ctx.fillText(`${r} LY`, cx + r * scale + 4, cy); }
      const target = g.navTarget?.systemId;
      for (const s of list) {
        const x = cx + (s.position[0] - here[0]) * scale;
        const y = cy + (s.position[2] - here[2]) * scale;
        const col = STAR_TYPES[s.starType].color;
        const visited = g.state.isDiscovered('systems', s.id);
        if (s.unknownRegion && !visited) {
          // Signal-dead region: a shimmer, no reliable data.
          ctx.fillStyle = `rgba(160,120,255,${0.18 + 0.12 * Math.sin(tnow * 2 + x)})`;
          ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = s.starType === 'black_hole' ? '#ff7b3d' : `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`;
          ctx.beginPath(); ctx.arc(x, y, s.starType === 'black_hole' ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
          if (visited) { ctx.strokeStyle = '#39d0ff'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke(); }
        }
        if (s.id === g.state.story.flags.precursorTarget) { ctx.strokeStyle = '#c78bff'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
        if (s.id === target || s.id === ms.selected) {
          ctx.strokeStyle = s.id === target ? '#fff' : '#ffd24d';
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.fillText(s.unknownRegion && !visited ? '???' : s.name, x + 8, y + 4);
        }
        this.mapHits.push({ x, y, r: 10, id: s.id, s });
      }
      ctx.fillStyle = '#39d0ff';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(g.universe.system.name, cx + 8, cy - 8);
      return;
    }
    if (ms.tab === 'system') {
      const uni = g.universe;
      let maxR = 1;
      for (const b of uni.bodies) maxR = Math.max(maxR, Math.hypot(b.def.position[0], b.def.position[2]));
      const scale = (Math.min(W, H) / 2 - 40) / maxR;
      const cx = W / 2, cy = H / 2;
      ctx.fillStyle = uni.system.star.type === 'black_hole' ? '#ff7b3d' : '#ffe9a8';
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fill();
      for (const b of uni.bodies) {
        const x = cx + b.def.position[0] * scale, y = cy + b.def.position[2] * scale;
        if (b.def.kind === 'planet') { ctx.strokeStyle = 'rgba(120,170,220,0.15)'; ctx.beginPath(); ctx.arc(cx, cy, Math.hypot(x - cx, y - cy), 0, Math.PI * 2); ctx.stroke(); }
        const known = g.state.isDiscovered('planets', b.id) || b.def.home;
        ctx.fillStyle = known ? '#cfe6ff' : '#6b7a8c';
        ctx.beginPath(); ctx.arc(x, y, b.def.kind === 'moon' ? 3 : 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(known ? b.def.name : '?', x + 8, y + (b.def.kind === 'moon' ? 12 : 4));
        this.mapHits.push({ x, y, r: 12, body: b });
      }
      for (const a of uni.anomalies) {
        if (a.def.hidden) continue;
        const x = cx + a.def.position[0] * scale, y = cy + a.def.position[2] * scale;
        ctx.fillStyle = '#c78bff'; ctx.fillRect(x - 3, y - 3, 6, 6);
        ctx.fillText(t(`anomaly.${a.def.type}`), x + 6, y + 4);
      }
      const sw = g.ship.worldPosition(new THREE.Vector3());
      ctx.fillStyle = '#39d0ff';
      ctx.beginPath(); ctx.arc(cx + sw.x * scale, cy + sw.z * scale, 4, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // planet & location views are info-only: draw a globe
    const body = ms.tab === 'planet' ? (ms.selectedBody || g.activeBody || g.player.body || g.universe.bodies[0]) : (g.player.body || g.ship.body || g.activeBody);
    if (!body) return;
    const cx = W / 2, cy = H / 2, R = 200;
    const grd = ctx.createRadialGradient(cx - 60, cy - 60, 20, cx, cy, R);
    const c0 = PLANET_PROFILES[body.def.type]?.sky || [0.5, 0.5, 0.5];
    grd.addColorStop(0, `rgb(${c0.map((v) => Math.round(v * 200 + 40)).join(',')})`);
    grd.addColorStop(1, 'rgb(10,14,20)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    if (ms.tab === 'location' && g.player.mode === 'body') {
      const p = g.player.pos.clone().normalize();
      const lat = Math.asin(p.y), lon = Math.atan2(p.z, p.x);
      ctx.fillStyle = '#39d0ff';
      ctx.beginPath(); ctx.arc(cx + Math.cos(lat) * Math.sin(lon) * R * 0.9, cy - Math.sin(lat) * R * 0.9, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(`${(lat * 57.3).toFixed(2)}°, ${(lon * 57.3).toFixed(2)}°`, 20, H - 20);
    }
  }

  mapClick(e) {
    const c = this.mapCanvas;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * c.width;
    const y = ((e.clientY - rect.top) / rect.height) * c.height;
    let best = null, bd = 16;
    for (const hit of this.mapHits || []) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d < bd) { bd = d; best = hit; }
    }
    if (!best) return;
    if (best.s) this.mapState.selected = best.id;
    if (best.body) { this.mapState.selectedBody = best.body; this.mapState.selected = best.body.id; }
    this.renderMapInfo();
  }

  renderMapInfo() {
    const g = this.game;
    const ms = this.mapState;
    const info = this.mapInfo;
    if (!info) return;
    const rows = [];
    if (ms.tab === 'sector' && ms.selected) {
      const { list } = this.mapData();
      const s = list.find((x) => x.id === ms.selected);
      if (s) {
        const visited = g.state.isDiscovered('systems', s.id);
        const hidden = s.unknownRegion && !visited;
        const fuel = g.state.ship.lightbreakCost(true, s.distance);
        rows.push(h('h3', {}, hidden ? t('map.unknown_region') : s.name));
        rows.push(h('div', {}, `${t('map.distance')}: ${s.distance.toFixed(1)} LY`));
        rows.push(h('div', {}, `${t('map.star')}: ${hidden ? '???' : t(`star.${s.starType}`)}`));
        rows.push(h('div', {}, `${t('map.planets')}: ${hidden ? '???' : s.planetCount}`));
        rows.push(h('div', {}, `${t('map.status')}: ${visited ? t('map.visited') : t('map.unexplored')}`));
        rows.push(h('div', {}, `${t('map.fuel_needed')}: ${fuel.toFixed(0)} / ${g.state.ship.fuel.toFixed(0)}`));
        if (s.id === g.state.story.flags.precursorTarget) rows.push(h('div', { class: 'accent' }, t('map.precursor_coords')));
        if (s.starType === 'black_hole') rows.push(h('div', { class: 'danger' }, t('map.black_hole_warn')));
        const exp = g.tools.expeditionCheck();
        rows.push(h('div', { class: exp.ready ? 'ok' : 'warn' }, exp.ready ? t('exp.ready') : t('exp.missing')));
        rows.push(this.btn('map.set_target', () => { g.director.setInterstellarTarget(s); this.renderMapInfo(); }, { cls: 'primary', disabled: fuel > g.state.ship.fuel }));
        rows.push(this.btn('map.expedition_check', () => this.open('expedition', { target: { systemId: s.id, label: s.name } })));
      }
    } else if (ms.tab === 'system' || ms.tab === 'planet') {
      const b = ms.selectedBody || g.activeBody || g.player.body;
      if (b) rows.push(...this.bodyInfo(b));
      if (b && ms.tab === 'system') rows.push(this.btn('map.set_nav', () => { g.navTarget = { kind: 'body', label: b.def.name, world: () => b.anchor.getWorldPosition(new THREE.Vector3()), arrive: b.atmoTop * 1.4 + 3000, body: b }; g.hud.toast('hud.target_set', 'accent', { name: b.def.name }); }, { cls: 'primary' }));
    } else if (ms.tab === 'location') {
      const b = g.player.body || g.ship.body;
      if (b && g.player.mode === 'body') {
        const p = g.player.pos;
        const dir = p.clone().normalize();
        const hgt = b.heightAt(dir);
        rows.push(h('h3', {}, b.def.name));
        rows.push(h('div', {}, `${t('map.biome')}: ${t(`biome.${b.surface.biomeAt(dir.x, dir.y, dir.z, hgt, 0)}`)}`));
        rows.push(h('div', {}, `${t('map.elevation')}: ${Math.round(hgt)} M`));
        rows.push(h('div', {}, `${t('map.local_time')}: ${Math.floor(g.localHour || 0)}:${String(Math.floor(((g.localHour || 0) % 1) * 60)).padStart(2, '0')}`));
        rows.push(h('div', {}, `${t('map.weather')}: ${t(`weather.${g.weather.currentType || 'clear'}`)}`));
      } else rows.push(h('p', { class: 'muted' }, t('map.in_space')));
    } else if (ms.tab === 'galaxy') {
      rows.push(h('p', {}, t('map.galaxy_info')));
      rows.push(h('div', {}, `${t('map.systems_visited')}: ${Object.keys(g.state.discoveries.systems).length}`));
      rows.push(h('div', {}, `${t('map.planets_found')}: ${Object.keys(g.state.discoveries.planets).length}`));
    } else {
      rows.push(h('p', { class: 'muted' }, t('map.select_hint')));
    }
    if (g.navTarget) rows.push(h('div', { class: 'muted' }, `${t('map.current_target')}: ${g.navTarget.label}`));
    info.replaceChildren(...rows);
  }

  bodyInfo(b) {
    const g = this.game;
    const known = g.state.isDiscovered('planets', b.id) || b.def.home;
    const d = b.def;
    if (!known) return [h('h3', {}, t('marker.unknown_world')), h('p', { class: 'muted' }, t('map.scan_to_reveal'))];
    const species = Object.values(g.state.discoveries.species).filter((s) => s.body === b.id).length;
    return [
      h('h3', {}, d.name),
      h('div', {}, `${t('map.type')}: ${t(`ptype.${d.type}`)}`),
      h('div', {}, `${t('map.gravity')}: ${(d.gravity / 9.81).toFixed(2)} G`),
      h('div', {}, `${t('map.temperature')}: ${d.temperature} °C`),
      h('div', {}, `${t('map.atmosphere')}: ${d.atmosphere ? (d.atmosphere.breathable ? t('map.breathable') : t('map.toxic_air')) : t('map.none')}`),
      h('div', {}, `${t('map.radius')}: ${fmtDistance(d.radius)}`),
      h('div', { class: `danger-${d.danger}` }, `${t('map.danger')}: ${t(`danger.${d.danger}`)}`),
      h('div', {}, `${t('map.species_found')}: ${species} / ${b.faunaSpecies.length + b.flora.length}`),
      d.rings ? h('div', {}, t('map.has_rings')) : '',
      d.civilization !== null && d.civilization !== undefined ? h('div', {}, `${t('map.civilization')}: ${CIVILIZATIONS[d.civilization].name}`) : '',
    ];
  }

  // ---------------- shops ----------------
  shopList(market, ids, { sellOnly = false } = {}) {
    const g = this.game;
    const st = g.state;
    if (!g.tools.canTrade()) return [h('p', { class: 'danger' }, t('shop.refused'))];
    const rows = ids.map((id) => {
      const price = market.price(id, sellOnly ? 'sell' : 'buy', g.tools.discount());
      const owned = (id === 'jetpack' && st.jetpack.owned && st.jetpack.model === 'basic') || (id === 'jetpack_mk2' && st.jetpack.model === 'mk2' && st.jetpack.owned) || (id === 'scanner_mk2' && st.owned.scanner_mk2) || (id === 'skimmer' && st.owned.skimmer) || (id === 'engine_mk2' && st.ship.engineTier === 2);
      const have = st.count(id);
      const act = sellOnly
        ? [this.btn('shop.sell1', () => this.trade('sell', market, id, 1), { disabled: !have }), this.btn('shop.sellall', () => this.trade('sell', market, id, have), { disabled: !have })]
        : [owned ? h('span', { class: 'muted' }, t('shop.owned')) : this.btn('shop.buy', () => this.trade('buy', market, id, 1), { disabled: st.credits < price })];
      const sel = this.current?.data?.sel === id;
      return h('div', { class: `shoprow ${sel ? 'sel' : ''}`, onclick: (e) => { if (e.target.closest('button')) return; this.current.data.sel = id; this.showItem(id); this.el?.querySelectorAll?.('.shoprow.sel').forEach((r) => r.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, this.itemChip(id), h('span', { class: 'muted' }, have ? `×${have}` : ''), h('b', {}, `◇ ${price}`), ...act);
    });
    return rows;
  }

  // 3D showroom above the buy list: the selected item turns on a pedestal.
  showroom(id) {
    if (!this.viewer) {
      try { this.viewer = new ItemViewer(); } catch { this.viewer = { ok: false }; }
    }
    if (!this.viewer.ok) return '';
    const d = itemDef(id);
    const box = h('div', { class: 'showroom' }, this.viewer.canvas,
      h('div', { class: 'showroom-cap' }, h('b', {}, t(`item.${id}`)), h('span', { style: { color: d.color } }, d.glyph)));
    requestAnimationFrame(() => this.viewer.show(id));
    this.showroomCap = box.lastChild;
    return box;
  }

  showItem(id) {
    if (!this.viewer?.ok) return;
    this.viewer.show(id);
    if (this.showroomCap) {
      const d = itemDef(id);
      this.showroomCap.firstChild.textContent = t(`item.${id}`);
      this.showroomCap.lastChild.textContent = d.glyph;
      this.showroomCap.lastChild.style.color = d.color;
    }
  }

  trade(side, market, id, n) {
    const g = this.game;
    const r = side === 'buy' ? g.tools.buy(market, id, n) : g.tools.sell(market, id, n);
    if (!r.ok) { g.hud.toast(`shop.fail_${r.reason || 'none'}`, 'warn'); g.audio.play('error'); }
    else {
      g.audio.play('buy');
      // Equipment is fitted immediately; Nitro must be installed in the tech bay.
      if (side === 'buy' && ['jetpack', 'jetpack_mk2', 'scanner_mk2', 'engine_mk2', 'cargo_ext', 'skimmer'].includes(id)) g.tools.useItem(id);
      if (side === 'buy' && id === 'nitro') g.hud.toast('hud.nitro_bought', 'accent');
    }
    this.refresh();
  }

  shopPanel(titleKey, market, buyIds, { sell = true } = {}) {
    const g = this.game;
    const tab = this.current.data.tab || (buyIds.length ? 'buy' : 'sell');
    const sellIds = SELLABLE.filter((id) => g.state.count(id) > 0);
    return this.panel(titleKey, [
      h('div', { class: 'credits big' }, `◇ ${g.state.credits.toLocaleString('en-US')}`, h('span', { class: 'muted' }, ` · ${t('shop.rep')}: ${t(`rep.${reputationTier(g.state.reputation.veyari || 0)}`)}`)),
      h('div', { class: 'tabs' }, (buyIds.length ? ['buy'] : []).concat(sell ? ['sell'] : []).map((tb) => h('button', { class: tab === tb ? 'on' : '', onclick: () => { this.current.data.tab = tb; this.refresh(); } }, t(`shop.${tb}`)))),
      tab === 'buy' && buyIds.length ? this.showroom(this.current.data.sel && buyIds.includes(this.current.data.sel) ? this.current.data.sel : buyIds[0]) : '',
      h('div', { class: 'shoplist' }, tab === 'buy' ? this.shopList(market, buyIds) : sellIds.length ? this.shopList(market, sellIds, { sellOnly: true }) : h('p', { class: 'muted' }, t('shop.nothing_to_sell'))),
    ], { wide: true });
  }

  p_shop_market(d) { return this.shopPanel('shop.market', d.market, ['ration', 'water', 'medkit', 'jet_fuel', 'fuel_cell', 'energy_cell', 'repair_kit']); }
  p_shop_equipment(d) { return this.shopPanel('shop.equipment', d.market, ['jetpack', 'jet_fuel', 'nitro', 'nitro_cell', 'scanner_mk2', 'base_kit', 'skimmer', 'repair_kit'].concat(reputationTier(this.game.state.reputation.veyari || 0) === 'trusted' || reputationTier(this.game.state.reputation.veyari || 0) === 'honored' ? ['jetpack_mk2'] : [])); }
  p_restaurant(d) {
    const g = this.game;
    return this.panel('shop.restaurant', [
      h('p', { class: 'muted' }, t('shop.restaurant_desc')),
      this.btn('shop.eat', () => { if (g.state.credits >= 20) { g.state.credits -= 20; g.state.vitals.health = Math.min(100, g.state.vitals.health + 40); g.audio.play('buy'); this.refresh(); } }, { params: { price: 20 } }),
      ...this.shopList(d.market, ['ration', 'water']),
    ]);
  }

  p_hospital() {
    const g = this.game;
    const v = g.state.vitals;
    const cost = Math.ceil((100 - v.health) * 1.5);
    return this.panel('shop.hospital', [
      h('div', { class: 'hrow' }, h('span', {}, t('hud.health')), bar(v.health)),
      this.btn('shop.heal', () => { if (g.state.credits >= cost) { g.state.credits -= cost; v.health = 100; g.audio.play('buy'); this.refresh(); } }, { params: { price: cost }, disabled: v.health >= 100 || g.state.credits < cost }),
    ]);
  }

  p_hotel() {
    const g = this.game;
    return this.panel('shop.hotel', [
      h('p', { class: 'muted' }, t('shop.hotel_desc')),
      this.btn('shop.sleep_morning', () => { if (g.state.credits >= 40) { g.state.credits -= 40; this.skipToHour(7); this.closeAll(); } }, { params: { price: 40 }, disabled: g.state.credits < 40 }),
    ]);
  }

  p_research_center() {
    const g = this.game;
    const st = g.state;
    const exhibits = st.museum;
    const donatable = ['precursor_shard', 'aurum', 'biosample', 'mineral_sample'].filter((id) => st.count(id));
    return this.panel('research.title', [
      h('p', { class: 'muted' }, t('research.desc')),
      h('h3', {}, t('research.museum'), h('span', { class: 'muted' }, ` · ${exhibits.length} ${t('research.exhibits')}`)),
      h('div', { class: 'chips' }, exhibits.slice(-24).map((e) => this.itemChip(e.id))),
      donatable.length ? h('div', { class: 'row' }, donatable.map((id) => this.btn('research.donate', () => { st.removeItem(id, 1); st.museum.push({ id, t: st.time }); st.reputation.veyari += id === 'precursor_shard' ? 15 : 2; st.addXP('science', 10); if (id === 'precursor_shard') st.story.flags.shardDonated = true; this.refresh(); }, { params: { item: t(`item.${id}`) } }))) : h('p', { class: 'muted' }, t('research.nothing')),
      h('h3', {}, t('research.species_log')),
      h('div', {}, `${Object.keys(st.discoveries.species).length} ${t('research.species_count')}`),
      this.btn('research.upload', () => { const n = Object.keys(st.discoveries.species).length - (st.story.flags.uploaded || 0); if (n > 0) { st.credits += n * 20; st.story.flags.uploaded = Object.keys(st.discoveries.species).length; g.hud.toast('hud.data_uploaded', 'accent', { credits: n * 20 }); this.refresh(); } }),
    ], { wide: true });
  }

  skipToHour(target) {
    const g = this.game;
    const body = g.player.body || g.ship.body || g.homeBody();
    const period = body.def.spinPeriod;
    const cur = g.localHour ?? 12;
    let dh = target - cur;
    if (dh <= 0) dh += 24;
    this.skipTime((dh / 24) * period);
  }

  skipTime(seconds) {
    const g = this.game;
    g.universe.time += seconds;
    g.state.time += seconds;
    for (const m of Object.values(g.markets)) m.update(seconds);
    g.state.vitals.health = 100;
    g.state.vitals.oxygen = 100;
    g.state.vitals.suitEnergy = 100;
    g.universe.updateSpin(0);
    g.save(true);
    g.hud.toast('hud.rested', 'accent');
  }

  // ---------------- dialog ----------------
  p_dialog(d) {
    const g = this.game;
    const npc = d.npc;
    const c = npc.c;
    if (!d.conv) { d.conv = g.director.dialogFor(npc); d.shown = 0; }
    const civ = CIVILIZATIONS.find((x) => x.id === c.civ);
    const portrait = npc.anim ? `assets/ui/char-${Math.max(0, CHARACTER_PORTRAITS.indexOf(npc.anim.name))}.jpg` : null;
    const lines = d.conv.history.map((l, i) => {
      const fresh = i >= (d.shown || 0);
      return h('div', { class: `bubble ${l.who}${fresh ? ' fresh' : ''}`, style: fresh ? { animationDelay: `${(i - d.shown) * 0.35}s` } : {} },
        l.who === 'you' ? h('b', {}, g.state.profile.name) : '', h('span', {}, l.text));
    });
    d.shown = d.conv.history.length;
    const chat = h('div', { class: 'dialog-lines chat' }, lines);
    requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
    const ask = (o) => {
      if (o.topic) d.conv = g.director.dialogFor(npc, o.topic, d.conv);
      else { o.action(); if (this.current?.name !== 'dialog') return; d.conv = g.director.dialogFor(npc, '__refresh', d.conv); }
      g.audio.play('ui');
      this.refresh();
    };
    return this.panel('', [
      h('div', { class: 'npc-head' },
        portrait ? h('img', { class: 'npc-portrait', src: portrait, alt: '' }) : h('div', { class: 'npc-avatar', style: { background: `rgb(${c.color.map((v) => Math.round(v * 255)).join(',')})` } }),
        h('div', {}, h('h3', {}, c.name), h('div', { class: 'muted' }, `${t(`npcprof.${c.profession}`)} · ${civ?.name || ''} · ${t(`personality.${c.personality}`)}`))),
      chat,
      h('div', { class: 'dialog-options' }, d.conv.options.map((o) => h('button', { class: `dopt ${o.topic ? '' : 'act'}`, onclick: () => ask(o) }, h('i', {}, '›'), t(o.key, o.params)))),
    ], { titleText: t('dialog.title'), wide: true });
  }

  // ---------------- ship panels ----------------
  p_techbay() {
    const g = this.game;
    const sys = g.state.ship;
    const inv = g.state.combined;
    const slot = sys.nitro.installed
      ? h('div', { class: 'card ok' }, h('h3', {}, t('tech.nitro_slot'), ' — ', t('tech.installed')), h('div', { class: 'hrow' }, h('span', {}, t('hud.nitro')), bar(sys.nitro.charge, 'nitro')), h('div', { class: 'big accent' }, sys.nitro.charge > 20 ? t('tech.nitro_ready') : t('tech.nitro_low')),
        this.btn('tech.refill', () => { const r = sys.refillNitro(inv); g.hud.toast(r.ok ? 'hud.nitro_refilled' : `hud.nitro_${r.reason}`, r.ok ? 'accent' : 'warn'); this.refresh(); }, { disabled: !inv.has('nitro_cell') }))
      : h('div', { class: 'card' }, h('h3', {}, t('tech.nitro_slot'), ' — ', t('tech.empty')), h('p', { class: 'muted' }, inv.has('nitro') ? t('tech.install_hint') : t('tech.need_nitro')),
        this.btn('tech.install', () => {
          const r = sys.installNitro(inv);
          if (r.ok) { g.audio.play('install'); g.hud.banner('hud.nitro_installed', 'accent', {}, 'hud.nitro_ready'); g.state.addXP('engineering', 30); g.events.emit('ship:nitroInstalled'); }
          else g.hud.toast(`hud.nitro_${r.reason}`, 'warn');
          this.refresh();
        }, { cls: 'primary', disabled: !inv.has('nitro') }));
    const e = sys.energy;
    const energy = h('div', { class: 'card' }, h('h3', {}, t('tech.energy')),
      ...['engines', 'shields', 'systems'].map((k) => h('div', { class: 'srow' }, h('span', {}, t(`tech.e_${k}`)), h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: e[k], oninput: (ev) => { const v = { ...sys.energy, [k]: Number(ev.target.value) }; sys.setEnergy(v.engines, v.shields, v.systems); }, onchange: () => this.refresh() }), h('em', {}, `${Math.round(e[k] * 100)}%`))));
    return this.panel('tech.title', [
      h('div', { class: 'breadcrumb' }, 'SHIP → TECHNICAL BAY → ENGINE COMPARTMENT → NITRO SLOT'),
      slot,
      h('div', { class: 'card' }, h('h3', {}, t('tech.lightbreak_core')), h('div', {}, `${t('tech.state')}: ${t(`lbstate.${sys.lightbreak.state}`)}`), h('div', { class: 'hrow' }, h('span', {}, t('hud.lightbreak')), bar(sys.lightbreak.charge)), h('p', { class: 'muted' }, t('tech.lightbreak_hint'))),
      h('div', { class: 'card' }, h('h3', {}, t('tech.engine')), h('div', {}, `${t('tech.tier')}: MK${sys.engineTier}`), h('div', { class: 'hrow' }, h('span', {}, t('module.engine')), bar(sys.modules.engine.hp))),
      energy,
    ], { wide: true });
  }

  p_repair() {
    const g = this.game;
    const sys = g.state.ship;
    const inv = g.state.combined;
    return this.panel('repair.title', [
      h('p', { class: 'muted' }, `${t('repair.kits')}: ${inv.count('repair_kit')}`),
      ...MODULE_IDS.map((id) => h('div', { class: 'shoprow' }, h('span', {}, t(`module.${id}`)), bar(sys.modules[id].hp, sys.isBroken(id) ? 'bad' : ''), sys.isBroken(id) ? h('b', { class: 'danger' }, t('repair.broken')) : h('span'), this.btn('repair.fix', () => { const r = sys.repair(id, inv); if (r.ok) { g.audio.play('install'); g.state.addXP('engineering', 12); } else g.hud.toast(`repair.fail_${r.reason}`, 'warn'); this.refresh(); }, { disabled: sys.modules[id].hp >= 100 || !inv.has('repair_kit') }))),
      h('div', { class: 'hrow' }, h('span', {}, t('hud.fuel')), bar((sys.fuel / sys.fuelCapacity) * 100, 'fuel')),
      this.btn('repair.refuel', () => { g.tools.useItem('fuel_cell'); this.refresh(); }, { disabled: !inv.has('fuel_cell') }),
    ]);
  }

  p_lab() {
    const g = this.game;
    const st = g.state;
    const done = st.story.research || {};
    return this.panel('lab.title', [
      h('p', { class: 'muted' }, t('lab.desc')),
      h('div', {}, this.itemChip('biosample', st.count('biosample')), ' ', this.itemChip('mineral_sample', st.count('mineral_sample')), ' ', this.itemChip('precursor_shard', st.count('precursor_shard'))),
      this.btn('lab.analyze', () => { const r = g.tools.analyzeSamples(); if (r.ok) g.hud.toast('hud.analysed', 'accent', { credits: r.credits }); this.refresh(); }, { disabled: !st.count('biosample') && !st.count('mineral_sample') }),
      h('h3', {}, t('lab.research')),
      ...RESEARCH.map((r) => h('div', { class: 'shoprow' }, h('span', {}, t(`research.${r.id}`)), h('span', { class: 'chips' }, Object.entries(r.cost).map(([id, n]) => this.itemChip(id, n))), done[r.id] ? h('span', { class: 'muted' }, t('lab.done')) : this.btn('lab.start', () => { const res = g.tools.research(r); if (!res.ok) g.hud.toast(`lab.fail_${res.reason}`, 'warn'); else g.audio.play('discovery'); this.refresh(); }))),
    ], { wide: true });
  }

  p_workbench() {
    const g = this.game;
    return this.panel('craft.title', [
      h('p', { class: 'muted' }, t('craft.desc')),
      ...RECIPES.map((r) => h('div', { class: 'shoprow' }, this.itemChip(r.out, r.n), h('span', { class: 'chips' }, Object.entries(r.cost).map(([id, n]) => this.itemChip(id, n))), this.btn('craft.make', () => { const res = g.tools.craft(r); if (!res.ok) g.hud.toast(`craft.fail_${res.reason}`, 'warn'); else g.audio.play('install'); this.refresh(); }, { disabled: !Object.entries(r.cost).every(([id, n]) => g.state.count(id) >= n) }))),
    ], { wide: true });
  }

  p_rest() {
    const g = this.game;
    return this.panel('rest.title', [
      h('p', { class: 'muted' }, t('rest.desc')),
      this.btn('rest.sleep', () => { this.closeAll(); g.sleepInBunk(() => this.skipToHour(7), 'rest.woke_up'); }, { cls: 'primary' }),
      this.btn('rest.nap', () => { const body = g.player.body || g.ship.body || g.homeBody(); this.closeAll(); g.sleepInBunk(() => this.skipTime(body.def.spinPeriod / 8), 'rest.woke_nap'); }),
      h('h3', {}, t('rest.cryo')),
      h('p', { class: 'muted' }, t('rest.cryo_desc')),
      this.btn('rest.cryo_sleep', () => { const body = g.ship.body || g.homeBody(); this.skipTime(body.def.spinPeriod * 5); g.director.news('news.cryo', { pilot: g.state.profile.name }); this.closeAll(); }),
      this.btn('pause.save', () => g.save()),
    ]);
  }

  p_galley() {
    const g = this.game;
    const st = g.state;
    return this.panel('galley.title', [
      h('p', { class: 'muted' }, t('galley.desc')),
      this.btn('galley.eat', () => { g.tools.useItem('ration'); this.refresh(); }, { disabled: !st.count('ration'), params: { n: st.count('ration') } }),
      this.btn('galley.drink', () => { g.tools.useItem('water'); this.refresh(); }, { disabled: !st.count('water'), params: { n: st.count('water') } }),
      this.btn('galley.medkit', () => { g.tools.useItem('medkit'); this.refresh(); }, { disabled: !st.count('medkit'), params: { n: st.count('medkit') } }),
      h('div', { class: 'hrow' }, h('span', {}, t('hud.health')), bar(st.vitals.health)),
    ]);
  }

  p_cargo() {
    return this.p_inventory(this.current.data);
  }

  p_base(d) {
    const g = this.game;
    const st = g.state;
    const b = d.base;
    const tab = d.tab || 'storage';
    const move = (from, to, id, n) => { from.transfer(id, n, to); this.refresh(); };
    const list = (inv, other) => inv.items.length ? inv.items.map((s) => h('div', { class: 'shoprow' }, this.itemChip(s.id, s.n), this.btn('base.move_all', () => move(inv, other, s.id, s.n)))) : [h('p', { class: 'muted' }, t('base.empty'))];
    return this.panel('', [
      h('div', { class: 'tabs' }, ['storage', 'services', 'garage'].map((tb) => h('button', { class: tab === tb ? 'on' : '', onclick: () => { d.tab = tb; this.refresh(); } }, t(`base.${tb}`)))),
      tab === 'storage' ? h('div', { class: 'cols' }, h('div', {}, h('h3', {}, t('inv.suit')), ...list(st.suit, b.storage)), h('div', {}, h('h3', {}, t('base.storage')), ...list(b.storage, st.suit))) : '',
      tab === 'services' ? h('div', { class: 'menu-col' }, h('p', { class: 'muted' }, t('base.services_desc')), this.btn('rest.sleep', () => { this.skipToHour(7); this.closeAll(); }), this.btn('pause.save', () => g.save()), h('input', { type: 'text', value: b.name, maxlength: 24, onchange: (e) => { b.name = e.target.value || b.name; } })) : '',
      tab === 'garage' ? h('div', { class: 'menu-col' },
        h('p', { class: 'muted' }, st.owned.skimmer ? t('base.garage_desc') : t('base.no_skimmer')),
        this.btn('base.summon_skimmer', () => { const pos = new THREE.Vector3(...b.pos); const up = pos.clone().normalize(); const side = new THREE.Vector3(1, 0, 0).cross(up).normalize(); g.skimmer.deploy(g.player.body, pos.addScaledVector(side, -7), side); this.closeAll(); }, { disabled: !st.owned.skimmer })) : '',
    ], { wide: true, titleText: b.name });
  }

  // ---------------- station ----------------
  p_station(d) {
    const g = this.game;
    const st = g.state;
    const sys = st.ship;
    const station = g.ship.docked;
    if (!station) { setTimeout(() => this.back(), 0); return h('div'); }
    const market = g.market(`${station.body.id}/station`);
    const tab = d.tab || 'services';
    const fuelCost = Math.ceil((sys.fuelCapacity - sys.fuel) * 3);
    const dmg = MODULE_IDS.reduce((a, id) => a + (100 - sys.modules[id].hp), 0);
    const repCost = Math.ceil(dmg * 2.2);
    let body;
    if (tab === 'services') {
      body = h('div', { class: 'menu-col' },
        this.btn('station.refuel', () => { if (st.credits >= fuelCost) { st.credits -= fuelCost; sys.fuel = sys.fuelCapacity; g.audio.play('buy'); this.refresh(); } }, { params: { price: fuelCost }, disabled: fuelCost <= 0 || st.credits < fuelCost }),
        this.btn('station.repair', () => { if (st.credits >= repCost) { st.credits -= repCost; for (const id of MODULE_IDS) sys.modules[id].hp = 100; sys.shieldCharge = 100; g.audio.play('install'); this.refresh(); } }, { params: { price: repCost }, disabled: repCost <= 0 || st.credits < repCost }),
        this.btn('station.jetpack_refill', () => { if (st.credits >= 25) { st.credits -= 25; st.jetpack.refuel(999); this.refresh(); } }, { disabled: !st.jetpack.owned || st.credits < 25, params: { price: 25 } }),
        this.btn('station.walk_ship', () => { this.closeAll(); g.standUpFromSeat(); }),
        this.btn('station.undock', () => { this.closeAll(); g.ship.undock(); g.setMode('pilot'); }, { cls: 'primary' }));
    } else if (tab === 'market') {
      const sellIds = SELLABLE.filter((id) => st.count(id) > 0);
      body = h('div', { class: 'shoplist' }, ...this.shopList(market, ['fuel_cell', 'repair_kit', 'jet_fuel', 'medkit', 'ration', 'water', 'energy_cell']), h('h3', {}, t('shop.sell')), ...(sellIds.length ? this.shopList(market, sellIds, { sellOnly: true }) : [h('p', { class: 'muted' }, t('shop.nothing_to_sell'))]));
    } else if (tab === 'shipyard') {
      body = h('div', { class: 'shoplist' }, ...this.shopList(market, ['nitro', 'nitro_cell', 'engine_mk2', 'cargo_ext', 'base_kit']), h('h3', {}, t('station.hulls')), h('p', { class: 'muted' }, t('station.hulls_desc')));
    } else if (tab === 'news') {
      body = h('div', { class: 'news' }, st.news.slice().reverse().map((n) => h('p', {}, h('b', {}, 'GNN · '), t(n.key, n.params))));
    } else {
      body = h('div', { class: 'menu-col' }, h('p', {}, t('station.missions_desc')), this.btn('station.distress_lead', () => { g.director.distressCall(); this.refresh(); }), h('p', { class: 'muted' }, t(`rumor.${Math.floor(st.time / 97) % 6}`)));
    }
    return this.panel('', [
      h('div', { class: 'credits big' }, `◇ ${st.credits.toLocaleString('en-US')}`),
      h('div', { class: 'tabs' }, ['services', 'market', 'shipyard', 'missions', 'news'].map((tb) => h('button', { class: tab === tb ? 'on' : '', onclick: () => { d.tab = tb; this.refresh(); } }, t(`station.${tb}`)))),
      body,
    ], { wide: true, titleText: station.name, noClose: false });
  }

  // ---------------- misc modals ----------------
  p_expedition(d) {
    const g = this.game;
    const exp = g.tools.expeditionCheck();
    return this.panel('exp.title', [
      h('div', { class: 'exp-rows' }, exp.rows.map((r) => h('div', { class: `exp-row ${r.ok ? 'ok' : r.critical ? 'bad' : 'warn'}` }, h('span', {}, t(`exp.${r.key}`)), h('em', {}, `${Math.floor(r.have)} / ${r.need}`), h('b', {}, r.ok ? '✓' : '✗')))),
      h('div', { class: `exp-status ${exp.ready ? 'ok' : 'bad'}` }, exp.ready ? t('exp.ready') : t('exp.missing')),
      d.target ? h('p', { class: 'muted' }, `${t('map.current_target')}: ${d.target.label}`) : '',
      exp.blocked ? h('p', { class: 'danger' }, t('exp.blocked')) : '',
      this.btn('ui.ok', () => this.back(), { cls: 'primary' }),
    ]);
  }

  p_wormhole(d) {
    const g = this.game;
    return this.panel('wormhole.title', [
      h('div', { class: 'big accent center' }, t('wormhole.question')),
      h('p', { class: 'muted' }, t('wormhole.desc', { stability: Math.round(d.wormhole.def.stability * 100) })),
      h('div', { class: 'row' }, this.btn('ui.yes', () => { this.closeAll(); g.director.enterWormhole(d.wormhole); }, { cls: 'primary' }), this.btn('ui.no', () => this.back())),
    ]);
  }

  p_log(d) {
    return this.panel('', [
      h('div', { class: 'terminal' }, d.lines.map((l) => h('p', {}, l)), d.warning ? h('p', { class: 'danger blink' }, d.warning) : ''),
      this.btn('ui.close', () => this.back()),
    ], { titleText: d.title });
  }

  p_journal(d) {
    const g = this.game;
    const st = g.state;
    const tab = d.tab || 'discoveries';
    const disc = st.discoveries;
    let body;
    if (tab === 'discoveries') {
      body = [
        h('div', { class: 'stats' }, ['systems', 'planets', 'species', 'sites'].map((k) => h('div', { class: 'stat' }, h('b', {}, Object.keys(disc[k]).length), h('span', {}, t(`journal.${k}`))))),
        h('h3', {}, t('journal.planets')), ...Object.values(disc.planets).map((p) => h('div', {}, `${p.name} · ${t(`ptype.${p.type}`)}`)),
        h('h3', {}, t('journal.sites')), ...Object.values(disc.sites).map((p) => h('div', {}, p.name)),
      ];
    } else if (tab === 'species') {
      body = Object.values(disc.species).map((s) => h('div', { class: 'shoprow' }, h('b', {}, s.name), h('span', { class: 'muted' }, s.kind === 'fauna' ? t(`diet.${s.diet}`) : t(`form.${s.form}`))));
      if (!body.length) body = [h('p', { class: 'muted' }, t('journal.no_species'))];
    } else if (tab === 'quests') {
      const q = st.quests;
      body = [
        ...Object.keys(q.active).map((id) => h('div', { class: 'card' }, h('b', {}, t(`questname.${id}`)), h('p', { class: 'muted' }, t(`questdesc.${id}`)))),
        ...Object.keys(q.done).map((id) => h('div', { class: 'muted' }, `✓ ${t(`questname.${id}`)}`)),
        st.story.flags.ruinVisited ? h('div', { class: 'card' }, h('b', {}, t('story.main_title')), h('p', {}, st.story.flags.decoded ? t('story.main_2') : t('story.main_1'))) : h('div', { class: 'card' }, h('b', {}, t('story.main_title')), h('p', { class: 'muted' }, t('story.main_0'))),
      ];
    } else if (tab === 'news') {
      body = st.news.slice().reverse().map((n) => h('p', {}, h('b', {}, 'GNN · '), t(n.key, n.params)));
    } else {
      const s = st.stats;
      body = [h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, fmtDistance(s.distance)), h('span', {}, t('journal.walked'))),
        h('div', { class: 'stat' }, h('b', {}, s.jumps), h('span', {}, t('journal.jumps'))),
        h('div', { class: 'stat' }, h('b', {}, s.scans), h('span', {}, t('journal.scans'))),
        h('div', { class: 'stat' }, h('b', {}, s.mined), h('span', {}, t('journal.mined'))),
        h('div', { class: 'stat' }, h('b', {}, `${Math.floor(s.playTime / 60)}m`), h('span', {}, t('journal.playtime'))))];
    }
    return this.panel('journal.title', [h('div', { class: 'tabs' }, ['discoveries', 'species', 'quests', 'news', 'stats'].map((tb) => h('button', { class: tab === tb ? 'on' : '', onclick: () => { d.tab = tb; this.refresh(); } }, t(`journal.tab_${tb}`)))), h('div', {}, body)], { wide: true });
  }

  p_help() {
    const g = this.game;
    const k = g.hud.keys();
    const rows = ['move', 'look', 'jump', 'jet', 'scan', 'mine', 'interact', 'map', 'inventory', 'view', 'photo'].map((a) => h('div', { class: 'srow' }, h('span', {}, t(`help.${a}`)), h('b', { class: 'key' }, k[a])));
    const ship = ['throttle', 'fire', 'boost', 'lightbreak', 'autopilot', 'target'].map((a) => h('div', { class: 'srow' }, h('span', {}, t(`help.${a}`)), h('b', { class: 'key' }, k[a])));
    return this.panel('help.title', [h('div', { class: 'cols' }, h('div', {}, h('h3', {}, t('help.on_foot')), ...rows), h('div', {}, h('h3', {}, t('help.ship')), ...ship, h('div', { class: 'srow' }, h('span', {}, t('help.roll')), h('b', { class: 'key' }, 'A/D · Q/Z')), h('div', { class: 'srow' }, h('span', {}, t('help.vertical')), h('b', { class: 'key' }, 'SPACE / CTRL')), h('p', { class: 'muted' }, t('help.tip'))))], { wide: true });
  }

  // ---------------- developer tools (disabled in release builds) ----------------
  p_dev(d) {
    const g = this.game;
    if (!this.devAvailable) return this.panel('dev.title', h('p', {}, 'Release build.'));
    const info = g.renderer.info;
    const body = g.player.body || g.activeBody;
    const out = h('pre', { class: 'devout' });
    const show = (o) => { out.textContent = JSON.stringify(o, null, 2).slice(0, 4000); };
    const tp = (fn) => () => { this.closeAll(); fn(); g.warmup(); };
    return this.panel('dev.title', [
      h('div', { class: 'cols' },
        h('div', { class: 'menu-col' },
          h('h3', {}, 'Teleport'),
          this.btn('', tp(() => { const s = g.ship; if (s.landed && s.body) g.exitShipToSurface(); }), { text: 'To ship ramp' }),
          this.btn('', tp(() => { const b = g.homeBody(); const c = b.city; g.player.placeOnBody(b, c.toLocal(0, 30, 0), new THREE.Vector3(...c.frame.north)); g.setMode('foot'); }), { text: 'To city plaza' }),
          this.btn('', tp(() => { const b = g.universe.body('home/tessa'); if (b?.sites.ruin) { const dir = new THREE.Vector3(...b.sites.ruin.dir); g.player.placeOnBody(b, dir.multiplyScalar(b.radius + 200), null); g.setMode('foot'); } }), { text: 'To Tessa (near signal)' }),
          this.btn('', tp(() => { const b = g.homeBody(); const up = new THREE.Vector3(...b.sites.city.dir); g.ship.placeInSpace(b, up.clone().multiplyScalar(b.atmoTop + 4000), null, new THREE.Vector3()); g.ship.alignUp(up.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), up); g.player.placeInShip(g.ship, new THREE.Vector3(0, 0, -8.9)); g.setMode('pilot'); }), { text: 'Ship to orbit' }),
          this.btn('', () => { g.state.addItem('nitro'); g.state.jetpack.owned = true; g.state.credits += 5000; this.refresh(); }, { text: 'Give Jetpack + Nitro + 5000' }),
          this.btn('', () => { const s = g.state.ship; s.lightbreak.state = 'ready'; s.lightbreak.charge = 100; }, { text: 'Lightbreak ready' }),
          h('h3', {}, 'World'),
          this.btn('', () => { if (body) { const sp = body.faunaSpecies[Math.floor(Math.random() * body.faunaSpecies.length)]; if (sp) body.fauna.spawnAt(g.player.pos.clone().addScaledVector(g.player.forward, 12), sp); } }, { text: 'Spawn creature' }),
          this.btn('', () => { this.closeAll(); g.devRegenerate(); }, { text: 'Regenerate current planet' }),
          this.btn('', () => { this.closeAll(); g.devSpawnPlanet(); }, { text: 'Spawn planet ahead' }),
          h('div', { class: 'row wrap' }, ['clear', 'rain', 'storm', 'snow', 'sandstorm', 'fog', 'blizzard'].map((w) => this.btn('', () => { if (body) g.weather.force(body, w); }, { text: w }))),
          this.btn('', () => { this.skipTime((body?.def.spinPeriod || 1440) / 4); }, { text: '+6 hours' }),
          this.btn('', () => { if (body) g.director.startMeteorShower(body); this.closeAll(); }, { text: 'Meteor shower' })),
        h('div', { class: 'menu-col' },
          h('h3', {}, 'Inspect'),
          this.btn('', () => show({ fps: g.fps.toFixed(1), dynScale: g.dynScale, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, terrain: body?.terrain.stats, scatter: body?.scatter.stats(), creatures: body?.fauna.creatures.length, guards: guardStatus() }), { text: 'Performance' }),
          this.btn('', () => show(body?.city ? body.city.npcs.slice(0, 6).map((n) => ({ ...n.c, x: n.x.toFixed(1), z: n.z.toFixed(1), state: n.state })) : 'no city'), { text: 'NPCs' }),
          this.btn('', () => show(g.state.ship.toJSON()), { text: 'Ship' }),
          this.btn('', () => show(body?.def), { text: 'Planet definition' }),
          this.btn('', () => show(log.entries().slice(-20)), { text: 'Error log' }),
          out)),
    ], { wide: true });
  }
}
