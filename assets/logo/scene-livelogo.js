import * as THREE from './three.module.js';

// LIVE LOGO — the silhouette is held by a signed distance field, the matter
// inside it never stops moving. Born from one point, then permanently alive.
//
//  logo svg -> raster -> alpha mask -> chamfer distance transform -> SDF+gradient texture
//  sim: curl/attractor flow  ->  if outside the shape, SDF pushes the grain back in

const SIM = /* glsl */`
uniform sampler2D uPrev, uTarget, uSDF;
uniform float uDelta, uTime, uMorph, uFlow, uSwirl, uHold, uField, uSlab, uChurn, uExpand;
varying vec2 vUv;

float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

// --- simplex noise (Ashima) ---
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute( permute( permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 snoiseVec3(vec3 x){ return vec3(snoise(x), snoise(x + 19.19), snoise(x - 33.71)); }
vec3 curlNoise(vec3 p){
  const float e = 0.09;
  vec3 dx = vec3(e,0.,0.), dy = vec3(0.,e,0.), dz = vec3(0.,0.,e);
  vec3 px0 = snoiseVec3(p-dx), px1 = snoiseVec3(p+dx);
  vec3 py0 = snoiseVec3(p-dy), py1 = snoiseVec3(p+dy);
  vec3 pz0 = snoiseVec3(p-dz), pz1 = snoiseVec3(p+dz);
  float x = (py1.z-py0.z) - (pz1.y-pz0.y);
  float y = (pz1.x-pz0.x) - (px1.z-px0.z);
  float z = (px1.y-px0.y) - (py1.x-py0.x);
  return normalize(vec3(x,y,z) / (2.0*e));
}
vec3 thomas(vec3 p, float b){ return vec3(sin(p.y)-b*p.x, sin(p.z)-b*p.y, sin(p.x)-b*p.z); }

void main(){
  vec4 prev = texture2D(uPrev, vUv);
  vec4 tgt  = texture2D(uTarget, vUv);
  vec3 p = prev.xyz;
  float life = prev.w;
  float seed = tgt.w;

  // ---- assembly (only matters at birth / re-form)
  float m = clamp((uMorph * 1.75) - seed * 0.75, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);

  // ---- SDF is sampled at the grain's OWN target, not at its current position:
  // stable per grain, so there is no medial-axis jitter and no rails.
  // Texture row 0 is the TOP of the raster, world +y is up -> v is flipped.
  vec2 uv = vec2(tgt.x * 0.5 + 0.5, 0.5 - tgt.y * 0.5);
  vec4 s = texture2D(uSDF, clamp(uv, 0.002, 0.998));
  float d = s.r - 0.5;                        // >0 outside, <0 inside
  float depth = max(0.0, -d);                 // 0 at the rim, grows toward the core

  // ---- ANCHORED MODE: the grain breathes around its own point of the silhouette.
  // Amplitude is gated by depth, so rim grains barely move and the edge stays razor-sharp
  // while the interior boils. The shape cannot leak — it is not held by a force, it is
  // held by construction.
  float amp = uFlow * (0.04 + smoothstep(0.0, 0.10, depth) * 0.55);
  vec3 off = curlNoise(vec3(tgt.xy * 2.7, uTime * 0.11) + seed * 4.0) * amp;
  off.xy += vec2(-tgt.y, tgt.x) * uSwirl * 0.05 * sin(uTime * 0.45 + seed * 6.283);
  off.z = off.z * (0.3 + uSlab * 1.7) + (seed - 0.5) * 0.06 * uSlab;
  vec3 anchored = vec3(tgt.xy + off.xy, off.z);

  // ---- FREE MODE: pure field, the same cosmic drift as the attractor lab
  vec3 field = mix(
    curlNoise(p * 2.2 + vec3(0.0, 0.0, uTime * 0.10)),
    thomas(p * 5.2, 0.145 + seed * 0.05) * 0.9,
    uField
  );
  field += vec3(-p.y, p.x, 0.0) * uSwirl;
  // anchored pull and free drift are applied SEPARATELY. Lerping toward a "free"
  // position that is itself one step away damps the motion by the lerp factor —
  // that is what made the dissolve phase look like it never left the silhouette.
  float k = 1.0 - exp(-uDelta * 8.5);
  p = mix(p, anchored, uHold * k * mix(1.0, 1.15, m));
  p += field * uDelta * uFlow * 6.0 * (1.0 - uHold);
  // curl noise is DIVERGENCE-FREE: it swirls but conserves volume, so on its own the
  // grains curdle in place instead of dispersing. Dispersal needs an explicit
  // divergent term — outward push plus a per-grain random heading.
  vec3 rnd = normalize(vec3(seed - 0.5, fract(seed * 7.31) - 0.5, fract(seed * 13.77) - 0.5) + 1e-5);
  vec3 out_ = normalize(p + rnd * 0.35 + 1e-5);
  p += out_ * uExpand * uDelta * (1.0 - uHold);

  // ---- assembly spring (only bites during birth / re-form)
  p += (tgt.xyz - p) * (1.0 - exp(-uDelta * 7.0)) * m * (1.0 - uHold * 0.9);

  p.z = clamp(p.z, -0.24, 0.24);

  // ---- churn: recycle a slow trickle so the interior keeps boiling
  life -= uDelta * uChurn * (0.05 + seed * 0.12);
  if (life <= 0.0) { p = tgt.xyz + vec3(0.0, 0.0, (seed - 0.5) * 0.1); life = 1.0; }

  gl_FragColor = vec4(p, life);
}`;

// ---------- CPU: raster -> alpha -> chamfer SDF + gradient ----------
function rasterize(url, res) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = res;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, res, res);
      resolve(ctx.getImageData(0, 0, res, res).data);
    };
    img.onerror = reject;
    img.src = url;
  });
}

function chamfer(d, res) {
  const D1 = 1, D2 = 1.41421356;
  const at = (x, y) => (x < 0 || y < 0 || x >= res || y >= res) ? 1e9 : d[y * res + x];
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    let v = d[y * res + x];
    v = Math.min(v, at(x - 1, y) + D1, at(x, y - 1) + D1, at(x - 1, y - 1) + D2, at(x + 1, y - 1) + D2);
    d[y * res + x] = v;
  }
  for (let y = res - 1; y >= 0; y--) for (let x = res - 1; x >= 0; x--) {
    let v = d[y * res + x];
    v = Math.min(v, at(x + 1, y) + D1, at(x, y + 1) + D1, at(x + 1, y + 1) + D2, at(x - 1, y + 1) + D2);
    d[y * res + x] = v;
  }
}

function buildSDF(alpha, res, threshold) {
  const n = res * res;
  const inside = new Uint8Array(n);
  const din = new Float32Array(n), dout = new Float32Array(n);
  // HYPOTHESIS B: seed the transform from ANTI-ALIASED coverage, not from a binary mask.
  // A field seeded from a binary raster is exact with respect to the raster's staircase —
  // no amount of resolution or filtering removes that. A boundary texel that is 30%
  // covered sits 0.2 texels inside the true edge, and that is what we seed.
  for (let i = 0; i < n; i++) {
    const cov = alpha[i * 4 + 3] / 255;
    inside[i] = cov > threshold / 255 ? 1 : 0;
    if (cov >= 0.996) { din[i] = 0; dout[i] = 1e9; }
    else if (cov <= 0.004) { din[i] = 1e9; dout[i] = 0; }
    else {
      const d = 0.5 - cov;                 // >0 = the texel centre lies outside the edge
      din[i] = Math.max(0, d);             // sub-texel seed: distance to the ink
      dout[i] = Math.max(0, -d);           // sub-texel seed: distance to the paper
    }
  }
  chamfer(din, res); chamfer(dout, res);

  const sdf = new Float32Array(n);
  const px2world = 2 / res;
  for (let i = 0; i < n; i++) {
    const cov = alpha[i * 4 + 3] / 255;
    sdf[i] = (cov >= 0.5 ? -dout[i] : din[i]) * px2world;
  }

  // encode: R = sdf + 0.5 (world units, clamped to ±0.5), GB = unit gradient
  const data = new Uint8Array(n * 4);
  const S = (x, y) => sdf[Math.min(res - 1, Math.max(0, y)) * res + Math.min(res - 1, Math.max(0, x))];
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const i = y * res + x;
      let gx = (S(x + 1, y) - S(x - 1, y)) * 0.5;
      let gy = (S(x, y + 1) - S(x, y - 1)) * 0.5;
      const l = Math.hypot(gx, gy) || 1;
      gx /= l; gy /= l;
      data[i * 4 + 0] = Math.max(0, Math.min(255, Math.round((sdf[i] + 0.5) * 255)));
      data[i * 4 + 1] = Math.round((gx * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round((-gy * 0.5 + 0.5) * 255); // texture y is flipped vs world y
      // A = the SAME distance re-encoded over a narrow band (±0.08 world units).
      // 8 bits over ±0.5 quantises the edge to ~3 screen px; over ±0.08 it is ~0.25 px,
      // which is what makes the solid edge read as vector rather than stepped.
      data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((sdf[i] / 0.08 * 0.5 + 0.5) * 255)));
    }
  }
  return { data, inside };
}

export async function mountLiveLogo(el, opts = {}) {
  const SIZE = opts.size || 128;
  const N = SIZE * SIZE;
  const RES = opts.res || 256;
  const THRESH = opts.threshold ?? 80;

  const alpha = await rasterize(opts.logo || './assets/favicon-light.svg', RES);
  const { data: sdfData, inside } = buildSDF(alpha, RES, THRESH);

  const sdfTex = new THREE.DataTexture(sdfData, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  sdfTex.minFilter = sdfTex.magFilter = THREE.LinearFilter;
  sdfTex.wrapS = sdfTex.wrapT = THREE.ClampToEdgeWrapping;
  sdfTex.needsUpdate = true;

  // target points = every inside pixel, shuffled
  const pts = [];
  for (let y = 0; y < RES; y++) for (let x = 0; x < RES; x++) {
    if (inside[y * RES + x]) pts.push([(x / (RES - 1) - 0.5) * 2, -(y / (RES - 1) - 0.5) * 2]);
  }
  for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }

  const fit = opts.fit || 0.94;
  const target = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const p = pts[(i * 7919) % pts.length];
    target[i * 4 + 0] = p[0] * fit;
    target[i * 4 + 1] = p[1] * fit;
    target[i * 4 + 2] = (Math.random() - 0.5) * 0.12;
    target[i * 4 + 3] = Math.random();
  }
  const targetTex = new THREE.DataTexture(target, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
  targetTex.needsUpdate = true;

  const seedData = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.283, r = Math.random() * 0.010;
    seedData[i * 4 + 0] = Math.cos(a) * r;
    seedData[i * 4 + 1] = Math.sin(a) * r;
    seedData[i * 4 + 2] = 0;
    seedData[i * 4 + 3] = 0.2 + Math.random() * 0.8;
  }
  const seedTex = new THREE.DataTexture(seedData, SIZE, SIZE, THREE.RGBAFormat, THREE.FloatType);
  seedTex.needsUpdate = true;

  // antialias must be ON: the vector-geometry edge is rasterised on the default
  // framebuffer, and MSAA is what makes it a clean vector edge
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, opts.dprCap || 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';

  const rtOpts = {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false,
  };
  let rtA = new THREE.WebGLRenderTarget(SIZE, SIZE, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(SIZE, SIZE, rtOpts);

  const P = Object.assign({
    flow: 0.16, swirl: 0.35, hold: 1.0, field: 0.0, slab: 0.0, churn: 0.6,
    pointSize: 2.0, glow: 1.0,
  }, opts.params || {});

  const simU = {
    uPrev: { value: null }, uTarget: { value: targetTex }, uSDF: { value: sdfTex },
    uDelta: { value: 1 / 60 }, uTime: { value: 0 }, uMorph: { value: 0 },
    uFlow: { value: P.flow }, uSwirl: { value: P.swirl }, uHold: { value: P.hold },
    uField: { value: P.field }, uSlab: { value: P.slab }, uChurn: { value: P.churn },
    uExpand: { value: P.expand ?? 0.55 },
  };

  const qScene = new THREE.Scene();
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simMat = new THREE.ShaderMaterial({
    uniforms: simU,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
    fragmentShader: SIM, depthTest: false, depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat);
  quad.frustumCulled = false;
  qScene.add(quad);

  const copyMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: seedTex } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
    fragmentShader: `uniform sampler2D uTex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(uTex, vUv); }`,
    depthTest: false, depthWrite: false,
  });
  function reseed() {
    quad.material = copyMat;
    for (const rt of [rtA, rtB]) { renderer.setRenderTarget(rt); renderer.render(qScene, qCam); }
    renderer.setRenderTarget(null);
    quad.material = simMat;
  }
  reseed();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);
  camera.position.set(0, 0, 4.6);

  const geo = new THREE.BufferGeometry();
  const ref = new Float32Array(N * 2), pos = new Float32Array(N * 3), rnd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    ref[i * 2] = ((i % SIZE) + 0.5) / SIZE;
    ref[i * 2 + 1] = (Math.floor(i / SIZE) + 0.5) / SIZE;
    rnd[i] = Math.random();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('reference', new THREE.BufferAttribute(ref, 2));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(rnd, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPos: { value: rtA.texture },
      uTargetTex: { value: targetTex },
      uSDFTex: { value: sdfTex },
      uClip: { value: 0 },
      uFitV: { value: fit },
      uHeat: { value: P.heat ?? 0.8 },
      uDensity: { value: P.density ?? 1.0 },
      uDpr: { value: renderer.getPixelRatio() },
      uInk: { value: 0 },
      uAmber: { value: new THREE.Color(0xffc247) },
      uCream: { value: new THREE.Color(0xf2f0eb) },
      uInkColor: { value: new THREE.Color(0x2c2620) },
      uSize: { value: P.pointSize },
      uGlow: { value: P.glow },
    },
    vertexShader: /* glsl */`
      uniform sampler2D uPos, uTargetTex, uSDFTex; uniform float uDpr, uSize, uClip, uFitV;
      attribute vec2 reference; attribute float aRandom;
      varying float vRnd, vZ, vLife, vDisp, vKeep;
      void main(){
        vec4 d = texture2D(uPos, reference);
        vec4 tg = texture2D(uTargetTex, reference);
        vec4 mv = modelViewMatrix * vec4(d.xyz, 1.0);
        gl_Position = projectionMatrix * mv;
        vRnd = aRandom; vZ = d.z; vLife = d.w;
        // how far this grain has wandered off its anchor -> "speed" without a velocity buffer
        vDisp = clamp(length(d.xy - tg.xy) * 3.2, 0.0, 1.0);
        // once the mark is solid, grains outside the silhouette are dirt on the edge:
        // clip them against the same distance field that defines the contour
        vec2 suv = vec2((d.x / uFitV) * 0.5 + 0.5, 0.5 - (d.y / uFitV) * 0.5);
        float sd = (texture2D(uSDFTex, clamp(suv, 0.002, 0.998)).a - 0.5) * 2.0 * 0.08;
        vKeep = mix(1.0, smoothstep(0.012, -0.004, sd), uClip);
        gl_PointSize = uSize * uDpr * (0.7 + aRandom * 0.6) * (1.0 + d.z * 0.8);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform float uInk, uGlow, uHeat, uDensity; uniform vec3 uAmber, uInkColor, uCream;
      varying float vRnd, vZ, vLife, vDisp, vKeep;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float r = length(q);
        float a = smoothstep(0.5, 0.06, r);
        float fade = smoothstep(0.0, 0.18, vLife) * smoothstep(1.0, 0.85, vLife);
        // DARK: cream is the mass. On a #0c0c0b page cream carries ~1.5x the luminance
        // of amber, so the mark reads at a glance; amber stays as the warm undertone
        // of the settled cores. Displacement shifts HUE, it never drops value —
        // dropping value is what made the dissolve phase disappear on dark.
        vec3 core = mix(uAmber, uCream, 0.70);
        vec3 mass = mix(uAmber, uCream, 0.95);
        vec3 warm = mix(core, mass, clamp(vDisp * uHeat, 0.0, 1.0));
        warm *= 0.85 + vRnd * 0.30;
        warm *= 1.0 + vZ * 0.55;
        vec3 col = mix(warm * uGlow, uInkColor, uInk);
        // dispersal compensation: a spread-out swarm accumulates less overlap, so the
        // dissolved state used to thin out to nothing. Give the wandering grains more ink.
        // Dark only (uInk=0): light theme is already right, do not touch it.
        float alpha = a * fade * mix(0.040, 0.14, uInk) * uDensity * vKeep * mix(1.0 + vDisp * 0.55, 1.0, uInk);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true, depthWrite: false, depthTest: false,
    premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // ---- TRAILS: the frame is not cleared, it decays. This is what turns
  // "dots flying near each other" into something that flows.
  const trailOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false };
  let trA = new THREE.WebGLRenderTarget(1, 1, trailOpts);
  let trB = new THREE.WebGLRenderTarget(1, 1, trailOpts);
  const FSV = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`;
  const fadeMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null }, uFade: { value: 0 } },
    vertexShader: FSV,
    fragmentShader: `uniform sampler2D uTex; uniform float uFade; varying vec2 vUv;
      void main(){ gl_FragColor = texture2D(uTex, vUv) * uFade; }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const blitMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null } },
    vertexShader: FSV,
    fragmentShader: `uniform sampler2D uTex; varying vec2 vUv;
      void main(){ gl_FragColor = texture2D(uTex, vUv); }`,
    depthTest: false, depthWrite: false, transparent: true, premultipliedAlpha: true,
    blending: THREE.AdditiveBlending,
  });
  const fsScene = new THREE.Scene();
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fadeMat);
  fsQuad.frustumCulled = false;
  fsScene.add(fsQuad);
  renderer.autoClear = false;

  // ---- SOLIDIFY: no second asset, no crossfade.
  // The edge comes from the distance field (mathematically sharp at any size).
  // The FILL is driven by where the grains actually are: alpha = edge * coverage.
  // As the swarm converges, the mark hardens from the inside out.
  const densOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false };
  const densRT = new THREE.WebGLRenderTarget(1, 1, densOpts);
  const densRT2 = new THREE.WebGLRenderTarget(1, 1, densOpts);
  // the density field must be blurred before thresholding, otherwise the cutoff
  // catches the gaps BETWEEN grains and the fill comes out mottled
  const densBlur = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        float s = texture2D(uTex, vUv).r * 0.227027;
        s += (texture2D(uTex, vUv + uDir * 1.3846).r + texture2D(uTex, vUv - uDir * 1.3846).r) * 0.316216;
        s += (texture2D(uTex, vUv + uDir * 3.2308).r + texture2D(uTex, vUv - uDir * 3.2308).r) * 0.070270;
        gl_FragColor = vec4(s);
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending,
  });
  const blobMat = new THREE.ShaderMaterial({
    uniforms: { uPos: { value: null }, uDpr: { value: 1 }, uSize: { value: 10 } },
    vertexShader: /* glsl */`
      uniform sampler2D uPos; uniform float uDpr, uSize;
      attribute vec2 reference; attribute float aRandom;
      void main(){
        vec4 d = texture2D(uPos, reference);
        vec4 mv = modelViewMatrix * vec4(d.xyz, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * uDpr;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      void main(){
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float c = clamp(1.0 - r, 0.0, 1.0);
        gl_FragColor = vec4(c * c * 0.16);
      }`,
    // three's AdditiveBlending is srcAlpha*src + dst — for a density buffer that squares
    // the contribution and it collapses to zero. Density needs ONE + ONE.
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const blobPoints = new THREE.Points(geo, blobMat);
  blobPoints.frustumCulled = false;
  const blobScene = new THREE.Scene();
  blobScene.add(blobPoints);

  const solidMat = new THREE.ShaderMaterial({
    uniforms: {
      uSDF: { value: sdfTex }, uDens: { value: densRT.texture },
      uInkColor: { value: new THREE.Color(0x26211c) },
      uSolid: { value: 0 }, uEdgeW: { value: 0.004 },
      uView: { value: new THREE.Vector2(1, 1) },
      uMark: { value: new THREE.Vector3(0, 0, 1) },   // x, y, scale
      uFit: { value: fit },                           // the raster box maps to [-fit, fit]
      uMsdf: { value: null }, uPxRange: { value: 16 }, uBoxPx: { value: 512 },
      uMode: { value: 0 },                            // 0 = distance field, 1 = msdf
      // coverage ramp, measured against the real accumulated density (not guessed):
      // the buffer runs ~0.02–0.25, so a 0.22–0.75 window never fired at all
      uCov: { value: new THREE.Vector2(0.30, 1.30) },
    },
    vertexShader: FSV,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uSDF, uDens, uMsdf;
      uniform vec3 uInkColor; uniform float uSolid, uEdgeW, uFit, uPxRange, uBoxPx, uMode;
      uniform vec2 uView, uCov; uniform vec3 uMark;
      varying vec2 vUv;
      float median(float r, float g, float b){ return max(min(r, g), min(max(r, g), b)); }
      void main(){
        if (uSolid <= 0.001) discard;
        vec2 world = (vUv - 0.5) * uView;                 // screen -> world
        vec2 p = (world - uMark.xy) / max(uMark.z, 1e-5); // undo the mark transform
        p /= uFit;                                        // ...and the raster box scale
        vec2 uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

        float edge;
        if (uMode > 0.5) {
          // MSDF: coverage is analytic. The median of the three channels survives corners
          // that a single-channel field rounds off.
          vec3 msd = texture2D(uMsdf, uv).rgb;
          float sd = median(msd.r, msd.g, msd.b);
          float screenPxRange = max(uPxRange * (uBoxPx / 1024.0), 1.0);
          edge = clamp(screenPxRange * (sd - 0.5) + 0.5, 0.0, 1.0);
        } else {
          float d = (texture2D(uSDF, uv).a - 0.5) * 2.0 * 0.08 * uMark.z * uFit;
          edge = smoothstep(uEdgeW, -uEdgeW, d);
        }

        float cov = smoothstep(uCov.x, uCov.y, texture2D(uDens, vUv).r);
        float a = edge * cov * uSolid;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uInkColor, a);
      }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.NormalBlending,
  });

  // ---- HYPOTHESIS A: the solid mark as REAL GEOMETRY.
  // The contour is rasterised by the GPU from the actual bezier path, so there is no
  // field, no quantisation and no staircase — the edge quality is MSAA, i.e. vector.
  let vecMesh = null, vecScene = null;
  const vecMat = new THREE.ShaderMaterial({
    uniforms: {
      uDens: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
      uCov: { value: new THREE.Vector2(0.30, 1.30) }, uSolid: { value: 0 },
      uInk: { value: new THREE.Color(0x26211c) },
    },
    vertexShader: `void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D uDens; uniform vec2 uRes, uCov; uniform float uSolid; uniform vec3 uInk;
      void main(){
        float cov = smoothstep(uCov.x, uCov.y, texture2D(uDens, gl_FragCoord.xy / uRes).r);
        float a = cov * uSolid;
        if (a <= 0.002) discard;
        gl_FragColor = vec4(uInk, a);
      }`,
    transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });

  // HYPOTHESIS C: MSDF baked offline by msdfgen from the same SVG.
  // Coverage is analytic in the shader, so it is crisp at any size AND survives being
  // rendered into an offscreen target (unlike geometry, whose edge is MSAA).
  if (opts.msdf !== false) {
    const t = new THREE.TextureLoader().load(opts.msdfUrl || './logo-msdf.png');
    t.colorSpace = THREE.NoColorSpace;        // an MSDF must never be colour-converted
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    // PNG textures are flipped on upload by default; the DataTexture field is not.
    // Both must agree with the uv mapping, so turn the flip off.
    t.flipY = false;
    solidMat.uniforms.uMsdf.value = t;
  }

  // (the geometry route is not shipped: the MSDF edge is sharper and survives render targets)

  function syncTheme() {
    const light = document.documentElement.dataset.theme === 'light';
    mat.uniforms.uInk.value = light ? 1 : 0;
    solidMat.uniforms.uInkColor.value.set(light ? 0x26211c : 0xf2f0eb);
    mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    blitMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    mat.needsUpdate = true;
    blitMat.needsUpdate = true;
  }
  syncTheme();
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // grain must scale with the canvas: the same constant that reads as dust at 560px
  // reads as a smudge at 52px. Keep coverage constant instead of keeping size constant.
  let grainScale = 1, markScale = 1, fitScale = 1;
  const eff = () => fitScale * markScale;            // framing × flight = what actually ships
  function applyScale() { points.scale.setScalar(eff()); }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    mat.uniforms.uDpr.value = renderer.getPixelRatio();

    // ONE framing multiplier, derived instead of tuned: the perspective camera frames by
    // HEIGHT, so on a portrait viewport a roughly square mark runs off the sides. Solve it
    // once — the mark always occupies `cover` of min(width, height), which also guarantees
    // the margin around it on any screen.
    const halfHv = Math.tan((camera.fov / 2) * Math.PI / 180) * camera.position.z;
    fitScale = (opts.cover ?? 0.8) * Math.min(w, h) * halfHv / (fit * h);
    applyScale();
    grainScale = opts.grainAuto === false ? 1 : Math.min(w, h) / Math.sqrt(N) / 3.5;
    const dpr = renderer.getPixelRatio();
    trA.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
    trB.setSize(Math.max(1, Math.floor(w * dpr)), Math.max(1, Math.floor(h * dpr)));
    densRT.setSize(Math.max(1, Math.floor(w * dpr * 0.5)), Math.max(1, Math.floor(h * dpr * 0.5)));
    densRT2.setSize(densRT.width, densRT.height);
    const halfH = Math.tan((camera.fov / 2) * Math.PI / 180) * camera.position.z;
    solidMat.uniforms.uView.value.set(halfH * 2 * (w / h), halfH * 2);
    solidMat.uniforms.uEdgeW.value = (halfH * 2) / h;      // one CSS pixel, in world units
  }
  resize();
  addEventListener('resize', resize);

  let t = 0, born = 0, raf = 0, visible = true, tilt = 0, cyclePhase = 'logo';
  let solidLevel = opts.solid ?? 0;
  let edgeMode = opts.edge || 'geo';        // 'geo' = real geometry, 'sdf' = distance field
  const BIRTH = opts.birthDur || 1.6;
  function step(dt) {
    t += dt;
    born = Math.min(1, born + dt / BIRTH);
    simU.uMorph.value = born < 1 ? born : 1;
    simU.uTime.value = t;
    simU.uDelta.value = Math.min(dt, 1 / 30);
    // auto-cycle: mark -> dissolves into the attractor -> resolves back into the mark.
    // This is the "transformation" state; uHold is the axis between the two worlds.
    let holdNow = P.hold;
    if (opts.cycle) {
      const C = Object.assign({ logo: 3.2, dissolve: 1.6, chaos: 2.4, reform: 1.9 }, opts.cycle);
      const total = C.logo + C.dissolve + C.chaos + C.reform;
      const ct = (t - (opts.cycleDelay || 0)) % total;
      const ez = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
      if (t < (opts.cycleDelay || 0)) holdNow = P.hold;
      else if (ct < C.logo) holdNow = 1;
      else if (ct < C.logo + C.dissolve) holdNow = 1 - ez((ct - C.logo) / C.dissolve);
      else if (ct < C.logo + C.dissolve + C.chaos) holdNow = 0;
      else holdNow = ez((ct - C.logo - C.dissolve - C.chaos) / C.reform);
      cyclePhase = ct < C.logo ? 'logo' : ct < C.logo + C.dissolve ? 'dissolve'
        : ct < C.logo + C.dissolve + C.chaos ? 'chaos' : 'reform';
    }
    // the free state needs more energy than the anchored one, or chaos looks sleepy
    simU.uFlow.value = P.flow * (1 + (1 - holdNow) * 1.6) * (born < 1 ? 0.25 + born * 0.75 : 1);
    simU.uSwirl.value = P.swirl;
    simU.uHold.value = holdNow * born;
    simU.uField.value = P.field;
    simU.uSlab.value = P.slab;
    simU.uExpand.value = P.expand ?? 0.55;
    simU.uChurn.value = P.churn * born;
    // floor at ~1.35 css px: below that a grain is sub-pixel, additive alpha stops
    // accumulating and the mark goes ghostly instead of getting finer
    mat.uniforms.uSize.value = Math.min(5.0, Math.max(1.35, P.pointSize * grainScale * eff()));
    mat.uniforms.uGlow.value = P.glow;

    simU.uPrev.value = rtA.texture;
    renderer.setRenderTarget(rtB);
    renderer.render(qScene, qCam);
    renderer.setRenderTarget(null);
    const s = rtA; rtA = rtB; rtB = s;
    mat.uniforms.uPos.value = rtA.texture;

    mat.uniforms.uHeat.value = P.heat ?? 0.8;
    mat.uniforms.uDensity.value = P.density ?? 1.0;
    mat.uniforms.uClip.value = solidLevel;

    tilt = Math.sin(t * 0.32) * (opts.tilt ?? 0.10);
    points.rotation.y = tilt;
    points.rotation.x = Math.cos(t * 0.24) * (opts.tilt ?? 0.10) * 0.5;

    // decay the previous frame, draw the grains on top of what is left, then blit
    fadeMat.uniforms.uTex.value = trA.texture;
    fadeMat.uniforms.uFade.value = P.trail ?? 0;
    fsQuad.material = fadeMat;
    renderer.setRenderTarget(trB);
    renderer.clear();
    renderer.render(fsScene, qCam);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.clear();
    fsQuad.material = blitMat;
    blitMat.uniforms.uTex.value = trB.texture;
    renderer.render(fsScene, qCam);
    const sw = trA; trA = trB; trB = sw;

    // solidify pass: density of the grains decides where the mark has hardened
    if (solidLevel > 0.001) {
      blobMat.uniforms.uPos.value = mat.uniforms.uPos.value;
      blobMat.uniforms.uDpr.value = renderer.getPixelRatio() * 0.5;
      blobMat.uniforms.uSize.value = (opts.blobSize || 14) * eff();
      blobPoints.rotation.copy(points.rotation);
      blobPoints.scale.copy(points.scale);
      blobPoints.position.copy(points.position);
      renderer.setRenderTarget(densRT);
      renderer.clear();
      renderer.render(blobScene, camera);
      // two separable blur passes, ~5 px at half res = ~10 px at display res
      const dw = densRT.width, dh = densRT.height;
      fsQuad.material = densBlur;
      densBlur.uniforms.uTex.value = densRT.texture;
      densBlur.uniforms.uDir.value.set(1.6 / dw, 0);
      renderer.setRenderTarget(densRT2);
      renderer.clear();
      renderer.render(fsScene, qCam);
      densBlur.uniforms.uTex.value = densRT2.texture;
      densBlur.uniforms.uDir.value.set(0, 1.6 / dh);
      renderer.setRenderTarget(densRT);
      renderer.clear();
      renderer.render(fsScene, qCam);
      renderer.setRenderTarget(null);
      if (vecMesh && edgeMode === 'geo') {
        // real geometry: same transform as the grains, drawn straight to the canvas
        vecMesh.scale.copy(points.scale);
        vecMesh.position.copy(points.position);
        vecMesh.rotation.copy(points.rotation);
        vecMat.uniforms.uDens.value = densRT.texture;
        vecMat.uniforms.uSolid.value = solidLevel;
        vecMat.uniforms.uCov.value.copy(solidMat.uniforms.uCov.value);
        vecMat.uniforms.uInk.value.copy(solidMat.uniforms.uInkColor.value);
        renderer.getDrawingBufferSize(vecMat.uniforms.uRes.value);
        renderer.render(vecScene, camera);
      } else {
        solidMat.uniforms.uSolid.value = solidLevel;
        solidMat.uniforms.uMode.value = edgeMode === 'msdf' ? 1 : 0;
        solidMat.uniforms.uMark.value.set(points.position.x, points.position.y, eff());
        // how many screen pixels the mark's own 1024-unit box currently spans —
        // msdfgen's AA needs this, and it must never fall below ~2 px of range
        const hH = Math.tan((camera.fov / 2) * Math.PI / 180) * camera.position.z;
        solidMat.uniforms.uBoxPx.value = ((2 * fit * eff()) / (2 * hH)) * el.clientHeight;
        fsQuad.material = solidMat;
        renderer.render(fsScene, qCam);
      }
    }
  }

  let last = 0;
  function frame(now) {
    raf = 0;
    const dt = Math.min((now - last) / 1000 || 1 / 60, 1 / 20);
    last = now;
    step(dt);
    kick();
  }
  function kick() {
    const run = visible && !document.hidden;
    if (run && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  document.addEventListener('visibilitychange', kick);
  step(0);
  kick();

  return {
    params: P,
    sampled: pts.length,
    camera,
    // visual-only transform: the simulation is untouched, so the flight cannot
    // disturb the mark's internal life
    setTransform(scale, x, y) {
      markScale = scale;
      applyScale();
      points.position.set(x, y, 0);
    },
    setSolid(v) { solidLevel = v; },
    setEdgeMode(m) { edgeMode = m; },
    get edgeMode() { return edgeMode; },
    get hasVector() { return !!vecMesh; },
    // move the same canvas into a new container and re-fit — used to hand the
    // full-screen intro over to its slot without ever creating a second object
    // Reparenting resizes the canvas, which drops the trail/density buffers. If we wait
    // for the next frame the compositor shows one empty canvas — that is the blink.
    // Draw synchronously inside the same task, twice, so the trail buffer is primed
    // before anything is composited.
    reparent(newEl) {
      el = newEl;
      newEl.appendChild(renderer.domElement);
      resize();
      step(0);
      step(1 / 60);
    },
    enableCycle(c) {
      opts.cycle = c || { logo: 3.2, dissolve: 1.7, chaos: 2.6, reform: 2.0 };
      opts.cycleDelay = t;
    },
    get solid() { return solidLevel; },
    setInk(hex) { solidMat.uniforms.uInkColor.value.set(hex); },
    setCoverage(a, b) { solidMat.uniforms.uCov.value.set(a, b); },
    get born() { return born; },
    stepManual(n = 60, dt = 1 / 60) { for (let i = 0; i < n; i++) step(dt); return { t: +t.toFixed(2), phase: cyclePhase, hold: +simU.uHold.value.toFixed(2) }; },
    get phase() { return cyclePhase; },
    replay() { reseed(); born = 0; t = 0; kick(); },
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); rtA.dispose(); rtB.dispose(); },
  };
}
