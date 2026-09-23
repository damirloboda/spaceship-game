// Ship systems: modules with health, fuel, energy distribution, Nitro slot,
// Overdrive and the Lightbreak drive. No rendering — unit tested directly.
export const SHIP_CLASSES = {
  scout: { length: 16, span: 14, cargo: 12, fuel: 80, accel: 1.25, maxSpeed: 1.15, color: [0.85, 0.3, 0.2] },
  explorer: { length: 26, span: 22, cargo: 24, fuel: 100, accel: 1.0, maxSpeed: 1.0, color: [0.88, 0.9, 0.92] },
  cargo: { length: 38, span: 26, cargo: 60, fuel: 140, accel: 0.6, maxSpeed: 0.8, color: [0.8, 0.65, 0.2] },
  science: { length: 28, span: 24, cargo: 20, fuel: 110, accel: 0.9, maxSpeed: 0.95, color: [0.9, 0.95, 1.0] },
  mining: { length: 30, span: 24, cargo: 48, fuel: 110, accel: 0.75, maxSpeed: 0.85, color: [0.9, 0.55, 0.15] },
  rescue: { length: 24, span: 20, cargo: 18, fuel: 120, accel: 1.1, maxSpeed: 1.05, color: [0.95, 0.95, 0.95] },
  passenger: { length: 44, span: 30, cargo: 16, fuel: 150, accel: 0.55, maxSpeed: 0.9, color: [0.6, 0.75, 0.9] },
  luxury: { length: 32, span: 26, cargo: 14, fuel: 120, accel: 1.1, maxSpeed: 1.2, color: [0.95, 0.85, 0.6] },
  military: { length: 30, span: 28, cargo: 16, fuel: 110, accel: 1.3, maxSpeed: 1.1, color: [0.35, 0.4, 0.38] },
  expedition: { length: 120, span: 60, cargo: 200, fuel: 600, accel: 0.35, maxSpeed: 0.7, color: [0.8, 0.82, 0.85] },
  colony: { length: 220, span: 90, cargo: 400, fuel: 900, accel: 0.2, maxSpeed: 0.55, color: [0.7, 0.75, 0.7] },
};

export const FLIGHT = {
  atmoMaxSpeed: 320,
  spaceMaxSpeed: 2400,
  overdriveMultiplier: 9,
  lightbreakSpeed: 2.6e5,
  mainAccel: 70,
  spaceAccel: 240,
  nitroBurn: 6,
  nitroRegen: 1.2,
  lightbreakChargeRate: 20,
  lightbreakDecay: 6,
  interstellarFuel: 25,
  insystemFuel: 6,
  takeoffFuel: 1.5,
};

export const MODULE_IDS = ['hull', 'engine', 'shields', 'lifeSupport', 'scanner', 'lightbreak'];
const BROKEN_AT = 25;

export class ShipSystems {
  constructor(shipClass = 'explorer') {
    this.shipClass = shipClass;
    const c = SHIP_CLASSES[shipClass] || SHIP_CLASSES.explorer;
    this.fuelCapacity = c.fuel;
    this.fuel = c.fuel;
    this.modules = {};
    for (const id of MODULE_IDS) this.modules[id] = { hp: 100 };
    this.shieldCharge = 100;
    this.energy = { engines: 0.4, shields: 0.3, systems: 0.3 };
    this.nitro = { installed: false, charge: 0 };
    this.lightbreak = { charge: 0, state: 'idle', timer: 0 };
    this.engineTier = 1;
    this.overdrive = false;
  }

  isBroken(id) {
    return this.modules[id].hp < BROKEN_AT;
  }

  setEnergy(engines, shields, systems) {
    const sum = engines + shields + systems || 1;
    this.energy = { engines: engines / sum, shields: shields / sum, systems: systems / sum };
  }

  // Must be called while the player stands at the engine compartment.
  installNitro(inventory) {
    if (this.nitro.installed) return { ok: false, reason: 'already_installed' };
    if (!inventory.has('nitro')) return { ok: false, reason: 'no_nitro' };
    inventory.remove('nitro', 1);
    this.nitro.installed = true;
    this.nitro.charge = 100;
    return { ok: true };
  }

  refillNitro(inventory) {
    if (!this.nitro.installed) return { ok: false, reason: 'not_installed' };
    if (!inventory.has('nitro_cell')) return { ok: false, reason: 'no_cell' };
    inventory.remove('nitro_cell', 1);
    this.nitro.charge = 100;
    return { ok: true };
  }

  canOverdrive(inAtmosphere) {
    return this.nitro.installed && this.nitro.charge > 0.5 && !this.isBroken('engine') && !inAtmosphere && this.lightbreak.state !== 'active';
  }

  engineFactor() {
    const e = this.modules.engine.hp / 100;
    return (0.55 + this.energy.engines * 1.1) * (0.4 + 0.6 * e) * (this.engineTier === 2 ? 1.3 : 1);
  }

  // ctx: { throttle 0..1, boost bool, inAtmosphere bool, clearOfWells bool }
  update(dt, ctx) {
    const c = SHIP_CLASSES[this.shipClass] || SHIP_CLASSES.explorer;
    const inAtmo = !!ctx.inAtmosphere;
    this.overdrive = !!ctx.boost && this.canOverdrive(inAtmo);
    if (this.overdrive) {
      this.nitro.charge = Math.max(0, this.nitro.charge - FLIGHT.nitroBurn * dt);
    } else if (this.nitro.installed) {
      this.nitro.charge = Math.min(100, this.nitro.charge + FLIGHT.nitroRegen * dt);
    }
    // Lightbreak charges only while overdriving in open space.
    const lb = this.lightbreak;
    if (lb.state === 'idle' || lb.state === 'charging' || lb.state === 'ready') {
      if (this.overdrive && ctx.clearOfWells && !this.isBroken('lightbreak')) {
        lb.charge = Math.min(100, lb.charge + FLIGHT.lightbreakChargeRate * dt);
        lb.state = lb.charge >= 100 ? 'ready' : 'charging';
      } else if (lb.state !== 'ready') {
        lb.charge = Math.max(0, lb.charge - FLIGHT.lightbreakDecay * dt);
        lb.state = lb.charge > 0 ? 'charging' : 'idle';
      }
    } else if (lb.state === 'cooldown') {
      lb.timer -= dt;
      if (lb.timer <= 0) lb.state = 'idle';
    }
    // Shields regenerate from their energy share.
    if (!this.isBroken('shields')) {
      this.shieldCharge = Math.min(100, this.shieldCharge + (2 + this.energy.shields * 10) * dt);
    }
    // Fuel: hovering in atmosphere and thrusting cost a little.
    const burn = (inAtmo ? 0.025 : 0.01) + (ctx.throttle || 0) * (inAtmo ? 0.03 : 0.015) + (this.overdrive ? 0.05 : 0);
    this.fuel = Math.max(0, this.fuel - burn * dt);
    const ef = this.engineFactor();
    const noFuel = this.fuel <= 0;
    let maxSpeed = (inAtmo ? FLIGHT.atmoMaxSpeed : FLIGHT.spaceMaxSpeed) * c.maxSpeed * (this.engineTier === 2 ? 1.25 : 1);
    let accel = (inAtmo ? FLIGHT.mainAccel : FLIGHT.spaceAccel) * c.accel * ef;
    if (this.overdrive) {
      maxSpeed *= FLIGHT.overdriveMultiplier;
      accel *= FLIGHT.overdriveMultiplier * 0.6;
    }
    if (lb.state === 'active') {
      maxSpeed = FLIGHT.lightbreakSpeed;
      accel = FLIGHT.lightbreakSpeed * 0.8;
    }
    if (noFuel && lb.state !== 'active') {
      maxSpeed *= 0.15;
      accel *= 0.15;
    }
    return { maxSpeed, accel, overdrive: this.overdrive, lightbreakReady: lb.state === 'ready', noFuel };
  }

  lightbreakCost(interstellar) {
    return interstellar ? FLIGHT.interstellarFuel : FLIGHT.insystemFuel;
  }

  engageLightbreak(interstellar) {
    const lb = this.lightbreak;
    if (lb.state !== 'ready') return { ok: false, reason: 'not_ready' };
    if (this.isBroken('lightbreak')) return { ok: false, reason: 'drive_damaged' };
    const cost = this.lightbreakCost(interstellar);
    if (this.fuel < cost) return { ok: false, reason: 'fuel' };
    this.fuel -= cost;
    lb.state = 'active';
    lb.charge = 0;
    return { ok: true };
  }

  endLightbreak() {
    this.lightbreak.state = 'cooldown';
    this.lightbreak.timer = 3;
  }

  // Shields absorb damage first; the rest hits the hull and one random module.
  applyDamage(amount, rand = Math.random) {
    const before = MODULE_IDS.filter((id) => this.isBroken(id));
    let rest = amount;
    if (!this.isBroken('shields')) {
      const absorbed = Math.min(this.shieldCharge, rest * 0.7);
      this.shieldCharge -= absorbed;
      rest -= absorbed;
    }
    if (rest > 0) {
      this.modules.hull.hp = Math.max(1, this.modules.hull.hp - rest * 0.6);
      const others = MODULE_IDS.filter((id) => id !== 'hull');
      const hit = others[Math.floor(rand() * others.length) % others.length];
      this.modules[hit].hp = Math.max(0, this.modules[hit].hp - rest * 0.9);
    }
    return MODULE_IDS.filter((id) => this.isBroken(id) && !before.includes(id));
  }

  repair(id, inventory) {
    if (!this.modules[id]) return { ok: false, reason: 'unknown' };
    if (this.modules[id].hp >= 100) return { ok: false, reason: 'intact' };
    if (!inventory.has('repair_kit')) return { ok: false, reason: 'no_kit' };
    inventory.remove('repair_kit', 1);
    this.modules[id].hp = Math.min(100, this.modules[id].hp + 60);
    return { ok: true };
  }

  refuel(amount) {
    const before = this.fuel;
    this.fuel = Math.min(this.fuelCapacity, this.fuel + amount);
    return this.fuel - before;
  }

  warnings() {
    const w = [];
    if (this.modules.hull.hp < 30) w.push('hull_critical');
    if (this.isBroken('engine')) w.push('engine_damaged');
    if (this.isBroken('shields') || this.shieldCharge < 5) w.push('shields_down');
    if (this.isBroken('lifeSupport')) w.push('life_support');
    if (this.isBroken('scanner')) w.push('scanner_offline');
    if (this.isBroken('lightbreak')) w.push('lightbreak_damaged');
    if (this.fuel < this.fuelCapacity * 0.15) w.push('fuel_low');
    return w;
  }

  toJSON() {
    return {
      shipClass: this.shipClass, fuel: this.fuel, fuelCapacity: this.fuelCapacity, modules: this.modules,
      shieldCharge: this.shieldCharge, energy: this.energy, nitro: this.nitro, engineTier: this.engineTier,
      lightbreak: { charge: this.lightbreak.state === 'active' ? 0 : this.lightbreak.charge, state: this.lightbreak.state === 'ready' ? 'ready' : 'idle', timer: 0 },
    };
  }

  static fromJSON(d) {
    const s = new ShipSystems(d?.shipClass || 'explorer');
    if (!d) return s;
    if (Number.isFinite(d.fuelCapacity)) s.fuelCapacity = d.fuelCapacity;
    if (Number.isFinite(d.fuel)) s.fuel = Math.min(d.fuel, s.fuelCapacity);
    for (const id of MODULE_IDS) if (Number.isFinite(d.modules?.[id]?.hp)) s.modules[id].hp = d.modules[id].hp;
    if (Number.isFinite(d.shieldCharge)) s.shieldCharge = d.shieldCharge;
    if (d.energy) s.setEnergy(d.energy.engines, d.energy.shields, d.energy.systems);
    if (d.nitro) s.nitro = { installed: !!d.nitro.installed, charge: Number(d.nitro.charge) || 0 };
    if (d.engineTier) s.engineTier = d.engineTier;
    if (d.lightbreak) s.lightbreak = { charge: Number(d.lightbreak.charge) || 0, state: d.lightbreak.state === 'ready' ? 'ready' : 'idle', timer: 0 };
    return s;
  }
}
