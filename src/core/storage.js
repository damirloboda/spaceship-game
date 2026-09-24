// localStorage can be missing or throw (private mode, sandboxed frames).
// Everything goes through here and degrades to an in-memory map.
const memory = new Map();

function ls() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const k = '__uc_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

let backend;

export const storage = {
  get(key) {
    if (backend === undefined) backend = ls();
    try {
      if (backend) return backend.getItem(key);
    } catch { /* fall through */ }
    return memory.has(key) ? memory.get(key) : null;
  },
  set(key, value) {
    if (backend === undefined) backend = ls();
    memory.set(key, value);
    try {
      if (backend) backend.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    memory.delete(key);
    try { backend?.removeItem(key); } catch { /* ignore */ }
  },
  persistent() {
    if (backend === undefined) backend = ls();
    return !!backend;
  },
};
