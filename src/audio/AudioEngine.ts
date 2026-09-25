import type { GameEvent } from '../core/EventBus';
import { Z } from '../world/Zones';

/**
 * Процедурный звук (WebAudio, без файлов). Главный принцип — агрегирование:
 * миллион муравьёв не создаёт миллион звуков. Шорох роя — один шумовой слой,
 * громкость которого растёт логарифмически от числа видимых муравьёв, а
 * события (копание, стройка) ограничены по частоте и сливаются.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private swarm!: GainNode;
  private swarmFilter!: BiquadFilterNode;
  private rain!: GainNode;
  private wind!: GainNode;
  private windFilter!: BiquadFilterNode;
  private hum!: GainNode;
  private street!: GainNode;
  private noise!: AudioBuffer;
  private digBudget = 0;
  private buildBudget = 0;
  private chirpT = 0;
  volume = 0.6;
  enabled = true;

  /** Включается по первому жесту пользователя (требование браузеров). */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // белый шум — основа для шорохов, дождя и ветра
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 2.5; }
    const loop = (filterType: BiquadFilterType, freq: number, q: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start(0, Math.random() * 1.5);
      return [g, f];
    };
    [this.swarm, this.swarmFilter] = loop('bandpass', 3200, 0.8);
    [this.rain] = loop('highpass', 1800, 0.4);
    [this.wind, this.windFilter] = loop('lowpass', 400, 0.7);
    [this.street] = loop('lowpass', 160, 0.5);
    // гул дома (холодильник)
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    osc.connect(lp).connect(this.hum).connect(this.master);
    osc.start();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  private burst(freq: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass', pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 2;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, slide = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** События симуляции (агрегированно). viewX — центр камеры для панорамы. */
  onEvent(e: GameEvent, inView: (x: number, y: number) => boolean, viewCx: number, viewW: number): void {
    if (!this.ctx || !this.enabled) return;
    const pan = (x: number) => ((x - viewCx) / Math.max(1, viewW)) * 2;
    switch (e.type) {
      case 'dig':
        if (this.digBudget > 0 && inView(e.x, e.y)) { this.digBudget--; this.burst(900 + Math.random() * 900, 0.08, 0.05, 'bandpass', pan(e.x)); }
        break;
      case 'build':
        if (this.buildBudget > 0 && inView(e.x, e.y)) { this.buildBudget--; this.burst(2200, 0.05, 0.04, 'highpass', pan(e.x)); }
        break;
      case 'collapse':
        if (inView(e.x, e.y)) { this.burst(120, 1.2, 0.35, 'lowpass', pan(e.x)); this.tone(55, 0.8, 0.12, 'sine', 0, 0.6); }
        break;
      case 'structureComplete':
        [0, 4, 7, 12].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), 1.2, 0.05, 'triangle', i * 0.09));
        break;
      case 'levelUp':
        if (e.level < 100) [0, 5, 9, 12, 17].forEach((s, i) => this.tone(262 * Math.pow(2, s / 12), 1.4, 0.05, 'sine', i * 0.12));
        break;
      case 'threat':
      case 'flood':
        this.tone(110, 0.5, 0.08, 'square', 0, 0.8);
        this.tone(104, 0.5, 0.06, 'square', 0.35, 0.8);
        break;
      case 'foodFound':
        if (e.colony === 0) this.tone(880, 0.15, 0.03, 'sine', 0, 1.3);
        break;
    }
  }

  /** Непрерывные слои: рой, погода, место действия. */
  update(dt: number, p: { visibleAnts: number; zoom: number; rain: number; wind: number; night: boolean; zone: number; paused: boolean }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.digBudget = Math.min(6, this.digBudget + dt * 10);
    this.buildBudget = Math.min(4, this.buildBudget + dt * 6);
    const t = ctx.currentTime;
    const k = 0.15;
    // шорох: log-шкала по числу видимых муравьёв, ближе — громче и выше
    const n = p.paused ? 0 : p.visibleAnts;
    const swarmLevel = n > 0 ? Math.min(1, Math.log10(1 + n) / 4.2) : 0;
    const closeness = Math.min(1, Math.max(0.15, p.zoom / 24));
    this.swarm.gain.setTargetAtTime(swarmLevel * 0.22 * closeness, t, k);
    this.swarmFilter.frequency.setTargetAtTime(2200 + closeness * 2600, t, k);
    this.rain.gain.setTargetAtTime(p.rain * 0.16, t, 0.5);
    this.wind.gain.setTargetAtTime(Math.abs(p.wind) * 0.12, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(250 + Math.abs(p.wind) * 500, t, 0.5);
    this.hum.gain.setTargetAtTime(p.zone === Z.HOUSE ? 0.035 : 0, t, 0.8);
    this.street.gain.setTargetAtTime(p.zone === Z.STREET ? 0.12 : 0, t, 0.8);
    // птицы днём в саду, сверчки ночью
    this.chirpT -= dt;
    if (this.chirpT <= 0 && !p.paused) {
      this.chirpT = 0.8 + Math.random() * 3;
      if (p.zone === Z.GARDEN || p.zone === Z.MEADOW) {
        if (p.night) for (let i = 0; i < 3; i++) this.tone(4200 + Math.random() * 300, 0.04, 0.012, 'sine', i * 0.07);
        else if (p.rain < 0.2) { const f = 2000 + Math.random() * 2000; this.tone(f, 0.12, 0.012, 'sine', 0, 1.4); this.tone(f * 1.2, 0.1, 0.01, 'sine', 0.14, 0.8); }
      }
    }
  }
}
