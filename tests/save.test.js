import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameState } from '../src/game/state.js';
import { SaveManager, serialize, deserialize, migrate, SAVE_VERSION } from '../src/game/save.js';

function memoryStorage() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; }, remove: (k) => m.delete(k), raw: m };
}

test('Save: full round trip keeps character, ship, jetpack, nitro and discoveries', () => {
  const s = new GameState();
  s.profile.name = 'Nova';
  s.credits = 1234;
  s.addItem('cobalt', 42);
  s.jetpack.owned = true;
  s.jetpack.fuel = 33;
  s.addItem('nitro');
  s.ship.installNitro(s.combined);
  s.ship.modules.engine.hp = 40;
  s.discover('species', 'x/fauna1', { name: 'Grolox' });
  s.minedDeposits.add('d1');
  s.reputation.veyari = 25;
  s.location = { systemId: '1:0:2:0', mode: 'ship', ship: { frame: 'p0', pos: [1, 2, 3], quat: [0, 0, 0, 1] } };
  const r = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  assert.equal(r.profile.name, 'Nova');
  assert.equal(r.credits, 1234);
  assert.equal(r.count('cobalt'), 42);
  assert.equal(r.jetpack.owned, true);
  assert.equal(r.jetpack.fuel, 33);
  assert.equal(r.ship.nitro.installed, true);
  assert.equal(r.ship.modules.engine.hp, 40);
  assert.ok(r.isDiscovered('species', 'x/fauna1'));
  assert.ok(r.minedDeposits.has('d1'));
  assert.equal(r.reputation.veyari, 25);
  assert.equal(r.location.systemId, '1:0:2:0');
  assert.deepEqual(r.location.ship.pos, [1, 2, 3]);
});

test('Save: corrupt main save falls back to backup', () => {
  const store = memoryStorage();
  const sm = new SaveManager(store);
  const s = new GameState();
  s.credits = 777;
  sm.save(s);
  s.credits = 888;
  sm.save(s); // previous becomes .bak
  store.set(sm.key, '{not json');
  const loaded = sm.load();
  assert.equal(loaded.source, `${sm.key}.bak`);
  assert.equal(loaded.state.credits, 777);
});

test('Save: v1 payload migrates to current version', () => {
  const v1 = { credits: 50, inventory: { slots: 10, items: [{ id: 'ferrite', n: 7 }] } };
  const m = migrate(v1);
  assert.equal(m.version, SAVE_VERSION);
  const s = deserialize(v1);
  assert.equal(s.count('ferrite'), 7);
  assert.equal(s.credits, 50);
});

test('Save: newer versions and garbage are rejected, not crashing', () => {
  assert.throws(() => deserialize({ version: 999, data: {} }));
  assert.throws(() => deserialize(null));
  const sm = new SaveManager(memoryStorage());
  assert.equal(sm.load(), null);
});

test('Save: export / import string', () => {
  const sm = new SaveManager(memoryStorage());
  const s = new GameState();
  s.profile.name = 'Ärö Звезда';
  const str = sm.exportString(s);
  assert.equal(sm.importString(str).profile.name, 'Ärö Звезда');
});
