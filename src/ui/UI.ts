import { C, T, TASK_NAMES } from '../ants/Castes';
import { SK_NAMES, SS } from '../construction/LivingStructures';
import { LEVEL_TITLES, LEVEL_UNLOCKS } from '../colony/Evolution';
import { PRIORITY_NAMES } from '../colony/Colony';
import { ROOM_NAMES } from '../colony/Nest';
import { formatCount } from '../core/MathUtil';
import { MODES } from '../sim/Modes';
import type { Simulation } from '../sim/Simulation';
import { WEATHER_NAMES } from '../weather/WeatherSystem';
import { zoneAt, ZONE_NAMES } from '../world/Zones';
import { RP_NAMES } from '../swarm/Routes';

export interface ToolDef {
  id: string;
  icon: string;
  label: string;
  key: string;
  hint: string;
  creative?: boolean;
}

export const TOOLS: ToolDef[] = [
  { id: 'route', icon: '〰', label: 'Маршрут', key: '1', hint: 'Проведите линию. Колония сама проложит путь: через пропасть — живой мост, по гладкой стене — живую лестницу, к цели в воздухе — башню, сквозь грунт — тоннель.' },
  { id: 'food', icon: '◎', label: 'Ресурс', key: '2', hint: 'Отметьте еду или ресурс — муравьи узнают о нём и придут.' },
  { id: 'dig', icon: '⛏', label: 'Копать', key: '3', hint: 'Закрасьте область: муравьи выкопают её и вынесут землю наружу. [ ] — размер кисти.' },
  { id: 'build', icon: '▦', label: 'Строить', key: '4', hint: 'Закрасьте пустоту: муравьи принесут землю и уложат стену.' },
  { id: 'reinforce', icon: '⬢', label: 'Укрепить', key: '5', hint: 'Укреплённые стены держат большой пролёт — потолок не обвалится.' },
  { id: 'forbid', icon: '⛔', label: 'Запрет', key: '6', hint: 'Муравьи обходят запретную зону. Правая кнопка — снять запрет.' },
  { id: 'attack', icon: '⚔', label: 'Атака', key: '7', hint: 'Укажите врага или место — колония соберёт защитников.' },
  { id: 'explore', icon: '✦', label: 'Разведка', key: '8', hint: 'Укажите направление — разведчики пойдут туда.' },
  { id: 'inspect', icon: '◉', label: 'Смотреть', key: '9', hint: 'Наведите — узнать, что здесь. Клик по муравью — следить за ним.' },
  { id: 'cfood', icon: '✚', label: 'Еда+', key: '', hint: 'Бросить еду (творчество).', creative: true },
  { id: 'water', icon: '≈', label: 'Вода', key: '', hint: 'Пролить воду (творчество).', creative: true },
  { id: 'paint', icon: '▣', label: 'Грунт', key: '', hint: 'Нарисовать землю (творчество).', creative: true },
  { id: 'erase', icon: '⌫', label: 'Стереть', key: '', hint: 'Удалить материал (творчество).', creative: true },
];

type NoteTone = 'info' | 'good' | 'bad';

/**
 * Интерфейс держит фокус на колонии: компактная сводка слева, приоритеты и
 * активные задачи справа, инструменты внизу. Никаких огромных стратегических панелей.
 */
export class UI {
  tool = 'route';
  brush = 3;
  paused = false;
  speed = 1;
  onTool: ((id: string) => void) | null = null;
  onNewGame: ((mode: string, seed: number) => void) | null = null;
  onSave: (() => void) | null = null;
  onLoad: (() => void) | null = null;
  onExport: (() => void) | null = null;
  onImport: ((f: File) => void) | null = null;
  onSettings: ((s: { agentCap: number; volume: number; quality: 'normal' | 'ultra' }) => void) | null = null;
  onFocus: ((x: number, y: number) => void) | null = null;
  onSpawnAnts: ((n: number) => void) | null = null;
  private el: Record<string, HTMLElement> = {};
  private sim!: Simulation;
  private hudT = 0;
  private notes: HTMLElement[] = [];
  selectedMode = 'sandbox';
  settings: { agentCap: number; volume: number; quality: 'normal' | 'ultra' } = loadSettings();

  constructor(private root: HTMLElement) {}

  bind(sim: Simulation): void {
    this.sim = sim;
    this.build();
  }

  private h(tag: string, cls = '', html = ''): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  private build(): void {
    for (const id of ['hud', 'topright', 'side', 'toolbar', 'feed', 'tip', 'hint', 'modal', 'perf']) document.getElementById(id)?.remove();
    const sim = this.sim;
    // HUD
    const hud = this.h('div', 'panel');
    hud.id = 'hud';
    hud.innerHTML = `
      <div class="title"><b>РОЙ</b><span id="modeName"></span></div>
      <div class="row"><span class="k">Муравьи</span><span class="big" id="hPop">0</span></div>
      <div class="sub" id="hPopBreak"></div>
      <div class="row"><span class="k">Еда</span><span class="v" id="hFood"></span></div>
      <div class="bar energy"><i id="hEnergy"></i></div>
      <div class="row"><span class="k">Ресурсы (листья)</span><span class="v" id="hRes"></span></div>
      <div class="row"><span class="k">Личинки</span><span class="v" id="hBrood"></span></div>
      <div class="row"><span class="k">Территория</span><span class="v" id="hTerr"></span></div>
      <div class="row"><span class="k" id="hLvl"></span><span class="v sub" id="hLvlT"></span></div>
      <div class="bar"><i id="hXp"></i></div>
      <div class="sub" id="hZone"></div>`;
    this.root.appendChild(hud);
    // время/скорость/меню
    const tr = this.h('div', 'panel');
    tr.id = 'topright';
    tr.innerHTML = `<div id="clock"><div id="cTime"></div><div class="w" id="cWeather"></div></div>
      <div class="seg" id="speed"><button class="btn" data-s="0">❚❚</button><button class="btn on" data-s="1">1×</button><button class="btn" data-s="2">2×</button><button class="btn" data-s="4">4×</button><button class="btn" data-s="8">8×</button></div>
      <button class="btn" id="bOverlay" title="Феромоны (P)">☍</button>
      <button class="btn" id="bGfx" title="Графика: обычная / максимальная (G)">✦</button>
      <button class="btn" id="bMenu">☰</button>`;
    this.root.appendChild(tr);
    tr.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach((b) => b.addEventListener('click', () => this.setSpeed(Number(b.dataset.s))));
    tr.querySelector('#bMenu')!.addEventListener('click', () => this.openMenu());
    tr.querySelector('#bGfx')!.addEventListener('click', () => this.toggleQuality());
    // правая панель
    const side = this.h('div', 'panel');
    side.id = 'side';
    let prio = '<h4>Приоритеты колонии</h4>';
    for (let t = 0; t < 5; t++) {
      prio += `<div class="prio"><span>${TASK_NAMES[t]}</span><span class="seg" data-t="${t}">${[0, 1, 2, 3].map((l) => `<button class="btn" data-l="${l}" title="${PRIORITY_NAMES[l]}">${['выкл', 'низ', 'сред', 'выс'][l]}</button>`).join('')}</span></div>`;
    }
    side.innerHTML = prio + `<h4 style="margin-top:10px">Активные задачи</h4><div id="tasks"></div><h4 style="margin-top:10px">Колония думает</h4><div id="mind" class="sub"></div>`;
    this.root.appendChild(side);
    side.querySelectorAll<HTMLElement>('.prio .seg').forEach((seg) => {
      seg.querySelectorAll<HTMLButtonElement>('.btn').forEach((b) =>
        b.addEventListener('click', () => {
          this.sim.queue({ type: 'priority', task: Number(seg.dataset.t), level: Number(b.dataset.l) });
          setTimeout(() => this.refreshPriorities(), 50);
        }),
      );
    });
    // инструменты
    const tb = this.h('div', 'panel');
    tb.id = 'toolbar';
    for (const t of TOOLS) {
      if (t.creative && !sim.mode.creative) continue;
      const b = this.h('button', 'tool', `<span class="ic">${t.icon}</span><span class="lb">${t.label}</span>${t.key ? `<span class="kb">${t.key}</span>` : ''}`);
      b.dataset.tool = t.id;
      b.addEventListener('click', () => this.setTool(t.id));
      tb.appendChild(b);
    }
    if (sim.mode.creative) {
      const b = this.h('button', 'tool', `<span class="ic">⁂</span><span class="lb">+100 000</span>`);
      b.addEventListener('click', () => this.onSpawnAnts?.(100000));
      tb.appendChild(b);
    }
    this.root.appendChild(tb);
    const feed = this.h('div');
    feed.id = 'feed';
    this.root.appendChild(feed);
    const tip = this.h('div', 'panel');
    tip.id = 'tip';
    this.root.appendChild(tip);
    const hint = this.h('div', 'panel');
    hint.id = 'hint';
    this.root.appendChild(hint);
    const perf = this.h('div', 'panel');
    perf.id = 'perf';
    this.root.appendChild(perf);
    const modal = this.h('div');
    modal.id = 'modal';
    this.root.appendChild(modal);
    for (const id of ['bGfx', 'hPop', 'hPopBreak', 'hFood', 'hEnergy', 'hRes', 'hBrood', 'hTerr', 'hLvl', 'hLvlT', 'hXp', 'hZone', 'cTime', 'cWeather', 'tasks', 'mind', 'modeName', 'bOverlay']) this.el[id] = document.getElementById(id)!;
    this.el.tip = tip;
    this.el.hint = hint;
    this.el.feed = feed;
    this.el.modal = modal;
    this.el.perf = perf;
    this.el.modeName.textContent = sim.mode.name;
    this.el.bGfx.classList.toggle('on', this.settings.quality === 'ultra');
    this.setTool(this.tool);
    this.refreshPriorities();
  }

  setTool(id: string): void {
    this.tool = id;
    document.querySelectorAll<HTMLElement>('#toolbar .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
    const t = TOOLS.find((x) => x.id === id);
    this.hint(t ? `<b>${t.label}.</b> ${t.hint}` : '', 7000);
    this.onTool?.(id);
  }

  setSpeed(s: number): void {
    if (s === 0) this.paused = !this.paused;
    else { this.speed = s; this.paused = false; }
    document.querySelectorAll<HTMLButtonElement>('#speed .btn').forEach((b) => {
      const v = Number(b.dataset.s);
      b.classList.toggle('on', v === 0 ? this.paused : !this.paused && v === this.speed);
    });
  }

  refreshPriorities(): void {
    const col = this.sim.player;
    document.querySelectorAll<HTMLElement>('.prio .seg').forEach((seg) => {
      const t = Number(seg.dataset.t);
      seg.querySelectorAll<HTMLButtonElement>('.btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.l) === col.priorities[t]));
    });
  }

  private hintTimer = 0;
  hint(html: string, ms = 6000): void {
    const e = this.el.hint;
    if (!e) return;
    if (!html) { e.style.display = 'none'; return; }
    e.innerHTML = html;
    e.style.display = 'block';
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => { e.style.display = 'none'; }, ms);
  }

  note(text: string, tone: NoteTone = 'info', x?: number, y?: number): void {
    const n = this.h('div', `note ${tone}`, text);
    if (x !== undefined && y !== undefined) n.addEventListener('click', () => this.onFocus?.(x, y));
    this.el.feed.prepend(n);
    this.notes.push(n);
    while (this.notes.length > 6) this.notes.shift()!.remove();
    setTimeout(() => n.classList.add('fade'), 7000);
    setTimeout(() => { n.remove(); this.notes = this.notes.filter((q) => q !== n); }, 8200);
  }

  tip(html: string, x: number, y: number): void {
    const e = this.el.tip;
    if (!html) { e.style.display = 'none'; return; }
    e.innerHTML = html;
    e.style.display = 'block';
    const w = e.offsetWidth;
    e.style.left = Math.min(window.innerWidth - w - 8, x + 16) + 'px';
    e.style.top = Math.max(8, y + 16) + 'px';
  }

  update(dt: number, camX: number, perfText: string): void {
    this.hudT -= dt;
    if (this.hudT > 0) return;
    this.hudT = 0.25;
    const sim = this.sim;
    const col = sim.player;
    const pop = col.population();
    this.el.hPop.textContent = formatCount(pop);
    const bridge = sim.structures.totalAnts(0);
    this.el.hPopBreak.innerHTML = `снаружи ${formatCount(col.agents)} · в гнезде ${formatCount(col.residentTotal())}${col.streamAnts ? ` · в потоках ${formatCount(col.streamAnts)}` : ''}${bridge ? ` · в мостах ${formatCount(bridge)}` : ''}`;
    this.el.hFood.textContent = `${Math.round(col.food)} / ${Math.round(col.foodCapacity())}  (+${(col.income * 60).toFixed(0)}/мин)`;
    (this.el.hEnergy as HTMLElement).style.width = `${Math.round(col.energy * 100)}%`;
    this.el.hRes.textContent = `${Math.round(col.leaves)}`;
    const [e, l, p] = col.brood.totals();
    this.el.hBrood.textContent = `${e} яиц · ${l} личинок · ${p} куколок`;
    this.el.hTerr.textContent = `${(col.memory.exploredFraction() * 100).toFixed(1)}%`;
    this.el.hLvl.textContent = `Уровень ${col.evo.level}`;
    this.el.hLvlT.textContent = LEVEL_TITLES[col.evo.level - 1];
    (this.el.hXp as HTMLElement).style.width = `${Math.round(col.evo.progress() * 100)}%`;
    const z = zoneAt(sim.zones, camX);
    this.el.hZone.textContent = z ? `Масштаб: ${ZONE_NAMES[z.kind]}` : '';
    this.el.cTime.textContent = `День ${sim.clock.day} · ${sim.clock.label()}`;
    this.el.cWeather.textContent = `${WEATHER_NAMES[sim.weather.kind]} · ${sim.weather.temperature(sim.clock).toFixed(0)}°C${sim.clock.isNight() ? ' · ночь' : ''}`;
    // задачи
    const rows: string[] = [];
    for (const r of sim.routes.routes.values()) {
      if (r.colony !== 0) continue;
      rows.push(`<div class="t"><span>〰 ${r.player ? 'Маршрут' : 'Дорога'} (${RP_NAMES[r.purpose]}) · ${r.assigned}${r.stream ? ' +' + formatCount(r.stream) : ''} мур.${r.danger > 1 ? ' · опасно' : ''}</span><span class="x" data-route="${r.id}">×</span></div>`);
    }
    for (const s of sim.structures.items.values()) {
      if (s.colony !== 0) continue;
      const st = s.state === SS.FORMING ? `${s.filled}/${s.nodes}` : s.state === SS.ACTIVE ? `готов${s.thickness ? ', +' + formatCount(s.thickness) : ''}` : 'распадается';
      rows.push(`<div class="t"><span>⌇ ${SK_NAMES[s.kind]}: ${st}</span></div>`);
    }
    for (const bp of sim.construction.blueprints.values()) {
      if (bp.colony !== 0) continue;
      rows.push(`<div class="t"><span>⛏ ${bp.label || 'Стройка'}: осталось ${bp.remaining}</span><span class="x" data-bp="${bp.id}">×</span></div>`);
    }
    if (col.threats.length) rows.push(`<div class="t"><span style="color:var(--bad)">⚠ Угроз: ${col.threats.length}</span></div>`);
    this.el.tasks.innerHTML = rows.slice(0, 14).join('') || '<div class="sub">Нет — колония занята сама</div>';
    this.el.tasks.querySelectorAll<HTMLElement>('.x').forEach((x) =>
      x.addEventListener('click', () => {
        if (x.dataset.route) sim.queue({ type: 'removeRoute', id: Number(x.dataset.route) });
        if (x.dataset.bp) sim.queue({ type: 'cancelBlueprint', id: Number(x.dataset.bp) });
      }),
    );
    // "мысли" колонии: стимулы и распределение
    const stim = col.stimulus.map((v, i) => `${TASK_NAMES[i]} ${'▮'.repeat(Math.min(8, Math.round(v * 4)))}${'▯'.repeat(Math.max(0, 8 - Math.min(8, Math.round(v * 4))))} ${col.agentsByTask[i]}`).join('<br>');
    const castes = `раб ${col.agentsByCaste[C.WORKER] + col.residents[C.WORKER]} · солд ${col.agentsByCaste[C.SOLDIER] + col.residents[C.SOLDIER]} · разв ${col.agentsByCaste[C.SCOUT] + col.residents[C.SCOUT]} · стр ${col.agentsByCaste[C.BUILDER] + col.residents[C.BUILDER]} · нос ${col.agentsByCaste[C.CARRIER] + col.residents[C.CARRIER]}`;
    const rooms = col.nest.rooms.filter((r) => r.built).map((r) => ROOM_NAMES[r.type]).join(', ');
    this.el.mind.innerHTML = `${stim}<br><br>${castes}<br>Комнаты: ${rooms}<br>Уровень ${col.evo.level}: ${LEVEL_UNLOCKS[col.evo.level - 1]}`;
    this.el.perf.textContent = perfText;
    void T;
  }

  // ------------------------------------------------------------------ меню
  openMenu(tab: 'main' | 'help' = 'main'): void {
    const m = this.el.modal;
    m.classList.add('open');
    this.paused = true;
    const seed = Math.floor(Math.random() * 1e6);
    m.innerHTML = `<div class="box panel">
      <h2>РОЙ</h2>
      <div class="sub">Вы управляете не муравьём, а живой колонией. Создавайте условия — колония сама принимает тысячи решений.</div>
      <h3>Новый мир</h3>
      <div class="modes">${MODES.map((md) => `<div class="mode${md.key === this.selectedMode ? ' on' : ''}" data-m="${md.key}"><b>${md.name}</b><span>${md.desc}</span></div>`).join('')}</div>
      <div class="flex" style="margin-top:10px">Seed <input type="text" id="mSeed" value="${seed}" style="width:120px"> <button class="btn" id="mRand">⟳</button> <button class="btn on" id="mStart">Создать мир</button></div>
      <h3>Сохранение</h3>
      <div class="flex"><button class="btn" id="mSave">Сохранить</button><button class="btn" id="mLoad">Загрузить</button><button class="btn" id="mExport">Экспорт в файл</button><label class="btn">Импорт<input type="file" id="mImport" accept=".roy" style="display:none"></label></div>
      <h3>Настройки</h3>
      <div class="flex" style="margin-bottom:8px">Графика <span class="seg"><button class="btn${this.settings.quality === 'normal' ? ' on' : ''}" data-q="normal">Обычная</button><button class="btn${this.settings.quality === 'ultra' ? ' on' : ''}" data-q="ultra">Максимальная ✦</button></span><span class="sub">свечение, лучи солнца, отражения, светлячки, метель лепестков</span></div>
      <div class="flex">Бюджет агентов <select id="mCap">${[3000, 6000, 12000, 25000, 50000].map((v) => `<option value="${v}"${v === this.settings.agentCap ? ' selected' : ''}>${v}</option>`).join('')}</select>
      Громкость <input type="range" id="mVol" min="0" max="1" step="0.05" value="${this.settings.volume}"></div>
      <h3>Управление</h3>
      <div class="help">
        <div><b>ЛКМ</b> — инструмент · <b>ПКМ / колесо-тяг</b> — двигать камеру</div>
        <div><b>Колесо / щипок</b> — масштаб: от муравья до всей колонии</div>
        <div><b>1–9</b> — инструменты · <b>[ ]</b> — кисть</div>
        <div><b>Пробел</b> — пауза · <b>+ −</b> — скорость</div>
        <div><b>P</b> — феромоны · <b>F</b> — следить за муравьём</div>
        <div><b>C</b> — кинокамера · <b>Esc</b> — меню</div>
        <div><b>WASD / стрелки</b> — камера · <b>Q E</b> — масштаб</div>
        <div><b>Маршрут</b> через пропасть → живой мост</div>
      </div>
      <div class="flex" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="mClose">Продолжить</button></div>
    </div>`;
    m.querySelectorAll<HTMLElement>('.mode').forEach((e) => e.addEventListener('click', () => {
      this.selectedMode = e.dataset.m!;
      m.querySelectorAll('.mode').forEach((q) => q.classList.toggle('on', q === e));
    }));
    const seedI = m.querySelector<HTMLInputElement>('#mSeed')!;
    m.querySelector('#mRand')!.addEventListener('click', () => { seedI.value = String(Math.floor(Math.random() * 1e6)); });
    m.querySelector('#mStart')!.addEventListener('click', () => {
      const s = Number(seedI.value) || hashStr(seedI.value);
      this.closeMenu();
      this.onNewGame?.(this.selectedMode, s);
    });
    m.querySelector('#mSave')!.addEventListener('click', () => this.onSave?.());
    m.querySelector('#mLoad')!.addEventListener('click', () => { this.closeMenu(); this.onLoad?.(); });
    m.querySelector('#mExport')!.addEventListener('click', () => this.onExport?.());
    m.querySelector<HTMLInputElement>('#mImport')!.addEventListener('change', (ev) => {
      const f = (ev.target as HTMLInputElement).files?.[0];
      if (f) { this.closeMenu(); this.onImport?.(f); }
    });
    const cap = m.querySelector<HTMLSelectElement>('#mCap')!;
    const vol = m.querySelector<HTMLInputElement>('#mVol')!;
    const apply = () => { this.settings = { ...this.settings, agentCap: Number(cap.value), volume: Number(vol.value) }; saveSettings(this.settings); this.onSettings?.(this.settings); };
    m.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => b.addEventListener('click', () => {
      this.settings = { ...this.settings, quality: b.dataset.q as 'normal' | 'ultra' };
      m.querySelectorAll('[data-q]').forEach((q) => q.classList.toggle('on', q === b));
      saveSettings(this.settings);
      this.onSettings?.(this.settings);
      this.el.bGfx.classList.toggle('on', this.settings.quality === 'ultra');
    }));
    cap.addEventListener('change', apply);
    vol.addEventListener('input', apply);
    m.querySelector('#mClose')!.addEventListener('click', () => this.closeMenu());
    void tab;
  }

  closeMenu(): void {
    this.el.modal.classList.remove('open');
    this.paused = false;
  }

  get menuOpen(): boolean {
    return this.el.modal?.classList.contains('open') ?? false;
  }

  toggleQuality(): void {
    this.settings = { ...this.settings, quality: this.settings.quality === 'ultra' ? 'normal' : 'ultra' };
    saveSettings(this.settings);
    this.onSettings?.(this.settings);
    this.el.bGfx.classList.toggle('on', this.settings.quality === 'ultra');
    this.hint(this.settings.quality === 'ultra' ? '<b>Графика: максимальная.</b> Свечение, лучи солнца сквозь кроны, отражения в воде, светлячки ночью, метель лепестков.' : '<b>Графика: обычная.</b> Быстрее на слабых устройствах.', 4000);
  }

  setOverlayOn(on: boolean): void {
    this.el.bOverlay?.classList.toggle('on', on);
  }
}

function loadSettings(): { agentCap: number; volume: number; quality: 'normal' | 'ultra' } {
  const def = { agentCap: 12000, volume: 0.6, quality: (typeof window !== 'undefined' && window.innerWidth < 760 ? 'normal' : 'ultra') as 'normal' | 'ultra' };
  try {
    const s = JSON.parse(localStorage.getItem('roy-settings') || 'null');
    return s ? { ...def, ...s } : def;
  } catch {
    return def;
  }
}

function saveSettings(s: object): void {
  try { localStorage.setItem('roy-settings', JSON.stringify(s)); } catch { /* приватный режим */ }
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
