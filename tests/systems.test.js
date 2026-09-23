import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Jetpack, JET_FUEL_PER_CANISTER } from '../src/game/jetpack.js';
import { ShipSystems, FLIGHT } from '../src/game/shipSystems.js';
import { Inventory } from '../src/game/inventory.js';
import { Market, reputationTier } from '../src/game/economy.js';
import { checkExpedition } from '../src/game/expedition.js';

test('Jetpack: does nothing until owned', () => {
  const j = new Jetpack();
  assert.equal(j.update(0.1, true, 9.8).accel, 0);
});

test('Jetpack: thrust beats normal gravity but not extreme gravity', () => {
  const j = new Jetpack();
  j.owned = true;
  const r = j.update(0.1, true, 9.8);
  assert.ok(r.active && r.net > 0);
  assert.ok(!j.canLift(24));
  assert.ok(j.canLift(9.8));
});

test('Jetpack: burns fuel, overheats, then recovers after cooling', () => {
  const j = new Jetpack();
  j.owned = true;
  const f0 = j.fuel;
  let t = 0;
  while (!j.overheated && t < 20) { j.update(0.05, true, 9.8); t += 0.05; }
  assert.ok(j.overheated, 'overheats under sustained thrust');
  assert.ok(j.fuel < f0);
  assert.equal(j.update(0.05, true, 9.8).active, false, 'locked out while overheated');
  for (let i = 0; i < 100; i++) j.update(0.05, false, 9.8);
  assert.equal(j.overheated, false);
  assert.ok(j.update(0.05, true, 9.8).active);
});

test('Jetpack: empty tank stops thrust; refuel restores it', () => {
  const j = new Jetpack();
  j.owned = true;
  j.fuel = 0;
  assert.equal(j.update(0.1, true).active, false);
  j.refuel(JET_FUEL_PER_CANISTER);
  assert.equal(j.fuel, JET_FUEL_PER_CANISTER);
});

test('Nitro: install requires the item and fills the slot once', () => {
  const s = new ShipSystems();
  const inv = new Inventory(10);
  assert.equal(s.installNitro(inv).reason, 'no_nitro');
  inv.add('nitro', 1);
  assert.ok(s.installNitro(inv).ok);
  assert.equal(inv.count('nitro'), 0);
  assert.equal(s.nitro.charge, 100);
  inv.add('nitro', 1);
  assert.equal(s.installNitro(inv).reason, 'already_installed');
});

test('Nitro: overdrive multiplies top speed only with Nitro installed and in space', () => {
  const s = new ShipSystems();
  const base = s.update(0.1, { throttle: 1, boost: true, inAtmosphere: false }).maxSpeed;
  assert.equal(s.overdrive, false);
  const inv = new Inventory(4);
  inv.add('nitro');
  s.installNitro(inv);
  const boosted = s.update(0.1, { throttle: 1, boost: true, inAtmosphere: false });
  assert.ok(boosted.overdrive);
  assert.ok(Math.abs(boosted.maxSpeed / base - FLIGHT.overdriveMultiplier) < 1e-6);
  assert.equal(s.update(0.1, { throttle: 1, boost: true, inAtmosphere: true }).overdrive, false);
});

test('Lightbreak: charges during overdrive, engages, costs fuel, accelerates', () => {
  const s = new ShipSystems();
  const inv = new Inventory(4);
  inv.add('nitro');
  s.installNitro(inv);
  assert.equal(s.engageLightbreak(true).reason, 'not_ready');
  let t = 0;
  while (s.lightbreak.state !== 'ready' && t < 30) { s.update(0.1, { throttle: 1, boost: true, clearOfWells: true }); t += 0.1; }
  assert.equal(s.lightbreak.state, 'ready');
  const fuel = s.fuel;
  assert.ok(s.engageLightbreak(true).ok);
  assert.ok(s.fuel < fuel - 20);
  const r = s.update(0.1, { throttle: 1 });
  assert.equal(r.maxSpeed, FLIGHT.lightbreakSpeed);
  s.endLightbreak();
  assert.equal(s.lightbreak.state, 'cooldown');
});

test('Ship: damage breaks modules and repair kits fix them', () => {
  const s = new ShipSystems();
  let broken = [];
  for (let i = 0; i < 10; i++) broken = broken.concat(s.applyDamage(40, () => 0));
  assert.ok(broken.includes('engine'));
  assert.ok(s.warnings().includes('engine_damaged'));
  const inv = new Inventory(4);
  assert.equal(s.repair('engine', inv).reason, 'no_kit');
  inv.add('repair_kit', 2);
  s.repair('engine', inv);
  s.repair('engine', inv);
  assert.ok(!s.isBroken('engine'));
  assert.ok(s.modules.hull.hp >= 1, 'hull never drops to zero from a single system');
});

test('Inventory: stacks, overflow and transfer', () => {
  const a = new Inventory(2);
  assert.equal(a.add('aurum', 150), 0);
  assert.equal(a.add('aurum', 100), 50);
  const b = new Inventory(4);
  assert.equal(a.transfer('aurum', 120, b), 120);
  assert.equal(a.count('aurum'), 80);
  assert.equal(b.count('aurum'), 120);
});

test('Economy: selling lowers price, recovers over time', () => {
  const m = new Market('m', 1);
  const p0 = m.price('cobalt', 'sell');
  m.recordSale('cobalt', 30);
  const p1 = m.price('cobalt', 'sell');
  assert.ok(p1 < p0);
  m.update(6000);
  assert.ok(m.price('cobalt', 'sell') > p1);
  assert.ok(m.price('cobalt', 'buy') > m.price('cobalt', 'sell'));
  assert.equal(reputationTier(90), 'honored');
  assert.equal(reputationTier(-60), 'hostile');
});

test('Expedition: missing supplies are reported, Nitro and fuel are critical', () => {
  const ship = new ShipSystems();
  const inv = new Inventory(10);
  const src = () => ({ ship, jetpack: { owned: false, fuel: 0 }, count: (id) => inv.count(id), cargoFree: 10 });
  let r = checkExpedition(src());
  assert.equal(r.ready, false);
  assert.equal(r.blocked, true);
  inv.add('nitro');
  ship.installNitro(inv);
  for (const [id, n] of [['water', 2], ['ration', 2], ['repair_kit', 1], ['medkit', 1], ['jet_fuel', 1], ['energy_cell', 1]]) inv.add(id, n);
  r = checkExpedition(src());
  assert.equal(r.ready, true, JSON.stringify(r.rows.filter((x) => !x.ok)));
});
