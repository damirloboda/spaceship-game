// Slot-based inventory with stack limits. Used for the suit, ship cargo,
// base storage and expedition storage.
import { itemDef } from './items.js';

export class Inventory {
  constructor(slots = 24, stackMultiplier = 1) {
    this.slots = slots;
    this.stackMultiplier = stackMultiplier;
    this.items = []; // [{id, n}]
  }

  stackLimit(id) {
    return Math.max(1, Math.floor(itemDef(id).stack * this.stackMultiplier));
  }

  count(id) {
    let n = 0;
    for (const s of this.items) if (s.id === id) n += s.n;
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  freeSlots() {
    return this.slots - this.items.length;
  }

  // Returns how many could not be added.
  add(id, n = 1) {
    if (n <= 0) return 0;
    const limit = this.stackLimit(id);
    let left = n;
    for (const s of this.items) {
      if (s.id !== id || s.n >= limit) continue;
      const take = Math.min(limit - s.n, left);
      s.n += take;
      left -= take;
      if (!left) return 0;
    }
    while (left > 0 && this.items.length < this.slots) {
      const take = Math.min(limit, left);
      this.items.push({ id, n: take });
      left -= take;
    }
    return left;
  }

  canAdd(id, n = 1) {
    const limit = this.stackLimit(id);
    let room = 0;
    for (const s of this.items) if (s.id === id) room += limit - s.n;
    room += this.freeSlots() * limit;
    return room >= n;
  }

  remove(id, n = 1) {
    if (!this.has(id, n)) return false;
    let left = n;
    for (let i = this.items.length - 1; i >= 0 && left > 0; i--) {
      const s = this.items[i];
      if (s.id !== id) continue;
      const take = Math.min(s.n, left);
      s.n -= take;
      left -= take;
      if (s.n === 0) this.items.splice(i, 1);
    }
    return true;
  }

  // Move up to n of an item into another inventory; returns moved count.
  transfer(id, n, target) {
    const available = Math.min(n, this.count(id));
    if (!available) return 0;
    const left = target.add(id, available);
    const moved = available - left;
    this.remove(id, moved);
    return moved;
  }

  toJSON() {
    return { slots: this.slots, stackMultiplier: this.stackMultiplier, items: this.items.map((s) => ({ ...s })) };
  }

  static fromJSON(data, fallbackSlots = 24) {
    const inv = new Inventory(data?.slots || fallbackSlots, data?.stackMultiplier || 1);
    for (const s of data?.items || []) {
      if (s && typeof s.id === 'string' && Number.isFinite(s.n) && s.n > 0) inv.add(s.id, Math.floor(s.n));
    }
    return inv;
  }
}
