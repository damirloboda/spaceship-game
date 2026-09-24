// Player settings and graphics presets for desktop and mobile.
import { storage } from '../core/storage.js';

export const PC_PRESETS = {
  LOW: { detail: true, pixelRatio: 0.75, grid: 16, split: 1.3, flora: 0.3, shadows: 0, bloom: true, creatures: 12, clouds: 1, weather: 600, fpsCap: 0, msaa: 0, aniso: 2, shadowRange: 50 },
  MEDIUM: { detail: true, pixelRatio: 1.0, grid: 20, split: 1.5, flora: 0.6, shadows: 1024, bloom: true, creatures: 20, clouds: 2, weather: 1200, fpsCap: 0, msaa: 0, aniso: 4, shadowRange: 60 },
  HIGH: { detail: true, pixelRatio: 1.25, grid: 24, split: 1.7, flora: 1.0, shadows: 1024, bloom: true, creatures: 28, clouds: 3, weather: 2000, fpsCap: 0, msaa: 2, aniso: 8, shadowRange: 70 },
  ULTRA: { detail: true, pixelRatio: 1.75, grid: 30, split: 2.1, flora: 1.3, shadows: 4096, bloom: true, creatures: 36, clouds: 4, weather: 3000, fpsCap: 0, msaa: 4, aniso: 16, shadowRange: 100 },
  CINEMATIC: { detail: true, pixelRatio: 2.0, grid: 32, split: 2.3, flora: 1.6, shadows: 4096, bloom: true, creatures: 44, clouds: 5, weather: 4000, fpsCap: 0, msaa: 8, aniso: 16, shadowRange: 130 },
};

export const MOBILE_PRESETS = {
  BATTERY: { detail: false, pixelRatio: 1.0, grid: 12, split: 1.2, flora: 0.2, shadows: 0, bloom: false, creatures: 8, clouds: 1, weather: 300, fpsCap: 30, msaa: 2, aniso: 2, shadowRange: 50 },
  PERFORMANCE: { detail: false, pixelRatio: 1.25, grid: 14, split: 1.3, flora: 0.35, shadows: 0, bloom: false, creatures: 10, clouds: 1, weather: 500, fpsCap: 60, msaa: 2, aniso: 2, shadowRange: 50 },
  BALANCED: { detail: true, pixelRatio: 1.6, grid: 16, split: 1.45, flora: 0.5, shadows: 1024, bloom: true, creatures: 14, clouds: 2, weather: 800, fpsCap: 60, msaa: 4, aniso: 4, shadowRange: 60 },
  QUALITY: { detail: true, pixelRatio: 2.0, grid: 20, split: 1.5, flora: 0.8, shadows: 1024, bloom: true, creatures: 18, clouds: 2, weather: 1200, fpsCap: 60, msaa: 4, aniso: 8, shadowRange: 70 },
  ULTRA_MOBILE: { detail: true, pixelRatio: 2.5, grid: 24, split: 1.7, flora: 1.1, shadows: 2048, bloom: true, creatures: 24, clouds: 3, weather: 1600, fpsCap: 60, msaa: 4, aniso: 16, shadowRange: 90 },
};

export function isMobileDevice() {
  try {
    const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
    const ua = navigator.userAgent || '';
    return !!coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  } catch {
    return false;
  }
}

const KEY = 'ultracosmos.settings';

export function defaultSettings() {
  const mobile = isMobileDevice();
  let lang = 'en';
  try {
    const l = (navigator.language || 'en').slice(0, 2);
    if (['en', 'ru', 'tr', 'uk'].includes(l)) lang = l;
  } catch { /* default */ }
  return {
    language: lang,
    platform: mobile ? 'mobile' : 'pc',
    preset: mobile ? 'BALANCED' : 'HIGH',
    dynamicResolution: true,
    fov: 75,
    sensitivity: 1.0,
    invertY: false,
    masterVolume: 0.7,
    musicVolume: 0.5,
    sfxVolume: 0.8,
    subtitles: true,
    touchControls: mobile,
    cameraShake: true,
    reducedMotion: false,
    highContrastUI: false,
    uiScale: 1.0,
    thirdPerson: mobile,
    autoRefuelJetpack: true,
    showFps: false,
    colorblind: 'none',
  };
}

export function loadSettings() {
  const base = defaultSettings();
  try {
    const raw = storage.get(KEY);
    if (raw) return { ...base, ...JSON.parse(raw) };
  } catch { /* use defaults */ }
  return base;
}

export function saveSettings(s) {
  try { storage.set(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function presetFor(settings) {
  const table = settings.platform === 'mobile' ? MOBILE_PRESETS : PC_PRESETS;
  return table[settings.preset] || Object.values(table)[2];
}
