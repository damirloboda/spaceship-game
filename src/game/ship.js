/**
 * Ships (§24-§27, §29, §30, §31, §90).
 *
 * The ship is a set of modules bolted to a hull. Modules have mass, draw
 * power, take damage independently and can be swapped at a shipyard. Thrust,
 * range, cargo and shield strength are all *derived* from what is installed,
 * so refitting genuinely changes how the ship flies.
 *
 * Nitro (§29) is a physical part you buy and install into the engine bay's
 * overdrive slot. Lightbreak (§30) is a drive mode that has to be charged from
 * the reactor before it will engage. Neither is a cosmetic flag.
 */
import { RNG, hashInts } from '../core/rng.js';
import { shipName } from '../gen/names.js';

export const C = 299792458;              // m/s

/* ------------------------------------------------------------------ */
/* Hulls                                                               */
/* ------------------------------------------------------------------ */

export const SHIP_CLASSES = {
  scout:      { label: 'Scout',        baseMass: 9000, hullStrength: 420,   slots: { engine: 1, shield: 1, cargo: 1, utility: 2 }, cargoBase: 40,  crewCap: 1,  price: 45000,  agility: 1.6 },
  explorer:   { label: 'Explorer',     baseMass: 22000, hullStrength: 900,  slots: { engine: 1, shield: 1, cargo: 2, utility: 3 }, cargoBase: 120, crewCap: 3,  price: 140000, agility: 1.15 },
  cargo:      { label: 'Hauler',       baseMass: 48000, hullStrength: 1500,  slots: { engine: 2, shield: 1, cargo: 5, utility: 2 }, cargoBase: 480, crewCap: 4,  price: 260000, agility: 0.6 },
  science:    { label: 'Science Ship', baseMass: 28000, hullStrength: 1100,  slots: { engine: 1, shield: 2, cargo: 2, utility: 5 }, cargoBase: 140, crewCap: 6,  price: 320000, agility: 0.95 },
  mining:     { label: 'Mining Rig',   baseMass: 41000, hullStrength: 1400,  slots: { engine: 2, shield: 1, cargo: 4, utility: 3 }, cargoBase: 360, crewCap: 4,  price: 210000, agility: 0.65 },
  rescue:     { label: 'Rescue Cutter',baseMass: 19000, hullStrength: 800,  slots: { engine: 2, shield: 2, cargo: 2, utility: 3 }, cargoBase: 90,  crewCap: 5,  price: 195000, agility: 1.3 },
  passenger:  { label: 'Liner',        baseMass: 62000, hullStrength: 1800,  slots: { engine: 2, shield: 2, cargo: 3, utility: 3 }, cargoBase: 220, crewCap: 24, price: 380000, agility: 0.55 },
  luxury:     { label: 'Yacht',        baseMass: 26000, hullStrength: 1000,  slots: { engine: 2, shield: 2, cargo: 2, utility: 4 }, cargoBase: 120, crewCap: 8,  price: 640000, agility: 1.0 },
  military:   { label: 'Corvette',     baseMass: 34000, hullStrength: 2200,  slots: { engine: 2, shield: 3, cargo: 2, utility: 4 }, cargoBase: 110, crewCap: 8,  price: 720000, agility: 1.25 },
  expedition: { label: 'Expedition Ship', baseMass: 120000, hullStrength: 4000, slots: { engine: 3, shield: 3, cargo: 6, utility: 8 }, cargoBase: 900, crewCap: 16, price: 1850000, agility: 0.45 },
  colony:     { label: 'Colony Ship',  baseMass: 240000, hullStrength: 6000, slots: { engine: 4, shield: 3, cargo: 10, utility: 8 }, cargoBase: 2400, crewCap: 60, price: 4200000, agility: 0.3 },
};

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every module: mass in kg, power draw in units, and whatever stat it grants.
 * `bay` says which compartment you walk to in order to repair it (§27).
 */
export const MODULES = {
  // --- engines ---
  eng_basic:    { slot: 'engine', label: 'H-3 Ion Drive',      mass: 3200, power: 18, thrust: 260e3,  fuelBurn: 0.9,  bay: 'engine' },
  eng_fusion:   { slot: 'engine', label: 'Fusion Torch',       mass: 5400, power: 34, thrust: 720e3,  fuelBurn: 1.5,  bay: 'engine' },
  eng_pulse:    { slot: 'engine', label: 'Pulse Cascade',      mass: 4100, power: 44, thrust: 980e3,  fuelBurn: 2.3,  bay: 'engine' },
  eng_precursor:{ slot: 'engine', label: 'Vault Drive',        mass: 2600, power: 26, thrust: 1.85e6, fuelBurn: 0.7,  bay: 'engine', rare: true },
  // --- shields ---
  shd_basic:    { slot: 'shield', label: 'Deflector Mk I',     mass: 900,  power: 14, shield: 350,  regen: 6,  bay: 'technical' },
  shd_heavy:    { slot: 'shield', label: 'Bastion Array',      mass: 2200, power: 30, shield: 1400, regen: 11, bay: 'technical' },
  shd_adaptive: { slot: 'shield', label: 'Adaptive Lattice',   mass: 1400, power: 26, shield: 900,  regen: 24, bay: 'technical', rare: true },
  // --- cargo ---
  crg_standard: { slot: 'cargo',  label: 'Cargo Pod',          mass: 1200, power: 2,  cargo: 120, bay: 'cargo' },
  crg_expanded: { slot: 'cargo',  label: 'Expanded Hold',      mass: 1900, power: 3,  cargo: 240, bay: 'cargo' },
  crg_cryo:     { slot: 'cargo',  label: 'Cryo Hold',          mass: 2400, power: 12, cargo: 180, perishable: true, bay: 'cargo' },
  // --- utility ---
  util_scanner: { slot: 'utility', label: 'Survey Scanner',    mass: 600,  power: 12, scanRange: 4200,  scanQuality: 1.0, bay: 'technical' },
  util_deepscan:{ slot: 'utility', label: 'Deep Scan Array',   mass: 1100, power: 26, scanRange: 14000, scanQuality: 1.8, bay: 'technical' },
  util_lab:     { slot: 'utility', label: 'Research Lab',      mass: 2600, power: 30, research: 1.0, bay: 'lab' },
  util_medbay:  { slot: 'utility', label: 'Medical Bay',       mass: 1800, power: 18, medical: 1.0, bay: 'medical' },
  util_fabricator:{ slot: 'utility', label: 'Fabricator',      mass: 2100, power: 24, crafting: 1.0, bay: 'workshop' },
  util_fueltank:{ slot: 'utility', label: 'Auxiliary Tank',    mass: 800,  power: 1,  fuelCapacity: 400, bay: 'engine' },
  util_dronebay:{ slot: 'utility', label: 'Drone Bay',         mass: 1500, power: 16, drones: 2, bay: 'cargo' },
  util_lightbreak:{ slot: 'utility', label: 'Lightbreak Coil', mass: 3400, power: 55, lightbreak: 1.0, bay: 'engine' },
  util_cryopod: { slot: 'utility', label: 'Cryo Pods',         mass: 1600, power: 10, cryo: 4, bay: 'quarters' },
  util_refinery:{ slot: 'utility', label: 'Ore Refinery',      mass: 2800, power: 28, refining: 1.0, bay: 'workshop' },
  // --- weapons (utility slot) ---
  wpn_mining:   { slot: 'utility', label: 'Mining Laser',      mass: 700,  power: 20, weaponDamage: 14, mining: 1.0, bay: 'technical' },
  wpn_pulse:    { slot: 'utility', label: 'Pulse Cannon',      mass: 1100, power: 28, weaponDamage: 46, bay: 'technical' },
};

/** Overdrive (Nitro) parts — installed into the engine bay's overdrive slot. */
export const NITRO_PARTS = {
  nitro_basic:  { label: 'Overdrive Injector', mass: 400, boost: 2.4, charge: 12, rechargeS: 22, price: 38000 },
  nitro_race:   { label: 'Race Injector',      mass: 520, boost: 3.6, charge: 9,  rechargeS: 30, price: 96000 },
  nitro_sustain:{ label: 'Sustained Overdrive',mass: 700, boost: 2.1, charge: 30, rechargeS: 40, price: 145000 },
};

/** Ship compartments you can physically walk into (§26). */
export const SHIP_BAYS = ['cockpit', 'quarters', 'galley', 'lab', 'cargo', 'engine', 'technical', 'workshop', 'medical'];

/* ------------------------------------------------------------------ */
/* Ship                                                                */
/* ------------------------------------------------------------------ */

export class Ship {
  constructor(classId = 'explorer', opts = {}) {
    this.classId = classId;
    this.def = SHIP_CLASSES[classId] || SHIP_CLASSES.explorer;
    this.name = opts.name || shipName(opts.seed || 1);

    /** Installed modules, as arrays per slot type. */
    this.modules = opts.modules || this._defaultLoadout();

    /** The engine bay's overdrive slot — empty until you install Nitro (§29). */
    this.nitro = { part: null, charge: 0, active: false, installed: false };

    /** Lightbreak drive state (§30). */
    this.lightbreak = {
      charge: 0,           // 0..1
      engaged: false,
      speed: 0,            // m/s
      targetSpeed: 0,
      cooldown: 0,
    };

    this.fuel = 0;
    this.fuelCapacity = 0;
    this.shieldHp = 0;
    this.hullStrength = this.def.hullStrength || 900;
    this.hullHp = this.hullStrength;

    /** Per-subsystem condition 0..1. Damage breaks specific things (§27). */
    this.condition = {
      engine: 1, shield: 1, lifeSupport: 1, navigation: 1,
      scanner: 1, cargo: 1, lightbreak: 1, hull: 1,
    };

    /** Power allocation (§90). Values are relative weights, normalised. */
    this.power = {
      engines: 3, shields: 2, scanner: 1, weapons: 1, lab: 1, lightbreak: 1,
    };

    // Flight state, in the current reference frame (planet-space or system).
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.orientation = { yaw: 0, pitch: 0, roll: 0 };
    this.throttle = 0;
    this.landed = true;
    this.docked = null;

    this.autopilot = { active: false, target: null, mode: 'idle' };
    this.crew = [];
    this.warnings = [];

    this.recompute();
    this.fuel = this.fuelCapacity;
    this.shieldHp = this.stats.shield;
  }

  _defaultLoadout() {
    const s = this.def.slots;
    const m = { engine: [], shield: [], cargo: [], utility: [] };
    // Heavy hulls ship with engines proportionate to their mass — a stock
    // expedition ship on ion drives couldn't leave the ground it starts on.
    const stockEngine = this.def.baseMass > 90000 ? 'eng_pulse'
      : this.def.baseMass > 20000 ? 'eng_fusion' : 'eng_basic';
    for (let i = 0; i < s.engine; i++) m.engine.push(stockEngine);
    for (let i = 0; i < s.shield; i++) m.shield.push('shd_basic');
    for (let i = 0; i < s.cargo; i++) m.cargo.push('crg_standard');
    const util = ['util_scanner', 'util_fueltank', 'wpn_mining', 'util_lab', 'util_medbay', 'util_fabricator', 'util_dronebay', 'util_cryopod'];
    for (let i = 0; i < s.utility; i++) m.utility.push(util[i] || 'util_fueltank');
    return m;
  }

  /** Recompute derived stats from installed modules. Call after any refit. */
  recompute() {
    const st = {
      mass: this.def.baseMass,
      thrust: 0, fuelBurn: 0, fuelCapacity: 200,
      shield: 0, shieldRegen: 0, cargo: this.def.cargoBase,
      scanRange: 0, scanQuality: 0, research: 0, medical: 0,
      crafting: 0, refining: 0, drones: 0, cryo: 0,
      weaponDamage: 0, mining: 0, lightbreak: 0,
      powerDraw: 0, powerOutput: 60 + this.def.baseMass / 900,
    };

    for (const list of Object.values(this.modules)) {
      for (const id of list) {
        const m = MODULES[id];
        if (!m) continue;
        st.mass += m.mass;
        st.powerDraw += m.power || 0;
        for (const k of ['thrust', 'fuelBurn', 'shield', 'cargo', 'scanRange', 'research', 'medical',
                         'crafting', 'refining', 'drones', 'cryo', 'weaponDamage', 'mining',
                         'lightbreak', 'fuelCapacity']) {
          if (m[k]) st[k] += m[k];
        }
        if (m.regen) st.shieldRegen += m.regen;
        if (m.scanQuality) st.scanQuality = Math.max(st.scanQuality, m.scanQuality);
      }
    }

    if (this.nitro.part) {
      st.mass += NITRO_PARTS[this.nitro.part].mass;
    }
    st.mass += this.cargoMass || 0;

    // Condition degrades output: a damaged engine really is weaker.
    st.thrust *= 0.25 + this.condition.engine * 0.75;
    st.shield *= this.condition.shield;
    st.scanRange *= 0.3 + this.condition.scanner * 0.7;

    this.stats = st;
    this.fuelCapacity = st.fuelCapacity;
    this.fuel = Math.min(this.fuel, this.fuelCapacity);
    return st;
  }

  /** Acceleration in m/s^2 at full throttle, before overdrive. */
  maxAcceleration() {
    return this.stats.thrust / Math.max(1, this.stats.mass);
  }

  /** Can this ship lift off from a planet of this gravity? */
  canLaunch(gravity) {
    return this.maxAcceleration() > gravity * 1.05;
  }

  /* ---------------------------------------------------------------- */
  /* Power management (§90)                                            */
  /* ---------------------------------------------------------------- */

  /** Fraction of requested power each system actually receives. */
  powerDistribution() {
    const total = Object.values(this.power).reduce((a, b) => a + b, 0) || 1;
    const available = this.stats.powerOutput * this.condition.hull;
    const demand = this.stats.powerDraw;
    const ratio = Math.min(1, available / Math.max(1, demand));
    const out = {};
    for (const [k, v] of Object.entries(this.power)) {
      // A system's share of the (possibly insufficient) supply.
      out[k] = Math.min(1.5, (v / total) * Object.keys(this.power).length * ratio);
    }
    return out;
  }

  setPower(system, value) {
    if (this.power[system] === undefined) return false;
    this.power[system] = Math.max(0, Math.min(10, value));
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Nitro / Overdrive (§29)                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Physically install an overdrive part into the engine bay.
   * The player has to be *in* the engine bay to call this — the UI enforces
   * SHIP -> TECHNICAL BAY -> ENGINE COMPARTMENT -> NITRO SLOT -> INSTALL.
   */
  installNitro(partId) {
    if (!NITRO_PARTS[partId]) return { ok: false, reason: 'unknown_part' };
    if (this.nitro.part) return { ok: false, reason: 'slot_occupied' };
    this.nitro.part = partId;
    this.nitro.installed = true;
    this.nitro.charge = NITRO_PARTS[partId].charge;
    this.recompute();
    return { ok: true, part: NITRO_PARTS[partId] };
  }

  removeNitro() {
    const had = this.nitro.part;
    this.nitro = { part: null, charge: 0, active: false, installed: false };
    this.recompute();
    return had;
  }

  /** Minimum charge fraction before overdrive will engage. */
  static NITRO_ARM_FRACTION = 0.35;

  get nitroReady() {
    if (!this.nitro.part) return false;
    const cap = NITRO_PARTS[this.nitro.part].charge;
    // Threshold is a fraction of capacity. As an absolute 0.5 units it meant a
    // 12-unit injector reported "ready" after one second of recharging.
    return this.nitro.charge >= cap * Ship.NITRO_ARM_FRACTION && this.condition.engine > 0.3;
  }

  /** Engage overdrive. Returns false if there's nothing installed to engage. */
  engageNitro(on = true) {
    if (!this.nitro.part) return false;
    if (on && !this.nitroReady) return false;
    this.nitro.active = !!on;
    return true;
  }

  /** Current thrust multiplier from overdrive. */
  nitroMultiplier() {
    if (!this.nitro.active || !this.nitro.part || this.nitro.charge <= 0) return 1;
    return NITRO_PARTS[this.nitro.part].boost;
  }

  /* ---------------------------------------------------------------- */
  /* Lightbreak (§30)                                                  */
  /* ---------------------------------------------------------------- */

  get hasLightbreak() {
    return this.stats.lightbreak > 0;
  }

  /** Top Lightbreak velocity, scaled by coil count and condition. */
  lightbreakTopSpeed() {
    if (!this.hasLightbreak) return 0;
    return C * Math.min(1.2, 0.35 * this.stats.lightbreak) * (0.4 + this.condition.lightbreak * 0.6);
  }

  /**
   * Charge the drive. Requires power allocated to `lightbreak` and is much
   * faster with more coils. Returns true once fully charged.
   */
  chargeLightbreak(dt, powerShare = 1) {
    if (!this.hasLightbreak) return false;
    if (this.lightbreak.cooldown > 0) {
      this.lightbreak.cooldown = Math.max(0, this.lightbreak.cooldown - dt);
      return false;
    }
    const rate = 0.055 * this.stats.lightbreak * Math.max(0.15, powerShare) * this.condition.lightbreak;
    this.lightbreak.charge = Math.min(1, this.lightbreak.charge + rate * dt);
    return this.lightbreak.charge >= 1;
  }

  get lightbreakReady() {
    return this.hasLightbreak && this.lightbreak.charge >= 1 && this.lightbreak.cooldown <= 0;
  }

  /** Engage superspeed. Only valid away from a gravity well. */
  engageLightbreak() {
    if (!this.lightbreakReady) return { ok: false, reason: 'not_charged' };
    if (this.landed || this.docked) return { ok: false, reason: 'not_in_flight' };
    this.lightbreak.engaged = true;
    this.lightbreak.targetSpeed = this.lightbreakTopSpeed();
    return { ok: true };
  }

  disengageLightbreak() {
    if (!this.lightbreak.engaged) return false;
    this.lightbreak.engaged = false;
    this.lightbreak.targetSpeed = 0;
    this.lightbreak.charge = 0;
    this.lightbreak.cooldown = 8;
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Flight                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Step the ship.
   * @param {number} dt seconds
   * @param {object} input {throttle, pitch, yaw, roll, nitro, lightbreak}
   * @param {object} env {gravity, gravityDir, atmosphere, timeScale}
   */
  update(dt, input = {}, env = {}) {
    dt = Math.min(dt, 0.25);
    this.warnings.length = 0;
    const power = this.powerDistribution();

    /* --- orientation --- */
    const agility = this.def.agility * (0.3 + this.condition.navigation * 0.7)
      * Math.min(1.4, power.engines);
    this.orientation.yaw += (input.yaw || 0) * agility * 1.4 * dt;
    this.orientation.pitch += (input.pitch || 0) * agility * 1.2 * dt;
    this.orientation.roll += (input.roll || 0) * agility * 2.0 * dt;
    this.orientation.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.orientation.pitch));

    /* --- overdrive --- */
    if (input.nitro !== undefined) this.engageNitro(input.nitro);
    if (this.nitro.part) {
      const def = NITRO_PARTS[this.nitro.part];
      if (this.nitro.active && this.throttle > 0.05) {
        this.nitro.charge = Math.max(0, this.nitro.charge - dt);
        if (this.nitro.charge <= 0) {
          this.nitro.active = false;
          this.warnings.push('OVERDRIVE DEPLETED');
        }
      } else {
        this.nitro.charge = Math.min(def.charge, this.nitro.charge + (def.charge / def.rechargeS) * dt);
      }
    }

    /* --- lightbreak --- */
    if (input.chargeLightbreak) this.chargeLightbreak(dt, power.lightbreak);
    if (input.lightbreak === true && !this.lightbreak.engaged) this.engageLightbreak();
    if (input.lightbreak === false && this.lightbreak.engaged) this.disengageLightbreak();
    if (this.lightbreak.cooldown > 0 && !this.lightbreak.engaged) {
      this.lightbreak.cooldown = Math.max(0, this.lightbreak.cooldown - dt);
    }

    if (this.lightbreak.engaged) {
      // Ramp toward top speed; the ramp is what makes the star-streak build.
      const ramp = this.lightbreakTopSpeed() / 6;
      this.lightbreak.speed = Math.min(this.lightbreak.targetSpeed, this.lightbreak.speed + ramp * dt);
      // Sustained superspeed drains the drive; it cannot be held forever.
      this.lightbreak.charge = Math.max(0, this.lightbreak.charge - 0.014 * dt);
      if (this.lightbreak.charge <= 0) {
        this.disengageLightbreak();
        this.warnings.push('LIGHTBREAK COLLAPSE');
      }
      if (env.gravity && env.gravity > 0.6) {
        this.disengageLightbreak();
        this.warnings.push('MASS SHADOW — LIGHTBREAK ABORTED');
      }
    } else if (this.lightbreak.speed > 0) {
      this.lightbreak.speed = Math.max(0, this.lightbreak.speed - this.lightbreakTopSpeed() * dt);
    }

    /* --- thrust --- */
    this.throttle = Math.max(0, Math.min(1, input.throttle ?? this.throttle));
    const engineHealth = this.condition.engine;
    if (engineHealth < 0.35) this.warnings.push('ENGINE DAMAGE');

    let thrust = this.stats.thrust * this.throttle * this.nitroMultiplier()
      * Math.min(1.3, power.engines);

    // Fuel
    const burn = this.stats.fuelBurn * this.throttle * this.nitroMultiplier() * dt;
    if (this.fuel <= 0) {
      thrust = 0;
      this.warnings.push('NO FUEL');
    } else {
      this.fuel = Math.max(0, this.fuel - burn);
      if (this.fuel / this.fuelCapacity < 0.15) this.warnings.push('FUEL LOW');
    }

    const accel = thrust / Math.max(1, this.stats.mass);
    const dir = this.forward();

    this.vel.x += dir.x * accel * dt;
    this.vel.y += dir.y * accel * dt;
    this.vel.z += dir.z * accel * dt;

    // Gravity
    if (env.gravity && env.gravityDir) {
      this.vel.x += env.gravityDir.x * env.gravity * dt;
      this.vel.y += env.gravityDir.y * env.gravity * dt;
      this.vel.z += env.gravityDir.z * env.gravity * dt;
    }

    // Atmospheric drag — thick air really does hold you back on ascent.
    if (env.atmosphere > 0.02) {
      const speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
      if (speed > 0) {
        const drag = 0.5 * env.atmosphere * speed * speed * 0.9 / Math.max(1, this.stats.mass);
        const f = Math.max(0, 1 - (drag * dt) / Math.max(1, speed));
        this.vel.x *= f; this.vel.y *= f; this.vel.z *= f;
      }
    }

    // Lightbreak overrides normal velocity with a straight-line superspeed run.
    if (this.lightbreak.speed > 1000) {
      this.vel = { x: dir.x * this.lightbreak.speed, y: dir.y * this.lightbreak.speed, z: dir.z * this.lightbreak.speed };
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    /* --- shields, life support --- */
    const shieldPower = Math.min(1.4, power.shields);
    if (this.shieldHp < this.stats.shield) {
      this.shieldHp = Math.min(this.stats.shield, this.shieldHp + this.stats.shieldRegen * shieldPower * dt);
    }
    if (this.condition.lifeSupport < 0.4) this.warnings.push('LIFE SUPPORT FAILING');
    if (this.condition.hull < 0.35) this.warnings.push('HULL BREACH');
  }

  /** Unit forward vector from the orientation angles. */
  forward() {
    const { yaw, pitch } = this.orientation;
    const cp = Math.cos(pitch);
    return { x: Math.sin(yaw) * cp, y: Math.sin(pitch), z: Math.cos(yaw) * cp };
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  /* ---------------------------------------------------------------- */
  /* Damage and repair (§27)                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Apply damage. Shields soak first; anything through them hits the hull and
   * has a chance to break a specific subsystem, which is what sends the player
   * into the technical bay with a repair kit.
   */
  applyDamage(amount, seed = Math.floor(Math.random() * 1e9)) {
    const broken = [];
    let remaining = amount;
    if (this.shieldHp > 0) {
      const absorbed = Math.min(this.shieldHp, remaining);
      this.shieldHp -= absorbed;
      remaining -= absorbed;
    }
    if (remaining <= 0) return { hullDamage: 0, broken };

    this.hullHp = Math.max(0, this.hullHp - remaining);
    this.condition.hull = this.hullHp / this.hullStrength;

    /*
     * Subsystem damage is proportional to how much of *this hull* the hit
     * represents, and each system is hit at most once. Scaling by a flat
     * constant meant a single large impact zeroed every system on the ship
     * simultaneously, which is a game over disguised as a repair job.
     */
    const rng = new RNG(hashInts(seed, Math.floor(remaining)));
    const systems = rng.shuffle(Object.keys(this.condition).filter((k) => k !== 'hull'));
    const severity = Math.min(1, remaining / (this.hullStrength * 0.55));
    const hits = Math.max(1, Math.min(systems.length, Math.round(severity * 3.5)));
    for (let i = 0; i < hits; i++) {
      const sys = systems[i];
      const loss = Math.min(this.condition[sys], rng.range(0.15, 0.55) * (0.4 + severity));
      this.condition[sys] = Math.max(0, this.condition[sys] - loss);
      if (this.condition[sys] < 0.5) broken.push(sys);
    }
    this.recompute();
    return { hullDamage: remaining, broken };
  }

  /** Systems that need attention, for the repair panel. */
  damagedSystems() {
    return Object.entries(this.condition)
      .filter(([, v]) => v < 0.98)
      .map(([k, v]) => ({
        system: k,
        condition: +v.toFixed(2),
        bay: BAY_FOR_SYSTEM[k] || 'technical',
        severity: v < 0.35 ? 'critical' : v < 0.7 ? 'major' : 'minor',
      }))
      .sort((a, b) => a.condition - b.condition);
  }

  /**
   * Repair one subsystem. Consumes repair parts; returns how many were used.
   * Repairs are per-system and require being in the right bay, so a breakdown
   * means physically walking to the fault (§27).
   */
  repair(system, partsAvailable = 1) {
    if (this.condition[system] === undefined) return { ok: false, reason: 'unknown_system' };
    if (this.condition[system] >= 1) return { ok: false, reason: 'not_damaged' };
    const missing = 1 - this.condition[system];
    const partsNeeded = Math.max(1, Math.ceil(missing * 3));
    const partsUsed = Math.min(partsAvailable, partsNeeded);
    if (partsUsed <= 0) return { ok: false, reason: 'no_parts' };
    const restored = (partsUsed / partsNeeded) * missing;
    this.condition[system] = Math.min(1, this.condition[system] + restored);
    if (system === 'hull') this.hullHp = this.condition.hull * this.hullStrength;
    this.recompute();
    return { ok: true, partsUsed, condition: this.condition[system] };
  }

  refuel(units = Infinity) {
    const before = this.fuel;
    this.fuel = Math.min(this.fuelCapacity, this.fuel + units);
    return this.fuel - before;
  }

  /* ---------------------------------------------------------------- */
  /* Refit                                                             */
  /* ---------------------------------------------------------------- */

  installModule(slot, index, moduleId) {
    const m = MODULES[moduleId];
    if (!m || m.slot !== slot) return { ok: false, reason: 'wrong_slot' };
    if (!this.modules[slot] || index >= this.def.slots[slot]) return { ok: false, reason: 'no_such_slot' };
    const removed = this.modules[slot][index];
    this.modules[slot][index] = moduleId;
    this.recompute();
    return { ok: true, removed };
  }

  save() {
    return {
      classId: this.classId, name: this.name, modules: this.modules,
      nitro: this.nitro, lightbreak: this.lightbreak, fuel: this.fuel,
      shieldHp: this.shieldHp, hullHp: this.hullHp, condition: this.condition,
      power: this.power, pos: this.pos, vel: this.vel,
      orientation: this.orientation, landed: this.landed, crew: this.crew,
    };
  }

  static load(d) {
    if (!d) return new Ship();
    const s = new Ship(d.classId, { name: d.name, modules: d.modules });
    Object.assign(s, {
      nitro: d.nitro || s.nitro,
      lightbreak: d.lightbreak || s.lightbreak,
      fuel: d.fuel ?? s.fuel,
      shieldHp: d.shieldHp ?? s.shieldHp,
      hullHp: d.hullHp ?? s.hullStrength,
      condition: d.condition || s.condition,
      power: d.power || s.power,
      pos: d.pos || s.pos, vel: d.vel || s.vel,
      orientation: d.orientation || s.orientation,
      landed: d.landed ?? true,
      crew: d.crew || [],
    });
    s.recompute();
    return s;
  }
}

/** Which compartment houses each subsystem, for the repair walk (§27). */
export const BAY_FOR_SYSTEM = {
  engine: 'engine',
  shield: 'technical',
  lifeSupport: 'technical',
  navigation: 'cockpit',
  scanner: 'technical',
  cargo: 'cargo',
  lightbreak: 'engine',
  hull: 'technical',
};
