// Error logging with a ring buffer and a guard that disables a failing subsystem
// instead of crashing the whole game.
const MAX = 200;
const entries = [];
const failures = new Map();
let listener = null;

export const log = {
  info(...args) { push('info', args); },
  warn(...args) { push('warn', args); console.warn(...args); },
  error(...args) { push('error', args); console.error(...args); },
  entries() { return entries.slice(); },
  onError(fn) { listener = fn; },
};

function push(level, args) {
  const msg = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack || ''}` : typeof a === 'object' ? safeJson(a) : String(a))).join(' ');
  entries.push({ t: Date.now(), level, msg });
  if (entries.length > MAX) entries.shift();
  if (level === 'error' && listener) {
    try { listener(msg); } catch { /* ignore */ }
  }
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Runs fn; after `limit` consecutive failures the subsystem is switched off.
export function guard(name, fn, limit = 5) {
  const rec = failures.get(name) || { count: 0, disabled: false };
  failures.set(name, rec);
  if (rec.disabled) return undefined;
  try {
    const r = fn();
    rec.count = 0;
    return r;
  } catch (err) {
    rec.count++;
    log.error(`[${name}]`, err);
    if (rec.count >= limit) {
      rec.disabled = true;
      log.error(`[${name}] disabled after repeated failures (safe fallback)`);
    }
    return undefined;
  }
}

export function guardStatus() {
  return [...failures.entries()].map(([name, r]) => ({ name, ...r }));
}
