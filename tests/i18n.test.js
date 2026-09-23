import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../src/i18n/en.js';
import ru from '../src/i18n/ru.js';
import tr from '../src/i18n/tr.js';
import uk from '../src/i18n/uk.js';

const PREFIXES = ['title', 'creator', 'import', 'export', 'pause', 'settings', 'ui', 'hud', 'warn', 'tut', 'prompt', 'marker', 'inv', 'map', 'shop', 'research', 'dialog', 'tech', 'repair', 'lab', 'craft', 'rest', 'galley', 'base', 'station', 'exp', 'wormhole', 'journal', 'story', 'ruin', 'help', 'photo', 'touch', 'quest', 'radio', 'news', 'anomaly'];

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!p.endsWith('i18n')) walk(p, out); } else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('Localization: every static key used in code exists in English', () => {
  const re = new RegExp(`'((?:${PREFIXES.join('|')})\\.[a-z0-9_.]+)'`, 'g');
  const missing = new Set();
  for (const file of walk('src')) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) if (!(m[1] in en) && !m[1].endsWith('.')) missing.add(`${m[1]} (${file})`);
  }
  assert.deepEqual([...missing], []);
});

test('Localization: Russian, Turkish and Ukrainian cover every English key', () => {
  for (const [name, table] of [['ru', ru], ['tr', tr], ['uk', uk]]) {
    const miss = Object.keys(en).filter((k) => !(k in table));
    assert.deepEqual(miss, [], `${name} missing ${miss.length} keys`);
    for (const [k, v] of Object.entries(table)) {
      const params = (en[k].match(/\{[a-z_]+\}/g) || []).sort();
      const mine = (v.match(/\{[a-z_]+\}/g) || []).sort();
      assert.deepEqual(mine, params, `${name}:${k} placeholders`);
    }
  }
});
