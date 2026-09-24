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
  // Phones: no post-processing (canvas MSAA is nearly free on tile GPUs),
  // shadows only on the top presets, short grass and flora ranges.
  BATTERY: { detail: false, pixelRatio: 1.0, grid: 10, split: 1.15, flora: 0.2, shadows: 0, bloom: false, creatures: 6, clouds: 1, weather: 250, fpsCap: 30, msaa: 0, aniso: 2, shadowRange: 50, atmoSteps: 5, grass: 0 },
  PERFORMANCE: { detail: true, pixelRatio: 1.1, grid: 12, split: 1.25, flora: 0.3, shadows: 0, bloom: false, creatures: 8, clouds: 1, weather: 400, fpsCap: 60, msaa: 0, aniso: 4, shadowRange: 50, atmoSteps: 6, grass: 0.5 },
  BALANCED: { detail: true, pixelRatio: 1.25, grid: 14, split: 1.35, flora: 0.4, shadows: 0, bloom: false, creatures: 10, clouds: 1, weather: 600, fpsCap: 60, msaa: 0, aniso: 4, shadowRange: 60, atmoSteps: 6, grass: 0.8 },
  QUALITY: { detail: true, pixelRatio: 1.5, grid: 18, split: 1.5, flora: 0.7, shadows: 1024, bloom: true, creatures: 16, clouds: 2, weather: 1000, fpsCap: 60, msaa: 2, aniso: 8, shadowRange: 70, atmoSteps: 8, grass: 1 },
  ULTRA_MOBILE: { detail: true, pixelRatio: 1.9, grid: 22, split: 1.7, flora: 1.0, shadows: 2048, bloom: true, creatures: 22, clouds: 3, weather: 1500, fpsCap: 60, msaa: 4, aniso: 16, shadowRange: 90, atmoSteps: 10, grass: 1 },
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
