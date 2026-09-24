// One continuous gesture. The authored targets overlap; damped responses give
// translation, rotation and the soft body different amounts of follow-through.
const TOTAL = 2.6;
const HZ = 240;
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { const t = clamp(x); return t * t * t * (t * (t * 6 - 15) + 10); };
const spring = (x) => ({ x, v: 0 });
function advanceSpring(s, target, stiffness, damping) {
  const acceleration = (target - s.x) * stiffness - damping * s.v;
  s.v += acceleration / HZ;
  s.x += s.v / HZ;
  return acceleration;
}

// A fixed-step score makes the shape of the motion independent of display fps.
// Rendering samples this score; interaction keeps its own live spring afterward.
const score = (() => {
  const travel = spring(0), shrink = spring(0), size = spring(0.86);
  const pitch = spring(0.18), yaw = spring(0.94), roll = spring(-0.16);
  const bend = [spring(0), spring(0), spring(0)];
  const frames = [];
  for (let i = 0; i <= TOTAL * HZ; i++) {
    const t = i / HZ, open = smooth(t / 0.68);
    const route = smooth((t - 0.52) / 1.06);
    const acceleration = i ? advanceSpring(travel, route, 200, 22) : 0;
    if (i) {
      advanceSpring(shrink, smooth((t - 0.44) / 1.14), 210, 26);
      advanceSpring(size, mix(0.86, 1, open), 170, 21);
      advanceSpring(yaw, mix(0.94, -0.09, open) - 0.09 * travel.x, 125, 17);
      advanceSpring(pitch, mix(0.18, -0.025, open) + 0.09 * travel.x - 0.025 * travel.v, 135, 19);
      advanceSpring(roll, -0.16 * (1 - open) + 0.052 * travel.v, 105, 15);
      // Acceleration loads the body; rotation twists it. The delayed response
      // continues through braking, instead of adding a bounce after a hard stop.
      advanceSpring(bend[0], clamp(-acceleration * 0.018, -0.11, 0.11), 100, 10);
      advanceSpring(bend[1], 0.08 * Math.sin(Math.PI * open) - 0.03 * travel.v, 115, 12);
      advanceSpring(bend[2], -0.042 * yaw.v - 0.018 * travel.v, 90, 9);
    }
    const rest = smooth((t - 2.12) / 0.48);
    frames.push({
      travel: mix(travel.x, 1, rest), shrink: mix(shrink.x, 1, rest),
      size: mix(size.x, 1, rest), open,
      rotation: [mix(pitch.x, 0.065, rest), mix(yaw.x, -0.18, rest), roll.x * (1 - rest)],
      jelly: bend.map((s) => s.x * (1 - rest)),
      alpha: smooth(t / 0.16), content: smooth((travel.x - 0.48) / 0.48),
    });
  }
  return frames;
})();

export function sampleGlassMotion(seconds) {
  const index = clamp(seconds, 0, TOTAL) * HZ;
  const a = score[Math.floor(index)], b = score[Math.min(Math.floor(index) + 1, score.length - 1)];
  const f = index - Math.floor(index);
  const out = {};
  for (const key of ['travel', 'shrink', 'size', 'open', 'alpha', 'content']) out[key] = mix(a[key], b[key], f);
  for (const key of ['rotation', 'jelly']) out[key] = a[key].map((v, i) => mix(v, b[key][i], f));
  return out;
}

function introStage(slot) {
  const target = slot.getBoundingClientRect();
  const ratio = target.width / target.height;
  const height = Math.min(500, innerHeight * 0.52, innerWidth * 0.86 / ratio);
  const width = height * ratio;
  const cx = innerWidth * (innerWidth >= 1024 ? 0.53 : 0.5);
  const cy = innerHeight * 0.48;
  return { width, height, left: cx - width / 2, top: cy - height / 2, cx, cy, target };
}

export function createGlassEntrance({ slot, canvas, onStart, onPose, onLand, onFinish }) {
  let active = false, elapsed = 0, stage, originalStyle;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const root = document.documentElement;
  const inputs = ['pointerdown', 'wheel', 'touchstart', 'keydown'];
  function releaseGate() {
    window.__glassIntroRelease?.();
    root.classList.remove('glass-intro-pending');
    window.__glassIntroRequested = false;
    clearTimeout(window.__glassIntroFuse);
  }
  function poseAt(seconds) {
    const pose = sampleGlassMotion(seconds);
    const target = slot.getBoundingClientRect();
    const dx = target.left + target.width / 2 - stage.cx;
    const dy = target.top + target.height / 2 - stage.cy;
    const length = Math.max(1, Math.hypot(dx, dy));
    const arc = Math.sin(Math.PI * pose.travel) * Math.min(70, length * 0.18);
    const coil = Math.sin(Math.PI * pose.open) * 9 * (1 - pose.travel);
    const lift = 28 * (1 - pose.open) - 5 * Math.sin(Math.PI * pose.open);
    const cx = stage.cx + dx * pose.travel - dy / length * arc - dx / length * coil;
    const cy = stage.cy + dy * pose.travel + dx / length * arc + lift;
    const scaleX = mix(1, target.width / stage.width, pose.shrink) * pose.size;
    const scaleY = mix(1, target.height / stage.height, pose.shrink) * pose.size;
    // Follow the centre of mass, including while the projection becomes smaller.
    // Scaling about a top-left corner changes the apparent route of the object.
    const x = cx - stage.cx + stage.width * (1 - scaleX) / 2;
    const y = cy - stage.cy + stage.height * (1 - scaleY) / 2;
    const sx = 1 + pose.jelly[1] * 0.28, sy = 1 - pose.jelly[1] * 0.42;
    return { ...pose, opacity: pose.content, scale: [sx, sy, 1 / (sx * sy)],
      transform: `translate3d(${x}px,${y}px,0) scale(${scaleX},${scaleY})` };
  }
  function applyPose(seconds) {
    const pose = poseAt(seconds);
    root.style.setProperty('--glass-content-opacity', String(pose.opacity));
    onPose(pose);
  }
  function finish(reason) {
    if (!active) return done;
    active = false;
    applyPose(TOTAL);
    onLand({ restore() {
      if (originalStyle === null) canvas.removeAttribute('style');
      else canvas.setAttribute('style', originalStyle);
    } });
    inputs.forEach((type) => removeEventListener(type, inputSkip, true));
    root.classList.remove('glass-intro-active');
    root.style.removeProperty('--glass-content-opacity');
    releaseGate();
    root.dataset.glassIntro = reason === 'complete' ? 'complete' : 'skipped-' + reason;
    onFinish(reason);
    resolveDone({ reason });
    return done;
  }
  function inputSkip() { finish('input'); }
  return {
    done,
    get active() { return active; },
    start() {
      if (active) return done;
      stage = introStage(slot); originalStyle = canvas.getAttribute('style');
      releaseGate(); root.classList.add('glass-intro-active');
      canvas.classList.add('is-intro'); document.body.appendChild(canvas);
      Object.assign(canvas.style, { left: `${stage.left}px`, top: `${stage.top}px`,
        width: `${stage.width}px`, height: `${stage.height}px` });
      onStart(stage); active = true; applyPose(0);
      inputs.forEach((type) => addEventListener(type, inputSkip, { capture: true, passive: true }));
      root.dataset.glassIntro = 'playing';
      return done;
    },
    advance(dt) {
      if (!active) return false;
      elapsed = Math.min(TOTAL, elapsed + Math.max(0, dt));
      applyPose(elapsed);
      if (elapsed >= TOTAL) finish('complete');
      return active;
    },
    cancel(reason = 'interrupt') { return finish(reason); },
  };
}
export const GLASS_ENTRANCE_DURATION = TOTAL;
