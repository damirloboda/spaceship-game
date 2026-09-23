// Image-based lighting. A tiny environment scene (sky gradient or the galaxy,
// plus the sun) is prefiltered with PMREM every few seconds so metal hulls,
// glass and water reflect the world they are in.
import * as THREE from 'three';

export class Environment {
  constructor(renderer, galaxyTexture, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.galaxy = galaxyTexture;
    this.skyUniforms = {
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uZenith: { value: new THREE.Color(0.2, 0.4, 0.9) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 1.0) },
      uGround: { value: new THREE.Color(0.2, 0.25, 0.15) },
      uSpace: { value: 0 },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uUp; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform float uSpace; varying vec3 vDir;
        void main(){ float h = dot(normalize(vDir), uUp);
          vec3 c = h > 0.0 ? mix(uHorizon, uZenith, pow(h, 0.5)) : mix(uHorizon * 0.7, uGround, pow(-h, 0.35));
          gl_FragColor = vec4(c * (1.0 - uSpace), 1.0 - uSpace); }`,
      transparent: true,
    }));
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.85).multiplyScalar(40) }));
    this.envScene.add(this.sky, this.sun);
    this.timer = 0;
    this.current = null;
    this.lastKey = '';
  }

  // state: { inAtmo, up, zenith, horizon, ground, sunDir, daylight }
  update(dt, state, force = false) {
    this.timer -= dt;
    if (!force && this.timer > 0) return;
    this.timer = 2;
    const s = state;
    const u = this.skyUniforms;
    if (s.inAtmo) {
      this.envScene.background = null;
      u.uSpace.value = 0;
      u.uUp.value.copy(s.up);
      u.uZenith.value.copy(s.zenith);
      u.uHorizon.value.copy(s.horizon);
      u.uGround.value.copy(s.ground);
      this.sky.visible = true;
    } else {
      this.envScene.background = this.galaxy;
      this.envScene.backgroundIntensity = 2.5;
      this.sky.visible = false;
    }
    this.sun.position.copy(s.sunDir).multiplyScalar(60);
    this.sun.material.color.setRGB(1, 0.95, 0.85).multiplyScalar(s.inAtmo ? 30 * Math.max(0.05, s.daylight) : 40);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    if (this.current) this.current.dispose();
    this.current = rt;
    this.scene.environment = rt.texture;
  }
}
