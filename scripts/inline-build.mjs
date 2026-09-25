// Собирает dist/ в один самодостаточный HTML (JS и CSS внутри) — для хостинга одним файлом.
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');
const assets = readdirSync(join(dist, 'assets'));
for (const f of assets) {
  const p = join(dist, 'assets', f);
  if (f.endsWith('.css')) {
    const css = readFileSync(p, 'utf8');
    html = html.replace(new RegExp(`<link[^>]*href="[^"]*${f}"[^>]*>`), `<style>${css}</style>`);
  } else if (f.endsWith('.js')) {
    const js = readFileSync(p, 'utf8').replace(/<\/script>/g, '<\\/script>');
    html = html.replace(new RegExp(`<script[^>]*src="[^"]*${f}"[^>]*></script>`), `<script type="module">${js}</script>`);
  }
}
writeFileSync(join(dist, 'roy.html'), html);
console.log('dist/roy.html', (html.length / 1024).toFixed(0), 'KB');
