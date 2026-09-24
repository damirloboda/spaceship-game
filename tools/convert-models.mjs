// Converts Quaternius CC0 FBX models to compact GLB files with three.js
// (FBXLoader -> GLTFExporter) inside headless Chromium.
// Usage: node tools/convert-models.mjs <srcDir> <outDir> <name1,name2,...>
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [srcDir, outDir, list] = process.argv.slice(2);
const ROOT = resolve('.');
const srv = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    try {
      let f;
      if (url.startsWith('/src/')) f = join(resolve(srcDir), url.slice(5));
      else if (url.startsWith('/three/')) f = join(ROOT, 'node_modules/three', url.slice(7));
      else if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>'); return; }
      const d = await readFile(f);
      res.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  });
  s.listen(0, () => ok(s));
});
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('page:', m.text()); });
await page.goto(`http://localhost:${srv.address().port}/`);
await mkdir(outDir, { recursive: true });
for (const name of list.split(',')) {
  const r = await page.evaluate(async (name) => {
    const THREE = await import('three');
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const obj = await new FBXLoader().loadAsync(`/src/${name}.fbx`);
    // Monster packs ship a palette texture next to the FBX that the file does not reference.
    let palette = null;
    const tex = await fetch(`/src/${name}_Texture.png`);
    if (tex.ok) {
      const img = await createImageBitmap(await tex.blob(), { imageOrientation: 'flipY' });
      palette = new THREE.Texture(img);
      palette.colorSpace = THREE.SRGBColorSpace;
      palette.flipY = false;
      palette.needsUpdate = true;
    }
    // Phong -> Standard so the exporter keeps colours and maps.
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const conv = (m) => {
        // FBXLoader treats the (already linear) diffuse as sRGB; undo that once.
        const color = m.color.clone().convertLinearToSRGB();
        const map = m.map || palette;
        const s = new THREE.MeshStandardMaterial({ name: m.name, color: map ? new THREE.Color(1, 1, 1) : color, map: map || null, roughness: 0.8, metalness: 0, vertexColors: m.vertexColors, side: m.side });
        if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.01) s.emissive = m.emissive;
        return s;
      };
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
    });
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const glb = await new GLTFExporter().parseAsync(obj, { binary: true, animations: obj.animations, onlyVisible: true });
    const bytes = new Uint8Array(glb);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), anims: obj.animations.map((a) => a.name), size: size.toArray().map((v) => +v.toFixed(2)) };
  }, name).catch((e) => ({ error: e.message }));
  if (r.error) { console.log('FAIL', name, r.error); continue; }
  const buf = Buffer.from(r.b64, 'base64');
  await writeFile(join(outDir, `${name.replace(/\s+/g, '_')}.glb`), buf);
  console.log(name, (buf.length / 1024).toFixed(0) + 'KB', 'size', r.size, 'anims', r.anims.join(' '));
}
await browser.close();
srv.close();
