import './ui/styles.css';
import { AudioEngine } from './audio/AudioEngine';
import { formatCount } from './core/MathUtil';
import { Input } from './input/Input';
import { loadWorld } from './procgen/WorldLoader';
import { Renderer } from './render/Renderer';
import { deserialize, loadSave, serialize, storeSave } from './save/SaveSystem';
import { modeByKey } from './sim/Modes';
import { DT, Simulation } from './sim/Simulation';
import { Overlay } from './ui/Overlay';
import { UI } from './ui/UI';
import { zoneAt } from './world/Zones';
import { SS } from './construction/LivingStructures';

/**
 * Игра: связывает симуляцию (фиксированный шаг 30 Гц), рендер (интерполяция),
 * ввод, интерфейс и звук. Симуляция ничего не знает о рендере и DOM.
 */
class Game {
  sim!: Simulation;
  renderer!: Renderer;
  input!: Input;
  overlay: Overlay;
  ui: UI;
  audio = new AudioEngine();
  private acc = 0;
  private last = performance.now();
  private fpsT = 0;
  private frames = 0;
  private fps = 60;
  private tutorial = 0;
  private cine: { x: number; y: number; zoom: number; until: number } | null = null;
  private busUnsub: (() => void) | null = null;
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private realTime = 0;

  constructor() {
    this.overlay = new Overlay(document.getElementById('overlay') as HTMLCanvasElement);
    this.ui = new UI(document.body);
    this.ui.onNewGame = (mode, seed) => this.start(mode, seed);
    this.ui.onSave = () => this.save();
    this.ui.onLoad = () => this.load();
    this.ui.onExport = () => this.exportFile();
    this.ui.onImport = (f) => this.importFile(f);
    this.ui.onSettings = (s) => { if (this.sim) this.sim.settings.agentCap = s.agentCap; this.audio.setVolume(s.volume); };
    this.ui.onFocus = (x, y) => { this.renderer.cam.tx = x; this.renderer.cam.ty = y; this.renderer.cam.tzoom = Math.max(this.renderer.cam.tzoom, 6); };
    this.ui.onSpawnAnts = (n) => { this.sim.queue({ type: 'spawnAnts', n }); this.ui.note(`+${formatCount(n)} муравьёв в гнезде`, 'good'); };
    window.addEventListener('resize', () => this.resize());
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  async start(modeKey: string, seed: number): Promise<void> {
    const loading = document.getElementById('loading')!;
    loading.style.display = 'flex';
    document.getElementById('loadmsg')!.textContent = `Генерация мира · seed ${seed}…`;
    await new Promise((r) => setTimeout(r, 30));
    const mode = modeByKey(modeKey);
    const world = await loadWorld({ seed, width: mode.worldW, height: mode.worldH, urban: !mode.chasm, chasmChallenge: mode.chasm });
    this.setSim(new Simulation(world, mode));
    const u = new URL(location.href);
    u.searchParams.set('mode', modeKey);
    u.searchParams.set('seed', String(seed));
    history.replaceState(null, '', u.toString());
    loading.style.display = 'none';
    this.tutorial = mode.key === 'sandbox' || mode.key === 'survival' ? 1 : 0;
    if (mode.goal) this.ui.hint(`<b>${mode.name}.</b> ${mode.goal}`, 12000);
    else this.ui.hint('<b>Добро пожаловать в РОЙ.</b> Это не муравей — это колония. Смотрите, как она ищет еду сама. Колесо — масштаб, ПКМ — двигать камеру.', 9000);
  }

  private setSim(sim: Simulation): void {
    this.busUnsub?.();
    this.sim = sim;
    sim.settings.agentCap = this.ui.settings.agentCap;
    const old = this.renderer;
    if (old) old.gl.getExtension('WEBGL_lose_context')?.loseContext();
    const fresh = document.createElement('canvas');
    fresh.id = 'game';
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.renderer = new Renderer(fresh, sim);
    if (this.input) this.input.rebind(sim, this.renderer, fresh);
    else this.input = new Input(fresh, sim, this.renderer, this.ui);
    this.ui.bind(sim);
    this.resize();
    const n = sim.player.nest;
    this.renderer.cam.jump(n.entranceX, n.entranceY - 6, 18);
    this.busUnsub = sim.bus.on((e) => {
      if (e.type === 'notice') this.ui.note(e.text, e.tone ?? 'info', e.x, e.y);
      const v = this.renderer.cam.view();
      this.audio.onEvent(e, (x, y) => x >= v.x0 && x <= v.x1 && y >= v.y0 && y <= v.y1, (v.x0 + v.x1) / 2, v.x1 - v.x0);
      if (e.type === 'collapse') {
        const vv = this.renderer.cam.view();
        if (e.x > vv.x0 && e.x < vv.x1 && e.y > vv.y0 && e.y < vv.y1) this.renderer.cam.shake = Math.min(1, 0.3 + e.size * 0.05);
      }
      if (e.type === 'structureComplete' && this.input.cinematic) {
        // эпичный момент: камера отъезжает и показывает всю колонию
        this.cine = { x: e.x, y: e.y, zoom: 3, until: this.realTime + 6 };
      }
    });
  }

  private resize(): void {
    if (!this.renderer) return;
    this.renderer.resize();
    this.overlay.resize();
  }

  private tutorialStep(): void {
    const sim = this.sim;
    const col = sim.player;
    if (this.tutorial === 1 && sim.time > 40) {
      this.ui.hint('Муравьи сами разведывают мир и приносят крошки. Чем больше еды — тем больше яиц откладывает матка. Приблизьте камеру к гнезду, чтобы увидеть матку и личинок.', 10000);
      this.tutorial = 2;
    } else if (this.tutorial === 2 && sim.time > 120) {
      this.ui.hint('За <b>канавой</b> справа лежит огрызок яблока и ягоды. Выберите <b>〰 Маршрут</b> и проведите линию от гнезда через канаву — колония построит <b>живой мост</b>.', 14000);
      this.tutorial = 3;
    } else if (this.tutorial === 3 && sim.structures.items.size > 0) {
      const s = [...sim.structures.items.values()][0];
      if (s.state === SS.FORMING && s.filled < 3) this.ui.hint('Муравьи идут к краю и цепляются друг за друга. Для моста нужно много муравьёв — колонии, возможно, нужно подрасти.', 9000);
      this.tutorial = 4;
    } else if (this.tutorial === 4 && col.population() > 150) {
      this.ui.hint('Колония растёт. Попробуйте <b>⛏ Копать</b> — но осторожно: слишком широкий свод без укрепления обвалится. Приоритеты справа меняют распределение работы.', 12000);
      this.tutorial = 5;
    }
  }

  private async save(): Promise<void> {
    try {
      const data = await serialize(this.sim);
      await storeSave('slot1', data);
      this.ui.note(`Сохранено (${(data.length / 1024).toFixed(0)} КБ)`, 'good');
    } catch (e) {
      this.ui.note('Ошибка сохранения: ' + (e as Error).message, 'bad');
    }
  }

  private async load(): Promise<void> {
    try {
      const data = await loadSave('slot1');
      if (!data) { this.ui.note('Сохранений нет', 'bad'); return; }
      this.setSim(await deserialize(data));
      this.ui.note('Мир загружен', 'good');
    } catch (e) {
      this.ui.note('Ошибка загрузки: ' + (e as Error).message, 'bad');
    }
  }

  private async exportFile(): Promise<void> {
    const data = await serialize(this.sim);
    const blob = new Blob([data as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `roy-seed${this.sim.world.params.seed}-day${this.sim.clock.day}.roy`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  private async importFile(f: File): Promise<void> {
    try {
      const data = new Uint8Array(await f.arrayBuffer());
      this.setSim(await deserialize(data));
      this.ui.note('Мир импортирован', 'good');
    } catch (e) {
      this.ui.note('Ошибка импорта: ' + (e as Error).message, 'bad');
    }
  }

  loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    if (!this.sim) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.realTime += dt;
    const ui = this.ui;
    const running = !ui.paused && !ui.menuOpen;
    if (running) {
      this.acc += dt * ui.speed;
      let steps = 0;
      const maxSteps = Math.max(4, ui.speed * 3);
      const t0 = performance.now();
      while (this.acc >= DT && steps < maxSteps) {
        this.sim.step();
        this.acc -= DT;
        steps++;
        if (performance.now() - t0 > 40) break;
      }
      if (this.acc > DT * 3) this.acc = DT * 3;
    }
    const cam = this.renderer.cam;
    this.input.update(dt);
    if (this.cine) {
      if (this.realTime < this.cine.until) { cam.tx = this.cine.x; cam.ty = this.cine.y; cam.tzoom = this.cine.zoom; }
      else this.cine = null;
    }
    this.sim.view = cam.view();
    this.renderer.frame(running ? this.acc / DT : 1, this.realTime, dt);
    this.overlay.draw(this.sim, cam, this.input, ui.tool, ui.brush);
    // подсказка инспектора
    if (ui.tool === 'inspect' && !ui.menuOpen) ui.tip(this.input.inspectText(), this.input.hoverScreen[0], this.input.hoverScreen[1]);
    else ui.tip('', 0, 0);
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    const st = this.renderer.stats;
    const p = this.sim.perf;
    ui.update(dt, cam.x, `${this.fps.toFixed(0)} fps · sim ${p.total.toFixed(1)} мс · агентов ${this.sim.ants.count} (обн. ${this.sim.antSystem.updated}) · инстансов ${formatCount(st.instances)} · видно: агенты ${st.agentsDrawn}, поток ${formatCount(st.streamDrawn)}, гнездо ${st.implicitDrawn}`);
    const zone = zoneAt(this.sim.zones, cam.x);
    this.audio.update(dt, { visibleAnts: st.agentsDrawn + st.streamDrawn + st.implicitDrawn, zoom: cam.zoom, rain: this.sim.weather.rain, wind: this.sim.weather.wind, night: this.sim.clock.isNight(), zone: zone?.kind ?? 1, paused: !running });
    if (this.sim.tick % 30 === 0) this.tutorialStep();
  };
}

const game = new Game();
(window as unknown as { game: Game }).game = game;
const params = new URL(location.href).searchParams;
const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e6);
void game.start(params.get('mode') || 'sandbox', seed).then(() => requestAnimationFrame(game.loop));
