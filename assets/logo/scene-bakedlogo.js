import { createGlassEntrance, GLASS_ENTRANCE_DURATION } from './entrance.js?v=glass-baked-1';

const LOAD_BUDGET_MS = 2200;

function glassTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function defaultIntroAllowed() {
  return window.__glassIntroRequested === true && !document.hidden &&
    !window.scrollX && !window.scrollY && !location.hash;
}

function releaseIntroGate(reason = 'unavailable') {
  if (typeof window.__glassIntroRelease === 'function') {
    window.__glassIntroRelease(reason);
    return;
  }
  window.__glassIntroRequested = false;
  document.documentElement.classList.remove('glass-intro-pending', 'glass-intro-active');
  document.documentElement.style.removeProperty('--glass-content-opacity');
  clearTimeout(window.__glassIntroFuse);
}

function abortError() {
  return new DOMException('Baked logo loading aborted', 'AbortError');
}

function mediaStyle(element) {
  Object.assign(element.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    objectFit: 'contain',
    background: 'transparent',
  });
}

function waitForImage(image, src, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (error) => {
      clearTimeout(timer);
      image.removeEventListener('load', loaded);
      image.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error(`Unable to load ${src}`));
    const aborted = () => finish(abortError());
    image.addEventListener('load', loaded, { once: true });
    image.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error(`Timed out loading ${src}`)), timeoutMs);
    image.src = src;
    if (image.complete) image.naturalWidth ? loaded() : failed();
  });
}

function waitForVideo(video, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (error) => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', loaded);
      video.removeEventListener('error', failed);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error('Baked logo video could not be decoded'));
    const aborted = () => finish(abortError());
    video.addEventListener('loadeddata', loaded, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error('Baked logo video loading timed out')), timeoutMs);
    video.load();
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) loaded();
  });
}

function playWithin(video, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve();
    };
    const aborted = () => finish(abortError());
    signal?.addEventListener('abort', aborted, { once: true });
    timer = setTimeout(() => finish(new Error('Baked logo autoplay timed out')), timeoutMs);
    // A late fulfillment after the timeout cannot restart a removed source: the
    // timeout path pauses it through finishStatic before this continuation runs.
    Promise.resolve(video.play()).then(() => finish(), finish);
  });
}

function hasDecodedAlpha(video) {
  try {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 1;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context || !video.videoWidth || !video.videoHeight) return false;
    context.clearRect(0, 0, 1, 1);
    // The authored frame has an empty corner. Sample that source pixel,
    // not an average of the transparent exterior and the mark itself.
    context.drawImage(video, 0, 0, 1, 1, 0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[3] === 0;
  } catch (_) {
    return false;
  }
}

export async function mountBakedLogo(slot, {
  introAllowed = defaultIntroAllowed,
  signal,
  posterOnly = false,
} = {}) {
  if (!slot) throw new TypeError('A logo slot is required');

  const wrapper = document.createElement('div');
  const poster = document.createElement('img');
  const video = document.createElement('video');
  const localController = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const staticOnly = posterOnly || reduced.matches || navigator.connection?.saveData === true;
  const asset = (theme, extension) => new URL(`./baked/glass-${theme}.${extension}`, import.meta.url).href;

  wrapper.className = 'glass-logo glass-baked';
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', 'Glass logo');
  poster.className = 'glass-baked-poster';
  poster.alt = '';
  poster.draggable = false;
  video.className = 'glass-baked-video';
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  mediaStyle(poster);
  mediaStyle(video);
  poster.style.visibility = 'hidden';
  video.style.visibility = 'hidden';
  wrapper.append(poster, video);
  slot.appendChild(wrapper);
  slot.dataset.glassMode = 'baked';
  slot.dataset.glassState = 'loading';

  let destroyed = false;
  let posterTheme = null;
  let posterLoaded = false;
  let posterEpoch = 0;
  let videoTheme = null;
  let videoReady = false;
  let intro = null;
  let starting = null;
  let startEpoch = 0;
  let raf = 0;
  let playbackTimer = 0;
  let lastMediaTime = 0;
  let themeObserver = null;

  const ownsSlot = () => slot.dataset.glassMode === 'baked';
  const setState = (state) => { if (ownsSlot()) slot.dataset.glassState = state; };
  const setReady = (ready) => {
    if (!ownsSlot()) return;
    slot.classList.toggle('is-ready', ready);
  };
  const canIntro = () => {
    try { return !staticOnly && introAllowed(); }
    catch (_) { return false; }
  };

  function showPoster() {
    const current = posterLoaded && posterTheme === glassTheme();
    poster.style.visibility = current ? 'visible' : 'hidden';
    video.style.visibility = 'hidden';
    setReady(current);
    return current;
  }

  function releaseVideo() {
    videoReady = false;
    videoTheme = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }

  async function loadPoster(theme, timeoutMs = LOAD_BUDGET_MS) {
    const epoch = ++posterEpoch;
    posterLoaded = false;
    poster.style.visibility = 'hidden';
    setReady(false);
    await waitForImage(poster, asset(theme, 'png'), localController.signal, timeoutMs);
    if (destroyed || epoch !== posterEpoch) return false;
    if (typeof poster.decode === 'function') await poster.decode().catch(() => {});
    if (destroyed || epoch !== posterEpoch) return false;
    posterTheme = theme;
    posterLoaded = true;
    setReady(true);
    return true;
  }

  async function prepareVideo(theme, deadline) {
    const movFirst = !!video.canPlayType('video/quicktime; codecs="hvc1"');
    const candidates = movFirst ? ['mov', 'webm'] : ['webm', 'mov'];
    for (const extension of candidates) {
      const remaining = Math.max(0, deadline - performance.now());
      if (!remaining || destroyed || !canIntro() || glassTheme() !== theme) break;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.src = asset(theme, extension);
      try {
        await waitForVideo(video, localController.signal, remaining);
        if (!hasDecodedAlpha(video)) continue;
        video.currentTime = 0;
        videoTheme = theme;
        videoReady = true;
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
      }
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    return false;
  }

  function finishStatic(reason) {
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(playbackTimer);
    playbackTimer = 0;
    showPoster();
    releaseVideo();
    setState('static');
    releaseIntroGate(reason);
  }

  function driveEntrance() {
    raf = 0;
    if (destroyed || !intro?.active) return;
    const mediaTime = Math.max(lastMediaTime, video.currentTime || 0);
    intro.advance(mediaTime - lastMediaTime);
    lastMediaTime = mediaTime;
    if (intro?.active) raf = requestAnimationFrame(driveEntrance);
  }

  function videoEnded() {
    if (intro?.active) intro.advance(Math.max(0, GLASS_ENTRANCE_DURATION - lastMediaTime));
  }

  function videoFailed() {
    if (intro?.active) intro.cancel('media-error');
    else if (starting) {
      startEpoch++;
      finishStatic('media-error');
    }
  }

  video.addEventListener('ended', videoEnded);
  video.addEventListener('error', videoFailed);

  const initialTheme = glassTheme();
  const deadline = performance.now() + LOAD_BUDGET_MS;
  const posterReady = loadPoster(initialTheme, LOAD_BUDGET_MS);
  const videoPrepared = canIntro() ? prepareVideo(initialTheme, deadline) : Promise.resolve(false);

  function dispose(reason = 'disposed') {
    if (destroyed) return;
    const owned = ownsSlot();
    destroyed = true;
    startEpoch++;
    localController.abort();
    if (intro?.active) intro.cancel(reason);
    cancelAnimationFrame(raf);
    clearTimeout(playbackTimer);
    raf = playbackTimer = 0;
    themeObserver?.disconnect();
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('resize', resized);
    if (reduced.removeEventListener) reduced.removeEventListener('change', reducedChanged);
    else reduced.removeListener?.(reducedChanged);
    signal?.removeEventListener?.('abort', aborted);
    video.removeEventListener('ended', videoEnded);
    video.removeEventListener('error', videoFailed);
    video.pause();
    video.removeAttribute('src');
    video.load();
    wrapper.remove();
    if (owned) {
      slot.classList.remove('is-ready');
      slot.dataset.glassState = 'static';
    }
    releaseIntroGate(reason);
  }

  function aborted() { dispose('aborted'); }
  signal?.addEventListener?.('abort', aborted, { once: true });
  if (signal?.aborted) aborted();

  try {
    const [, prepared] = await Promise.all([posterReady, videoPrepared]);
    if (destroyed) throw abortError();
    if (glassTheme() !== initialTheme) await loadPoster(glassTheme(), LOAD_BUDGET_MS);
    if (destroyed) throw abortError();
    if (prepared && videoTheme === glassTheme() && canIntro()) {
      poster.style.visibility = 'hidden';
      video.style.visibility = 'visible';
      setReady(true);
      setState('ready');
    } else {
      finishStatic(staticOnly ? 'poster-only' : 'intro-unavailable');
    }
  } catch (error) {
    dispose(error?.name === 'AbortError' ? 'aborted' : 'poster-error');
    throw error;
  }

  async function startIntro() {
    if (starting) return starting;
    if (destroyed || !videoReady || videoTheme !== glassTheme() || !canIntro()) {
      if (!destroyed) finishStatic('not-requested');
      return null;
    }
    const epoch = ++startEpoch;
    starting = (async () => {
      try {
        video.currentTime = 0;
        poster.style.visibility = 'hidden';
        video.style.visibility = 'visible';
        await playWithin(video, localController.signal, 1000);
        if (destroyed || epoch !== startEpoch || videoTheme !== glassTheme() || !canIntro()) {
          if (!destroyed) finishStatic('interrupted');
          return null;
        }
        intro = createGlassEntrance({
          slot,
          canvas: wrapper,
          onStart() {
            setState('ready');
          },
          onPose(pose) {
            wrapper.style.opacity = String(pose.alpha);
            wrapper.style.pointerEvents = 'none';
            wrapper.style.transform = pose.transform;
          },
          onLand({ restore }) {
            if (!destroyed) slot.appendChild(wrapper);
            wrapper.classList.remove('is-intro');
            restore();
            showPoster();
          },
          onFinish() {
            cancelAnimationFrame(raf);
            clearTimeout(playbackTimer);
            raf = playbackTimer = 0;
            intro = null;
            if (!destroyed) {
              showPoster();
              releaseVideo();
              setState('static');
            }
          },
        });
        lastMediaTime = 0;
        const done = intro.start();
        playbackTimer = setTimeout(() => intro?.cancel('media-stalled'), 4000);
        raf = requestAnimationFrame(driveEntrance);
        return await done;
      } catch (_) {
        if (!destroyed) finishStatic('autoplay-error');
        return null;
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function themeChanged() {
    if (destroyed) return;
    startEpoch++;
    if (intro?.active) intro.cancel('theme');
    releaseVideo();
    setState('loading');
    try {
      await loadPoster(glassTheme());
      if (!destroyed) {
        showPoster();
        setState('static');
      }
    } catch (_) {
      if (!destroyed) {
        setReady(false);
        setState('static');
      }
    }
  }

  function visibilityChanged() {
    if (!document.hidden) return;
    startEpoch++;
    if (intro?.active) intro.cancel('hidden');
    else if (starting) finishStatic('hidden');
  }
  function resized() {
    if (intro?.active) intro.cancel('resize');
  }
  function reducedChanged() {
    if (!reduced.matches) return;
    startEpoch++;
    if (intro?.active) intro.cancel('reduced-motion');
    else if (starting) finishStatic('reduced-motion');
  }

  if (typeof MutationObserver === 'function') {
    themeObserver = new MutationObserver(themeChanged);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('resize', resized);
  if (reduced.addEventListener) reduced.addEventListener('change', reducedChanged);
  else reduced.addListener?.(reducedChanged);

  return { ready: posterReady, startIntro, dispose };
}
