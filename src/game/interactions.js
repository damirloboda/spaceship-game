// Context-sensitive "E" interactions for the current mode.
import * as THREE from 'three';

const tv = new THREE.Vector3();

export function findInteraction(game) {
  switch (game.mode) {
    case 'foot': return onFoot(game);
    case 'interior': return inShip(game);
    case 'pilot': return piloting(game);
    case 'vehicle': return { key: 'prompt.dismount', action: () => dismount(game) };
    case 'docked': return { key: 'prompt.station_menu', action: () => game.menus.open('station') };
    default: return null;
  }
}

// Distance from a body-local point to the ship's hull box (metres).
export function distanceToShip(game, localPos) {
  const ship = game.ship;
  if (!ship.body) return Infinity;
  const l = ship.root.worldToLocal(ship.body.spin.localToWorld(tv.copy(localPos)));
  const dx = Math.max(0, Math.abs(l.x) - 5);
  const dy = Math.max(0, Math.abs(l.y - 0.5) - 3.5);
  const dz = Math.max(0, l.z - 16, -19.5 - l.z);
  return Math.hypot(dx, dy, dz);
}

function onFoot(game) {
  const p = game.player;
  const body = p.body;
  if (!body) return null;
  const ship = game.ship;
  // Ship: board from anywhere close to the hull, not just the ramp.
  if (ship.landed && ship.body === body && distanceToShip(game, p.pos) < 7) {
    return { key: 'prompt.enter_ship', action: () => game.enterShipFromOutside() };
  }
  // Skimmer
  const sk = game.skimmer;
  if (sk.active && sk.body === body && sk.pos.distanceTo(p.pos) < 3.2) {
    return { key: 'prompt.ride', action: () => mount(game) };
  }
  // Precursor ruin terminal
  if (body.ruin && body.ruin.localPos.distanceTo(p.pos) < 4) {
    return { key: 'prompt.terminal', action: () => game.director.useRuinTerminal(body) };
  }
  // Player bases
  for (const b of game.state.bases) {
    if (b.body === body.id && new THREE.Vector3(...b.pos).distanceTo(p.pos) < 4) {
      return { key: 'prompt.base', params: { name: b.name }, action: () => game.menus.open('base', { base: b }) };
    }
  }
  // Derelict drones / quest items
  const q = game.director.questPickupNear(body, p.pos);
  if (q) return q;
  const city = body.city;
  if (city) {
    const npc = city.npcNear(p.pos, 3.2);
    if (npc) return { key: 'prompt.talk', params: { name: npc.c.name }, action: () => game.menus.open('dialog', { npc }) };
    const b = city.buildingAt(p.pos, 6);
    if (b) {
      const kind = b.kind;
      const map = { market: 'shop_market', workshop: 'shop_equipment', lab: 'research_center', hospital: 'hospital', hotel: 'hotel', restaurant: 'restaurant', factory: 'shop_market' };
      if (map[kind]) return { key: `prompt.${map[kind]}`, action: () => game.menus.open(map[kind], { building: b, market: game.market(`${body.id}/city`) }) };
    }
  }
  return null;
}

function inShip(game) {
  const p = game.player;
  const ship = game.ship;
  let best = null, bd = Infinity;
  for (const it of ship.model.interactables) {
    const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
    if (d < it.radius && d < bd) { bd = d; best = it; }
  }
  if (!best) {
    ship.model.nitro.open = false;
    return null;
  }
  switch (best.id) {
    case 'seat': return { key: 'prompt.pilot', action: () => game.sitInPilotSeat() };
    case 'nitro_panel': return {
      key: 'prompt.engine_compartment',
      action: () => { ship.model.nitro.open = true; game.menus.open('techbay'); },
    };
    case 'repair_panel': return { key: 'prompt.repair', action: () => game.menus.open('repair') };
    case 'lab': return { key: 'prompt.lab', action: () => game.menus.open('lab') };
    case 'quarters': return { key: 'prompt.rest', action: () => game.menus.open('rest') };
    case 'galley': return { key: 'prompt.galley', action: () => game.menus.open('galley') };
    case 'workbench': return { key: 'prompt.workbench', action: () => game.menus.open('workbench') };
    case 'cargo': return { key: 'prompt.cargo', action: () => game.menus.open('cargo') };
    case 'hatch': return { key: ship.landed ? 'prompt.exit_ship' : 'prompt.hatch_sealed', action: () => game.exitShipToSurface() };
    default: return null;
  }
}

function piloting(game) {
  const ship = game.ship;
  if (ship.lb.phase !== 'none') return null;
  const st = ship.dockAvailable();
  if (st) return { key: 'prompt.dock', params: { name: st.name }, action: () => { ship.dock(st); game.setMode('docked'); game.events.emit('ship:docked', st); setTimeout(() => game.menus.open('station'), 1200); } };
  const wh = game.director.wormholeNear();
  if (wh) return { key: 'prompt.wormhole', action: () => game.menus.open('wormhole', { wormhole: wh }) };
  const dr = game.director.derelictNear();
  if (dr) return { key: 'prompt.rescue', action: () => game.director.rescue(dr) };
  if (ship.landed) return { key: 'prompt.leave_seat', action: () => game.standUpFromSeat() };
  if (ship.body && ship.altitude < 600) return { key: 'prompt.autoland', action: () => ship.engageAutopilot('land') };
  return { key: 'prompt.leave_seat', action: () => game.standUpFromSeat() };
}

function mount(game) {
  game.player.object.visible = false;
  game.setMode('vehicle');
}

function dismount(game) {
  const sk = game.skimmer;
  const up = sk.pos.clone().normalize();
  const side = new THREE.Vector3().crossVectors(sk.forward, up).normalize();
  game.player.placeOnBody(sk.body, sk.pos.clone().addScaledVector(side, 1.8), sk.forward.clone());
  game.player.object.visible = true;
  sk.vel.set(0, 0, 0);
  game.setMode('foot');
}
