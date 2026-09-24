import { selectLogoMode } from './render-budget.js?v=glass-baked-1';

const slot = document.querySelector('.mark-slot');
let activeApi = null;
let activeController = null;
let fallbackPromise = null;

function releaseIntroGate(reason = 'unavailable') {
  window.__glassIntroRelease?.(reason);
  window.__glassIntroRequested = false;
  document.documentElement.classList.remove('glass-intro-pending', 'glass-intro-active');
  document.documentElement.style.removeProperty('--glass-content-opacity');
  clearTimeout(window.__glassIntroFuse);
}

function introAllowed() {
  return window.__glassIntroRequested === true &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches &&
    !document.hidden && !window.scrollX && !window.scrollY && !location.hash;
}

function requestedMode() {
  const override = new URLSearchParams(location.search).get('logo');
  return selectLogoMode({
    coarsePointer: matchMedia('(pointer: coarse)').matches,
    saveData: navigator.connection?.saveData === true,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    override: override === 'baked' || override === 'live' ? override : '',
  });
}

function clearLiveContext(context) {
  context?.getExtension('WEBGL_lose_context')?.loseContext();
}

async function mountBaked({ posterOnly = false, reason = 'baked' } = {}) {
  if (fallbackPromise) return fallbackPromise;
  fallbackPromise = (async () => {
    activeController?.abort();
    activeController = new AbortController();
    const controller = activeController;
    activeApi?.dispose?.('replaced');
    activeApi = null;
    slot.dataset.glassMode = 'baked';
    slot.dataset.glassQuality = posterOnly ? 'static' : 'baked';
    slot.dataset.glassState = 'loading';
    try {
      const { mountBakedLogo } = await import('./scene-bakedlogo.js?v=glass-baked-1');
      const api = await mountBakedLogo(slot, { introAllowed, signal: controller.signal, posterOnly });
      if (controller.signal.aborted) { api.dispose('replaced'); return null; }
      activeApi = api;
      // Let the baked runtime make the final gate decision. If input or the
      // prepaint fuse fired between preparation and this continuation, its
      // startIntro() path hides the first video frame and lands on the poster.
      if (!posterOnly) api.startIntro();
      else releaseIntroGate(reason);
      return api;
    } catch (error) {
      if (!controller.signal.aborted) {
        slot.dataset.glassMode = 'svg';
        slot.dataset.glassQuality = 'static';
        slot.dataset.glassState = 'static';
        releaseIntroGate(reason);
        console.warn('Baked glass logo unavailable; keeping the inline SVG.', error);
      }
      return null;
    }
  })();
  return fallbackPromise;
}

async function mountLive() {
  const controller = new AbortController();
  activeController = controller;
  let context;
  const timeout = setTimeout(() => {
    if (controller.signal.aborted) return;
    controller.abort();
    clearLiveContext(context);
    mountBaked({ posterOnly: true, reason: 'startup-timeout' });
  }, 6000);
  try {
    // Reuse the capability probe as the renderer's context; no spare GPU context.
    const canvas = document.createElement('canvas');
    const attributes = { alpha: true, antialias: false, powerPreference: 'low-power' };
    context = canvas.getContext('webgl2', attributes) || canvas.getContext('webgl', attributes);
    if (!context || !context.getShaderPrecisionFormat(context.FRAGMENT_SHADER, context.HIGH_FLOAT)?.precision) {
      throw new Error('WebGL with high-precision fragment shading unavailable');
    }
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext;
    if (!webgl2 && !context.getExtension('OES_standard_derivatives')) {
      throw new Error('Derivative antialiasing unavailable');
    }
    const { mountGlassLogo } = await import('./scene-glasslogo.js?v=glass-baked-1');
    if (controller.signal.aborted) return;
    const api = await mountGlassLogo(slot, {
      quality: 'full', canvas, context, signal: controller.signal,
      onFallback(reason) {
        clearLiveContext(context);
        mountBaked({ posterOnly: true, reason });
      },
    });
    if (controller.signal.aborted) { api.dispose('startup-timeout'); return; }
    activeApi = api;
    slot.dataset.glassMode = 'live';
    if (introAllowed()) api.startIntro();
    else releaseIntroGate(document.hidden ? 'hidden' : window.scrollX || window.scrollY ? 'scroll-position' : 'not-requested');
  } catch (error) {
    clearLiveContext(context);
    if (!controller.signal.aborted) {
      console.warn('Interactive glass logo unavailable; using the baked poster.', error);
      await mountBaked({ posterOnly: true, reason: 'webgl-unavailable' });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function boot() {
  if (!slot) { releaseIntroGate(); return; }
  const mode = requestedMode();
  if (mode === 'baked-static') {
    await mountBaked({ posterOnly: true, reason: navigator.connection?.saveData ? 'save-data' : 'reduced-motion' });
    return;
  }
  if (mode === 'baked') {
    await mountBaked();
    return;
  }
  slot.dataset.glassMode = 'live';
  slot.dataset.glassQuality = 'full';
  slot.dataset.glassState = 'loading';
  await mountLive();
}

boot();
