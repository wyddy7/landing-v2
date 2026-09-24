import * as THREE from './three.module.js';
import { logoDistanceTexture, opticalMaterial } from './optical-shader.js?v=glass-baked-1';
import { createFrameBudget, pixelRatioFor } from './render-budget.js?v=glass-baked-1';
import { createGlassEntrance } from './entrance.js?v=glass-baked-1';

// Use the original SVG as the only shape source, including its negative space.
function logoGeometry(slot) {
  const path = slot.querySelector('.mark-placeholder path');
  const tokens = path.getAttribute('d').match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g);
  const shape = new THREE.Shape();
  const x = (v) => Number(v) / 512 - 1, y = (v) => 1 - Number(v) / 512;
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') shape.moveTo(x(tokens[i++]), y(tokens[i++]));
    else if (command === 'C') shape.bezierCurveTo(x(tokens[i++]), y(tokens[i++]), x(tokens[i++]), y(tokens[i++]), x(tokens[i++]), y(tokens[i++]));
    else if (command === 'L') shape.lineTo(x(tokens[i++]), y(tokens[i++]));
    else if (command === 'Z') shape.closePath();
    else throw new Error(`Unsupported logo path command: ${command}`);
  }
  const raw = new THREE.ExtrudeGeometry(shape, {
    depth: 0.19, steps: 2, curveSegments: 40,
    bevelEnabled: true, bevelSegments: 12, bevelThickness: 0.078,
    bevelSize: 0.065, bevelOffset: -0.050,
  });
  raw.translate(0, 0, -0.095);
  // Only a picking proxy. The visible optical surface is ray-marched from the
  // original SVG distance field, so it has no triangulation seams.
  raw.computeBoundingBox();
  const center = raw.boundingBox.getCenter(new THREE.Vector3());
  raw.translate(-center.x, -center.y, 0); raw.computeBoundingSphere();
  return raw;
}

export async function mountGlassLogo(slot, { introRequested = false, quality = 'full', canvas: targetCanvas, context, signal, onFallback } = {}) {
  const distance = await logoDistanceTexture(signal);
  let geometry, renderer;
  try {
    geometry = logoGeometry(slot);
    renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, context, antialias: false, alpha: true, powerPreference: 'low-power' });
  } catch (error) { distance.dispose(); geometry?.dispose(); throw error; }
  const budget = createFrameBudget(quality);
  slot.dataset.glassQuality = quality;
  function setSize(width, height, isIntro = false) {
    renderer.setPixelRatio(pixelRatioFor(budget.quality, width, height, devicePixelRatio, isIntro));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(material.uniforms.uResolution.value);
    budget.reset();
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 25);
  camera.position.set(0, 0.06, 3.95); camera.lookAt(0, 0, 0);
  const uniforms = { uJelly: { value: new THREE.Vector3() }, uGrab: { value: new THREE.Vector2() } };
  const material = opticalMaterial(distance, uniforms.uJelly, uniforms.uGrab);
  const mesh = new THREE.Mesh(geometry);
  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeometry, material);
  quad.frustumCulled = false;
  scene.add(quad);
  const canvas = renderer.domElement;
  canvas.className = 'glass-logo'; canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive glass logo. Drag to rotate. Arrow keys rotate; Home resets.');
  canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
  slot.appendChild(canvas);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const state = {
    x: 0.065, y: -0.18, vx: 0, vy: 0, targetX: 0.065, targetY: -0.18,
    jelly: new THREE.Vector3(), jellyV: new THREE.Vector3(),
    pointer: null, lastX: 0, lastY: 0, lastInteraction: -100,
  };
  let raf = 0, last = 0, time = 0, visible = true, destroyed = false, shaderError = false;
  let introStageSize = null;
  let intro = null, introStarted = false, firstRender = false, introLanding = false, fallbackPending = false;
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    shaderError = true;
    console.error('Glass logo shader:', gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
  };
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function theme() {
    const light = document.documentElement.dataset.theme === 'light';
    // Never paint a theme-coloured rectangle, including the first GPU frame.
    scene.background = null; renderer.setClearColor(0x000000, 0);
    material.uniforms.uLight.value = light ? 1 : 0;
    renderer.toneMappingExposure = light ? 0.95 : 1.1;
    wake();
  }
  function resize() {
    if (intro && !introLanding) return;
    const rect = slot.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setSize(rect.width, rect.height);
    camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
    material.uniforms.uAspect.value = camera.aspect; wake();
  }
  function hit(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(pointer, camera); return raycaster.intersectObject(mesh)[0];
  }
  function down(event) {
    if (intro || event.button !== 0 || state.pointer !== null) return;
    const intersection = hit(event); if (!intersection) return;
    state.pointer = event.pointerId; state.lastX = event.clientX; state.lastY = event.clientY;
    state.targetX = state.x; state.targetY = state.y; state.lastInteraction = time;
    const local = mesh.worldToLocal(intersection.point);
    uniforms.uGrab.value.set(local.x, local.y);
    canvas.setPointerCapture(event.pointerId); canvas.classList.add('is-dragging');
    canvas.classList.add('is-pointer-focused');
    canvas.focus({ preventScroll: true }); wake();
  }
  function move(event) {
    if (event.pointerId !== state.pointer) { canvas.classList.toggle('is-over-logo', !!hit(event)); return; }
    const dx = event.clientX - state.lastX, dy = event.clientY - state.lastY;
    const scale = 3.8 / Math.max(180, slot.clientWidth);
    state.targetY += dx * scale; state.targetX = THREE.MathUtils.clamp(state.targetX + dy * scale, -1.1, 1.1);
    if (!reduced.matches) {
      state.jellyV.x += THREE.MathUtils.clamp(dx * 0.014, -0.35, 0.35);
      state.jellyV.y -= THREE.MathUtils.clamp(dy * 0.01, -0.3, 0.3);
      state.jellyV.z += THREE.MathUtils.clamp((dx + dy) * 0.012, -0.3, 0.3);
    }
    state.lastX = event.clientX; state.lastY = event.clientY; state.lastInteraction = time; wake();
  }
  function up(event) {
    if (event.pointerId !== state.pointer) return;
    state.pointer = null; state.lastInteraction = time;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.classList.remove('is-dragging'); wake();
  }
  function keyboard(event) {
    canvas.classList.remove('is-pointer-focused');
    const angles = { ArrowLeft: [0, -0.3], ArrowRight: [0, 0.3], ArrowUp: [-0.2, 0], ArrowDown: [0.2, 0] };
    if (event.key === 'Home') { state.targetX = 0.065; state.targetY = Math.round(state.y / (Math.PI * 2)) * Math.PI * 2 - 0.18; }
    else if (angles[event.key]) {
      state.targetX = THREE.MathUtils.clamp(state.targetX + angles[event.key][0], -1.1, 1.1);
      state.targetY += angles[event.key][1];
    } else return;
    event.preventDefault(); state.lastInteraction = time;
    if (!reduced.matches) state.jellyV.z += 0.22; wake();
  }
  function step(dt) {
    if (state.pointer === null && time - state.lastInteraction > 2.4) {
      const homeY = Math.round(state.y / (Math.PI * 2)) * Math.PI * 2 - 0.18;
      const settle = 1 - Math.exp(-dt * 1.25);
      state.targetX += (0.065 - state.targetX) * settle; state.targetY += (homeY - state.targetY) * settle;
    }
    if (reduced.matches) {
      state.x = state.targetX; state.y = state.targetY;
      state.vx = state.vy = 0; state.jelly.set(0, 0, 0); state.jellyV.set(0, 0, 0);
    } else {
      const stiffness = state.pointer === null ? 70 : 190, damping = state.pointer === null ? 13 : 23;
      state.vx += ((state.targetX - state.x) * stiffness - state.vx * damping) * dt;
      state.vy += ((state.targetY - state.y) * stiffness - state.vy * damping) * dt;
      state.x += state.vx * dt; state.y += state.vy * dt;
      for (const axis of ['x', 'y', 'z']) {
        state.jellyV[axis] += (-state.jelly[axis] * 105 - state.jellyV[axis] * 5.8) * dt;
        state.jelly[axis] = THREE.MathUtils.clamp(state.jelly[axis] + state.jellyV[axis] * dt, -0.19, 0.19);
      }
    }
  }
  function normalPose(idle = 1) {
    mesh.rotation.set(state.x + Math.sin(time * 0.43) * 0.018 * idle,
      state.y + Math.sin(time * 0.31) * 0.025 * idle, Math.sin(time * 0.37) * 0.006 * idle);
    mesh.position.y = Math.sin(time * 0.58) * 0.006 * idle;
    mesh.scale.set(1, 1, 1);
  }

  function resetState() {
    state.x = state.targetX = 0.065; state.y = state.targetY = -0.18;
    state.vx = state.vy = 0; state.jelly.set(0, 0, 0); state.jellyV.set(0, 0, 0);
    state.pointer = null; state.lastInteraction = time;
    mesh.rotation.set(0.065, -0.18, 0); mesh.position.y = 0; mesh.scale.set(1, 1, 1);
  }

  function updateMaterialMatrix() {
    mesh.updateMatrixWorld();
    material.uniforms.uRotation.value.setFromMatrix4(mesh.matrixWorld);
    material.uniforms.uInverse.value.copy(material.uniforms.uRotation.value).invert();
  }

  function startIntro() {
    if (intro || destroyed || reduced.matches || shaderError || budget.quality === 'static') { window.__glassIntroRelease?.(); return; }
    intro = createGlassEntrance({
      slot, canvas,
      onStart(stage) {
        introStageSize = stage;
        visible = true;
        setSize(stage.width, stage.height, true);
        camera.aspect = stage.width / stage.height; camera.updateProjectionMatrix();
        material.uniforms.uAspect.value = camera.aspect;
        scene.background = null; renderer.setClearColor(0x000000, 0);
      },
      onPose(pose) {
        mesh.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
        mesh.scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);
        mesh.position.y = 0;
        state.jelly.set(...pose.jelly);
        uniforms.uGrab.value.set(0, 0.45);
        canvas.style.opacity = String(pose.alpha);
        // Once it is home, the first pointer-down both ends the tail and grabs
        // the same canvas. There is no dead click while the jelly is settling.
        canvas.style.pointerEvents = pose.travel > 0.97 ? 'auto' : 'none';
        canvas.style.transform = pose.transform;
      },
      onLand({ restore }) {
        // Keep the fixed FLIP transform in place while appending, then clear all
        // inline geometry in the same task so there is no intermediate paint.
        slot.appendChild(canvas);
        canvas.classList.remove('is-intro');
        restore();
        introLanding = true;
        resize();
        theme();
        introLanding = false;
      },
      onFinish() {
        introStageSize = null;
        resetState();
        intro = null;
        updateMaterialMatrix();
        time = 0; last = 0;
        const rect = slot.getBoundingClientRect();
        visible = rect.bottom > -80 && rect.top < innerHeight + 80;
        if (fallbackPending) {
          queueMicrotask(() => dispose('slow-device'));
          return;
        }
        wake();
      },
    });
    introRequested = false;
    intro.start();
  }

  function render(now) {
    raf = 0;
    if (destroyed || document.hidden || !visible) { last = 0; return; }
    // Intro and direct manipulation run at display cadence; quiet idle gets 30 fps.
    const active = intro || state.pointer !== null || time - state.lastInteraction < 6;
    // Once fallback is pending, preserve the accepted score at display cadence
    // through its landing beat. The transfer changes neither its buffer nor its
    // temporal sampling halfway through the gesture.
    const frameInterval = !fallbackPending && (budget.quality === 'economy' || !active) ? 30 : 0;
    if (last && now - last < frameInterval) { wake(); return; }
    const elapsed = last ? (now - last) / 1000 : 1 / 60;
    const nextQuality = last ? budget.sample(now - last, frameInterval ? 1000 / 30 : 1000 / 60) : null;
    // Do not swap drawing-buffer resolution while the choreographed entrance
    // is on screen. One sustained slow measurement transfers to the baked
    // resting frame; the accepted entrance either finishes whole or is never
    // started on this runtime.
    if (nextQuality && !fallbackPending) {
      fallbackPending = true;
      slot.dataset.glassQuality = 'baked-pending';
      if (!intro) { dispose('slow-device'); return; }
    }
    const dt = Math.min(elapsed, 0.05);
    last = now; time += dt;
    if (intro) {
      intro.advance(elapsed);
    } else {
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      for (let j = 0; j < steps; j++) step(dt / steps);
      const idle = reduced.matches || budget.quality === 'economy' || state.pointer !== null ? 0 : 1;
      normalPose(idle);
    }
    uniforms.uJelly.value.copy(state.jelly);
    updateMaterialMatrix();
    try { renderer.render(scene, camera); }
    catch (error) { console.warn('Glass render unavailable.', error); dispose('render-error'); return; }
    if (shaderError || renderer.getContext().isContextLost()) { dispose('graphics-error'); return; }
    slot.classList.add('is-ready'); slot.dataset.glassState = 'ready'; firstRender = true;
    if (introRequested && !introStarted) {
      introStarted = true;
      if (window.__glassIntroRequested && !reduced.matches && !window.scrollY) startIntro();
      else { introRequested = false; window.__glassIntroRelease?.(); }
    }
    if (intro || !fallbackPending && !reduced.matches && (budget.quality === 'full' || active)) wake();
    else { last = 0; budget.reset(); }
  }
  function wake() { if (!raf && !destroyed && !document.hidden && visible) raf = requestAnimationFrame(render); }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null; observer?.observe(slot);
  const themeObserver = new MutationObserver(theme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => {
    if (intro) return;
    visible = entry.isIntersecting; last = 0; budget.reset(); if (visible) wake();
  }, { rootMargin: '80px' }) : null;
  visibility?.observe(slot);
  function resumed() { last = 0; budget.reset(); wake(); }
  document.addEventListener('visibilitychange', resumed);
  window.addEventListener('pageshow', resumed);
  function reducedChanged() {
    if (reduced.matches) { dispose('reduced-motion'); return; }
    resumed();
  }
  function windowResized() { if (intro) intro.cancel('resize'); else resize(); }
  if (reduced.addEventListener) reduced.addEventListener('change', reducedChanged);
  else reduced.addListener(reducedChanged);
  window.addEventListener('resize', windowResized);
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('blur', () => canvas.classList.remove('is-pointer-focused'));
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('is-over-logo'));
  canvas.addEventListener('keydown', keyboard);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); dispose('context-lost');
  });
  function dispose(reason = 'disposed') {
    if (destroyed) return;
    destroyed = true;
    if (intro) intro.cancel(reason);
    cancelAnimationFrame(raf); raf = 0;
    observer?.disconnect(); themeObserver.disconnect(); visibility?.disconnect();
    document.removeEventListener('visibilitychange', resumed);
    window.removeEventListener('pageshow', resumed);
    if (reduced.removeEventListener) reduced.removeEventListener('change', reducedChanged);
    else reduced.removeListener(reducedChanged);
    window.removeEventListener('resize', windowResized);
    geometry.dispose(); mesh.material.dispose(); quadGeometry.dispose(); material.dispose(); distance.dispose();
    renderer.dispose();
    if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
    canvas.remove();
    slot.classList.remove('is-ready');
    slot.dataset.glassState = 'static'; slot.dataset.glassQuality = 'static'; slot.dataset.glassReason = reason;
    window.__glassIntroRelease?.();
    if (reason !== 'disposed') queueMicrotask(() => onFallback?.(reason));
  }
  theme(); resize();
  return {
    startIntro() {
      introRequested = true;
      if (firstRender) startIntro(); else wake();
      return intro ? intro.done : null;
    },
    get intro() { return intro; },
    dispose,
  };
}
