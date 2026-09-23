// Renders a contact sheet of GLB models: node tools/preview-models.mjs out.png name1,name2,...
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [out, list] = process.argv.slice(2);
const ROOT = resolve('.');
const srv = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    try {
      if (url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<body style="margin:0"><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>'); return; }
      const f = join(ROOT, url);
      const d = await readFile(f);
      res.writeHead(200, { 'content-type': extname(f) === '.js' ? 'text/javascript' : 'application/octet-stream' });
      res.end(d);
    } catch { res.writeHead(404); res.end(); }
  });
  s.listen(0, () => ok(s));
});
const names = list.split(',');
const cols = Math.min(6, names.length), rows = Math.ceil(names.length / cols);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: cols * 260, height: rows * 260 } });
page.on('console', (m) => console.log('page:', m.text()));
await page.goto(`http://localhost:${srv.address().port}/`);
await page.evaluate(async ({ names, cols, rows, side, anim }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(cols * 260, rows * 260);
  r.setScissorTest(true);
  r.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(r.domElement);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (let i = 0; i < names.length; i++) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x283040);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2), new THREE.DirectionalLight(0xffffff, 2).translateX(3).translateY(5).translateZ(4));
    try {
      const g = await loader.loadAsync(`/assets/models/${names[i]}.glb`);
      let o = g.scene;
      if (anim) {
        const { clone } = await import('three/addons/utils/SkeletonUtils.js');
        o = clone(g.scene);
        const clip = g.animations.find((a) => /walk/i.test(a.name)) || g.animations[0];
        if (clip) { const mx = new THREE.AnimationMixer(o); mx.clipAction(clip).play(); mx.update(0.4); }
      }
      const box = new THREE.Box3().setFromObject(g.scene);
      if (anim) { o.updateMatrixWorld(true); console.log(names[i], 'static', JSON.stringify(box.getSize(new THREE.Vector3())), 'posed', JSON.stringify(new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3()))); }
      const size = box.getSize(new THREE.Vector3()).length();
      const c = box.getCenter(new THREE.Vector3());
      o.position.sub(c);
      scene.add(o);
      const cam = new THREE.PerspectiveCamera(40, 1, size / 100, size * 10);
      cam.position.set(size * 0.8, size * 0.5, size * 0.9);
      if (side) {
        // Side view from +X with a red arrow along +Z to check model facing.
        cam.position.set(size * 1.4, size * 0.2, 0);
        scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -box.getSize(new THREE.Vector3()).y * 0.5, 0), size * 0.6, 0xff0000));
      }
      cam.lookAt(0, 0, 0);
      const x = (i % cols) * 260, y = (rows - 1 - Math.floor(i / cols)) * 260;
      r.setViewport(x, y, 260, 260); r.setScissor(x, y, 260, 260);
      r.render(scene, cam);
    } catch (e) { console.log(names[i], e.message); }
  }
  const lab = document.createElement('div');
  lab.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:grid;grid-template-columns:repeat(' + cols + ',260px);font:12px sans-serif;color:#fff';
  lab.innerHTML = names.map((n) => `<div style="height:260px;padding:4px">${n}</div>`).join('');
  document.body.appendChild(lab);
}, { names, cols, rows, side: !!process.env.SIDE, anim: !!process.env.ANIM });
await page.screenshot({ path: out });
await browser.close();
srv.close();
