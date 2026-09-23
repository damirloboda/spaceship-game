// Packs assets/models/*.glb into a few base64 JSON chunks plus models.json,
// for static hosts that refuse to serve .glb files (the loader falls back to
// these). Usage: node tools/pack-models-bundle.mjs <outDir> [chunkMB]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const [out, mb = '4'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const limit = Number(mb) * 1024 * 1024;
const files = readdirSync('assets/models').filter((f) => f.endsWith('.glb')).sort();
const index = { files: {} };
let chunk = {}, size = 0, n = 0;
const flush = () => { if (!size) return; writeFileSync(join(out, `models-${n}.json`), JSON.stringify(chunk)); n++; chunk = {}; size = 0; };
for (const f of files) {
  const b64 = readFileSync(join('assets/models', f)).toString('base64');
  if (size + b64.length > limit) flush();
  const name = f.replace(/\.glb$/, '');
  chunk[name] = b64;
  size += b64.length;
  index.files[name] = `models-${n}.json`;
}
flush();
writeFileSync(join(out, 'models.json'), JSON.stringify(index));
console.log(`${files.length} models in ${n} chunks`);
