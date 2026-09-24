// Tiny DOM helper.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function fmtDistance(m) {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} M`;
  const km = m / 1000;
  if (km < 100) return `${km.toFixed(1)} KM`;
  return `${Math.round(km).toLocaleString('en-US')} KM`;
}

export function fmtSpeed(v) {
  if (v < 1000) return `${Math.round(v)} M/S`;
  return `${(v / 1000).toFixed(v < 10000 ? 2 : 0)} KM/S`;
}

export function bar(pct, cls = '') {
  const b = h('div', { class: `bar ${cls}` }, h('i'));
  b.firstChild.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  return b;
}
