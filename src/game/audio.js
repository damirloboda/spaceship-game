// Fully synthesised audio (no sample files): wind, rain, engines, jetpack,
// UI blips, thunder and Lightbreak whooshes built from oscillators and noise.
export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.loops = {};
    this.last = {};
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.noiseBuf = this.makeNoise();
      this.applyVolume();
      this.loops.wind = this.noiseLoop(400, 0.0);
      this.loops.rain = this.noiseLoop(2500, 0.0, 'highpass');
      this.loops.engine = this.toneLoop(55, 'sawtooth', 0.0, 320);
      this.loops.jet = this.noiseLoop(900, 0.0, 'bandpass');
      this.loops.drive = this.toneLoop(110, 'triangle', 0.0, 900);
    } catch {
      this.ctx = null;
    }
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.settings.masterVolume;
    this.sfx.gain.value = this.settings.sfxVolume;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w;
      d[i] = w * 0.5 + b * 2.5;
    }
    return buf;
  }

  noiseLoop(freq, gain, type = 'lowpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    return { g, f };
  }

  toneLoop(freq, type, gain, cutoff) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    o.connect(f).connect(g).connect(this.sfx);
    o.start();
    return { g, f, o };
  }

  setLoop(name, gain, freq) {
    const l = this.loops[name];
    if (!l || !this.ctx) return;
    const t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(gain, t, 0.15);
    if (freq !== undefined) {
      if (l.o) l.o.frequency.setTargetAtTime(freq, t, 0.2);
      else l.f.frequency.setTargetAtTime(freq, t, 0.2);
    }
  }

  blip(freq, dur = 0.08, type = 'sine', vol = 0.15, slide = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), c.currentTime + dur);
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  burst(dur, freq, vol = 0.3, type = 'lowpass') {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    src.stop(c.currentTime + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 40) return;
    this.last[name] = now;
    try {
      switch (name) {
        case 'step': {
          const f = { snow: 900, sand: 1400, rock: 2200, metal: 3000, mud: 500, ice: 3500, grass: 1100, crystal: 4000, organic: 700 }[opts.material] || 1500;
          this.burst(0.07, f, 0.08, 'bandpass');
          break;
        }
        case 'jump': this.burst(0.12, 700, 0.07); break;
        case 'land': this.burst(0.2, 400, 0.18); break;
        case 'ui': this.blip(880, 0.05, 'triangle', 0.08); break;
        case 'ui_back': this.blip(520, 0.06, 'triangle', 0.08); break;
        case 'buy': this.blip(660, 0.06, 'square', 0.06); setTimeout(() => this.blip(990, 0.09, 'square', 0.06), 60); break;
        case 'error': this.blip(180, 0.15, 'sawtooth', 0.08); break;
        case 'scan': this.blip(300, 0.9, 'sine', 0.12, 1500); break;
        case 'discovery': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 0.25, 'sine', 0.12), i * 110)); break;
        case 'mine_done': this.blip(1200, 0.12, 'triangle', 0.1); this.burst(0.2, 3000, 0.1, 'highpass'); break;
        case 'install': this.burst(0.15, 1500, 0.15, 'bandpass'); setTimeout(() => this.blip(440, 0.3, 'sine', 0.12, 440), 150); break;
        case 'takeoff': this.burst(1.6, 300, 0.35); break;
        case 'land_ship': this.burst(0.6, 250, 0.3); break;
        case 'ready': [660, 880, 1320].forEach((f, i) => setTimeout(() => this.blip(f, 0.2, 'triangle', 0.1), i * 90)); break;
        case 'lightbreak': this.blip(80, 1.4, 'sawtooth', 0.25, 1600); this.burst(1.5, 600, 0.3); break;
        case 'whoosh': this.burst(2.5, 900, 0.35, 'bandpass'); break;
        case 'exit': this.blip(1400, 1.0, 'sine', 0.2, -1300); this.burst(0.8, 1200, 0.25); break;
        case 'thunder': this.burst(2.8, 160, 0.6); break;
        case 'alarm': this.blip(700, 0.18, 'square', 0.08); setTimeout(() => this.blip(520, 0.18, 'square', 0.08), 200); break;
        case 'crash': this.burst(0.8, 200, 0.6); break;
        case 'signal': [0, 1, 2].forEach((i) => setTimeout(() => this.blip(1760 - i * 300, 0.12, 'sine', 0.08), i * 150)); break;
        case 'hurt': this.blip(220, 0.2, 'sawtooth', 0.12, -100); break;
        default: break;
      }
    } catch { /* audio is optional */ }
  }
}
