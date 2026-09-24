// Jetpack simulation: fuel, heat and thrust. The thrust is an acceleration in
// m/s^2 along the local up vector, so on heavy worlds a basic pack struggles.
export const JETPACK_MODELS = {
  basic: { thrust: 21, lateral: 7, fuelCapacity: 100, burnRate: 11, heatRate: 22, coolRate: 30, overheatAt: 100, recoverAt: 35 },
  mk2: { thrust: 30, lateral: 11, fuelCapacity: 160, burnRate: 10, heatRate: 16, coolRate: 38, overheatAt: 100, recoverAt: 30 },
};

export const JET_FUEL_PER_CANISTER = 60;

export class Jetpack {
  constructor(model = 'basic') {
    this.setModel(model);
    this.owned = false;
    this.fuel = this.spec.fuelCapacity;
    this.heat = 0;
    this.overheated = false;
    this.active = false;
  }

  setModel(model) {
    this.model = JETPACK_MODELS[model] ? model : 'basic';
    this.spec = JETPACK_MODELS[this.model];
    if (this.fuel > this.spec.fuelCapacity) this.fuel = this.spec.fuelCapacity;
  }

  // wantThrust: bool. airDensity scales efficiency slightly (thin air helps
  // cooling less). Returns vertical acceleration and lateral authority.
  update(dt, wantThrust, gravity = 9.8, airDensity = 1) {
    const s = this.spec;
    this.active = false;
    if (!this.owned) return { accel: 0, lateral: 0, active: false };
    if (this.overheated && this.heat <= s.recoverAt) this.overheated = false;
    const canFire = wantThrust && !this.overheated && this.fuel > 0;
    if (canFire) {
      this.active = true;
      this.fuel = Math.max(0, this.fuel - s.burnRate * dt);
      this.heat = Math.min(s.overheatAt, this.heat + s.heatRate * dt * (1.2 - Math.min(airDensity, 1) * 0.2));
      if (this.heat >= s.overheatAt) this.overheated = true;
      return { accel: s.thrust, lateral: s.lateral, active: true, net: s.thrust - gravity };
    }
    this.heat = Math.max(0, this.heat - s.coolRate * dt * (0.6 + Math.min(airDensity, 1) * 0.4));
    return { accel: 0, lateral: 0, active: false, net: -gravity };
  }

  canLift(gravity) {
    return this.spec.thrust > gravity;
  }

  refuel(amount) {
    const before = this.fuel;
    this.fuel = Math.min(this.spec.fuelCapacity, this.fuel + amount);
    return this.fuel - before;
  }

  get fuelPct() {
    return this.fuel / this.spec.fuelCapacity;
  }

  get heatPct() {
    return this.heat / this.spec.overheatAt;
  }

  toJSON() {
    return { model: this.model, owned: this.owned, fuel: this.fuel, heat: 0 };
  }

  static fromJSON(d) {
    const j = new Jetpack(d?.model || 'basic');
    j.owned = !!d?.owned;
    j.fuel = Number.isFinite(d?.fuel) ? Math.min(d.fuel, j.spec.fuelCapacity) : j.spec.fuelCapacity;
    return j;
  }
}
