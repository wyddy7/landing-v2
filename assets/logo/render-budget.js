// Hardware hints are optional. Frame cadence is the final authority; neither
// a browser name nor a missing WebGPU API excludes an otherwise capable GPU.
export function initialQuality({ saveData = false, reduced = false } = {}) {
  if (saveData) return 'static';
  // Privacy protections may cap or spoof core/memory hints on capable hardware.
  // Let measured frame cadence select economy instead of degrading on first paint.
  return reduced ? 'economy' : 'full';
}

// A phone does not have a reliable public "GPU class". Touch-first screens get
// the authored recording from the first paint; desktops keep the interactive
// object until measured cadence proves that it cannot sustain it. Save Data and
// reduced motion always win over a developer-only mode override.
export function selectLogoMode({ coarsePointer = false, saveData = false, reduced = false, override = '' } = {}) {
  if (saveData || reduced) return 'baked-static';
  if (override === 'baked') return 'baked';
  if (override === 'live') return 'live';
  return coarsePointer ? 'baked' : 'live';
}

export function pixelRatioFor(quality, width, height, dpr = 1, intro = false) {
  const cap = quality === 'economy' ? 1 : intro ? 1.5 : 2;
  const pixels = quality === 'economy' ? 100000 : 560000;
  return Math.min(dpr || 1, cap, Math.sqrt(pixels / Math.max(1, width * height)));
}

// Two sustained slow windows, following a short warm-up, avoid reacting to a
// shader compilation, one long task, or intentionally throttled idle frames.
export function createFrameBudget(initial = 'full') {
  let quality = initial, warmup = 12, samples = [], strikes = 0;
  function reset() { warmup = 12; samples = []; strikes = 0; }
  return {
    get quality() { return quality; },
    reset,
    sample(milliseconds, targetInterval = 1000 / 60) {
      if (quality === 'static' || !Number.isFinite(milliseconds) || milliseconds <= 0) return null;
      if (warmup > 0) { warmup--; return null; }
      samples.push(milliseconds);
      if (samples.length < 24) return null;
      // Trim the two largest outliers. Repeatedly slow frames still count.
      const sorted = samples.sort((a, b) => a - b).slice(0, -2);
      const average = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      const limit = quality === 'full' ? Math.max(34, targetInterval * 1.45) : 65;
      strikes = average > limit ? strikes + 1 : 0;
      samples = [];
      if (strikes < 2) return null;
      quality = quality === 'full' ? 'economy' : 'static';
      reset();
      return quality;
    },
  };
}
