// Localisation. Strings live in per-language modules, never in game code.
import en from './en.js';
import ru from './ru.js';
import tr from './tr.js';
import uk from './uk.js';

export const LANGUAGES = { en: 'English', ru: 'Русский', tr: 'Türkçe', uk: 'Українська' };
const TABLES = { en, ru, tr, uk };
let current = 'en';

export function setLanguage(lang) {
  current = TABLES[lang] ? lang : 'en';
  try { document.documentElement.lang = current; } catch { /* no DOM */ }
}

export function getLanguage() {
  return current;
}

export function t(key, params) {
  let s = TABLES[current][key] ?? en[key] ?? key;
  if (params) {
    for (const k in params) s = s.split(`{${k}}`).join(String(params[k]));
  }
  return s;
}

export function has(key) {
  return key in en;
}

export function missingKeys(lang) {
  return Object.keys(en).filter((k) => !(k in TABLES[lang]));
}
