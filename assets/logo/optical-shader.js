import * as THREE from './three.module.js';

// Precomputed from the original SVG; no million-pixel distance transform on
// visitors' CPUs. RG is numerical data, never colour-managed or flipped.
export async function logoDistanceTexture(signal) {
  const response = await fetch(new URL('./logo-distance.png', import.meta.url), { signal });
  if (!response.ok) throw new Error(`Logo field: ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Logo field could not be decoded'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
  if (signal?.aborted) throw new Error('Logo startup cancelled');
  const texture = new THREE.Texture(image);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export function opticalMaterial(distance, jelly, grab) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDistance: { value: distance }, uJelly: jelly, uGrab: grab,
      uRotation: { value: new THREE.Matrix3() }, uInverse: { value: new THREE.Matrix3() },
      uResolution: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 }, uLight: { value: 0 },
    },
    depthTest: false, depthWrite: false,
    extensions: { derivatives: true },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
    `,
    fragmentShader: /* glsl */`
      precision highp float;
      varying vec2 vUv;
      uniform highp sampler2D uDistance;
      uniform mat3 uRotation, uInverse;
      uniform vec3 uJelly;
      uniform vec2 uGrab, uResolution;
      uniform float uAspect, uLight;
      const float EPS = 0.00065;
      const float IOR = 1.49;

      vec3 unbend(vec3 p) {
        float local = exp(-dot(p.xy - uGrab, p.xy - uGrab) * 2.2);
        p.x /= 1.0 + uJelly.y * 0.11;
        p.y /= 1.0 - uJelly.y * 0.10;
        p.x -= uJelly.x * (0.2 + (p.y + 1.1) * 0.22 + local * 0.3);
        p.y -= uJelly.y * (0.35 + local * 0.4);
        p.z -= uJelly.z * sin(p.y * 2.5 + p.x * 1.6) * 0.38;
        return p;
      }
      float outline(vec2 p) {
        // Same padded domain as the SVG distance texture.
        vec2 uv = vec2(p.x / 2.3 + 0.5, 0.5 - p.y / 2.3);
        vec2 rg = texture2D(uDistance, clamp(uv, 0., 1.)).rg;
        float d = ((rg.r * 256. + rg.g) / 257. - 0.5) * 4.;
        return d + length(max(abs(p) - 1.15, 0.));
      }
      float field(vec3 point) {
        vec3 p = unbend(point);
        float d = outline(p.xy);
        // Rounded extrusion with a gently crowned lens face. The actual 2D
        // silhouette is the zero contour even at the sharp original tips.
        float crown = 0.08 * (1. - 0.65 * p.x * p.x - 0.4 * p.y * p.y);
        vec2 q = vec2(d + 0.09, abs(p.z) - (0.14 + crown) + 0.09);
        return min(max(q.x, q.y), 0.) + length(max(q, 0.)) - 0.09;
      }
      vec3 surfaceNormal(vec3 p) {
        // Broader than one mask texel to suppress contour stair-stepping in
        // specular reflections, while the intersection itself remains precise.
        // Filter the normal over the pixel footprint at low resolutions.
        // This suppresses unstable subpixel highlights without blurring the silhouette.
        vec2 e = vec2(max(0.012, 4.5 / uResolution.y), 0.);
        return normalize(vec3(field(p + e.xyy) - field(p - e.xyy),
          field(p + e.yxy) - field(p - e.yxy), field(p + e.yyx) - field(p - e.yyx)));
      }
      float primaryHit(vec3 origin, vec3 direction, out float clearance) {
        clearance = 1e3;
        float b = dot(origin, direction), h = b * b - dot(origin, origin) + 1.65 * 1.65;
        if (h < 0.) return -1.;
        float t = max(0., -b - sqrt(h)), far = -b + sqrt(h);
        for (int j = 0; j < 90; j++) {
          float d = field(origin + direction * t);
          clearance = min(clearance, d / max(t, 0.001));
          if (d < EPS) return t;
          t += max(d * 0.82, EPS * 0.5);
          if (t > far) break;
        }
        return -1.;
      }
      float exitHit(vec3 origin, vec3 direction) {
        float t = 0.004;
        for (int j = 0; j < 65; j++) {
          float d = field(origin + direction * t);
          if (d > -EPS) return t;
          t += max(-d * 0.8, EPS);
          if (t > 3.2) break;
        }
        return t;
      }
      float box(vec2 p, vec2 halfSize, float softness) {
        vec2 d = abs(p) - halfSize;
        return 1. - smoothstep(-softness, softness, max(d.x, d.y));
      }
      vec3 environment(vec3 direction) {
        vec3 d = normalize(direction);
        // Realistic studio light cards, expressed in direction space. They are
        // reflected/refracted by the surface; there is no logo emissive term.
        vec3 color = mix(vec3(0.010,0.009,0.008), vec3(0.045,0.043,0.040), uLight);
        vec2 front = d.xy / max(d.z, 0.02);
        float frontGate = smoothstep(0.,0.15,d.z);
        color += vec3(5.5,5.15,4.6) * box(front - vec2(-0.9,0.4),vec2(0.22,1.6),0.10) * frontGate;
        color += vec3(7.,6.7,6.1) * box(front - vec2(0.95,0.1),vec2(0.12,1.45),0.08) * frontGate;
        color += vec3(3.8,3.75,3.65) * box(front - vec2(0.,1.35),vec2(1.25,0.24),0.15) * frontGate;
        color += vec3(0.9,0.62,0.27) * box(front - vec2(-0.50,-0.55),vec2(0.035,1.0),0.02) * frontGate;
        vec2 rear = d.xy / max(-d.z,0.02);
        float backGate = smoothstep(0.,0.15,-d.z);
        color += vec3(0.028,0.026,0.021) * box(rear - vec2(0.,0.5),vec2(1.3,0.7),0.35) * backGate;
        color += vec3(2.3,0.95,0.12) * box(rear - vec2(0.72,-0.3),vec2(0.085,1.6),0.065) * backGate;
        color += vec3(1.4,1.35,1.22) * box(rear - vec2(-0.9,0.3),vec2(0.13,1.2),0.07) * backGate;
        // Low warm bounce from the studio floor.
        color += vec3(0.16,0.115,0.056) * pow(max(0.,-d.y),6.);
        return color;
      }
      float fresnel(float cosTheta) { return 0.0387 + 0.9613 * pow(1. - clamp(cosTheta,0.,1.),5.); }
      vec3 traceGlass(vec3 p, vec3 direction, vec3 normal) {
        float f = fresnel(dot(-direction, normal));
        vec3 color = environment(uRotation * reflect(direction,normal)) * f;
        vec3 ray = refract(direction, normal, 1. / IOR);
        vec3 origin = p + ray * 0.006;
        vec3 throughput = vec3(1. - f);
        for (int bounce = 0; bounce < 1; bounce++) {
          float distance = exitHit(origin, ray);
          vec3 end = origin + ray * distance;
          vec3 n = surfaceNormal(end);
          throughput *= exp(-distance * vec3(0.22,0.28,0.38));
          vec3 outgoing = refract(ray, -n, IOR);
          float reflection = length(outgoing) < 0.01 ? 1. : fresnel(dot(ray,n));
          if (reflection < 1.) {
            color += throughput * (1. - reflection) * environment(uRotation * outgoing);
          }
          throughput *= reflection;
          ray = reflect(ray,n); origin = end + ray * 0.007;
        }
        color += throughput * environment(uRotation * ray) * 0.65;
        return color;
      }
      vec3 aces(vec3 c) { return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.,1.); }
      vec4 sampleGlass(vec2 uv, out float edge) {
        edge = 0.;
        vec2 screen = uv * 2. - 1.; screen.x *= uAspect;
        vec3 worldOrigin = vec3(0.,0.,3.95);
        vec3 worldRay = normalize(vec3(screen * 0.28675,-1.));
        vec3 origin = uInverse * worldOrigin;
        vec3 direction = normalize(uInverse * worldRay);
        float clearance;
        float t = primaryHit(origin, direction, clearance);
        if (t < 0.) {
          // Catch thin tips between pixel centers, where fwidth alone sees no edge.
          float cone = 0.86 * length(uInverse[1]) / uResolution.y;
          edge = 1. - step(cone, clearance);
          return vec4(0.);
        }
        vec3 p = origin + direction * t;
        vec3 normal = surfaceNormal(p);
        edge = 1. - smoothstep(0.1, 0.3, abs(dot(normal, direction)));
        vec3 color = traceGlass(p,direction,normal);
        color = pow(aces(color * 1.12),vec3(1. / 2.2));
        return vec4(color,1.);
      }
      void main() {
        float edge;
        vec4 center = sampleGlass(vUv, edge);
        // MSAA on a fullscreen quad cannot see this ray-marched silhouette.
        // Spend extra rays only where coverage or reflected light changes sharply.
        vec4 variation = fwidth(center);
        if (edge < 0.01 && max(max(variation.r, variation.g), max(variation.b, variation.a)) < 0.08) {
          gl_FragColor = center;
          return;
        }
        vec4 sum = vec4(0.);
        for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
          float unusedEdge;
          sum += sampleGlass(vUv + (vec2(float(x),float(y)) - .5) * .5 / uResolution, unusedEdge);
        }
        // Average coverage separately from straight-alpha RGB to avoid dark fringes.
        gl_FragColor = vec4(sum.rgb / max(sum.a, 1.), sum.a * .25);
      }
    `,
    transparent: true, toneMapped: false,
  });
}
