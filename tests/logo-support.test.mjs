import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { initialQuality, pixelRatioFor, createFrameBudget, selectLogoMode } from '../assets/logo/render-budget.js';
import { sampleGlassMotion } from '../assets/logo/entrance.js';

test('privacy-reduced hardware hints preserve quality; explicit save-data avoids the renderer', () => {
  assert.equal(initialQuality(), 'full');
  assert.equal(initialQuality({ cores: 8 }), 'full');
  assert.equal(initialQuality({ cores: 2 }), 'full');
  assert.equal(initialQuality({ memory: 2 }), 'full');
  assert.equal(initialQuality({ reduced: true }), 'economy');
  assert.equal(initialQuality({ saveData: true, cores: 16 }), 'static');
});

test('touch-first and accessibility paths select the baked logo before Three is requested', () => {
  assert.equal(selectLogoMode(), 'live');
  assert.equal(selectLogoMode({ coarsePointer: true }), 'baked');
  assert.equal(selectLogoMode({ coarsePointer: false, override: 'baked' }), 'baked');
  assert.equal(selectLogoMode({ coarsePointer: true, override: 'live' }), 'live');
  assert.equal(selectLogoMode({ coarsePointer: false, saveData: true, override: 'live' }), 'baked-static');
  assert.equal(selectLogoMode({ coarsePointer: false, reduced: true, override: 'live' }), 'baked-static');
});

test('drawing buffer stays bounded even on high-DPR and very large screens', () => {
  for (const quality of ['full', 'economy']) for (const intro of [false, true]) {
    for (const [width, height] of [[300, 280], [600, 500], [3840, 2160]]) {
      const ratio = pixelRatioFor(quality, width, height, 4, intro);
      assert.ok(width * height * ratio ** 2 <= (quality === 'full' ? 560000 : 100000) + 0.001);
      assert.ok(ratio <= (quality === 'economy' ? 1 : intro ? 1.5 : 2));
    }
  }
});

test('normal 30fps idle and isolated long tasks do not cause false downgrades', () => {
  const budget = createFrameBudget();
  for (let i = 0; i < 600; i++) assert.equal(budget.sample(i % 48 === 0 ? 400 : 1000 / 30, 1000 / 30), null);
  assert.equal(budget.quality, 'full');
});

test('sustained slow cadence steps down, and can release the renderer entirely', () => {
  const budget = createFrameBudget();
  const transitions = [];
  for (let i = 0; i < 180; i++) {
    const next = budget.sample(100, 1000 / 30);
    if (next) transitions.push(next);
  }
  assert.deepEqual(transitions, ['economy', 'static']);
});

test('resume and resize start a fresh measurement window', () => {
  const budget = createFrameBudget();
  for (let i = 0; i < 40; i++) budget.sample(100);
  budget.reset();
  for (let i = 0; i < 300; i++) budget.sample(1000 / 60);
  assert.equal(budget.quality, 'full');
});

test('accepted entrance remains finite and lands exactly at every tested cadence', () => {
  for (const fps of [24, 30, 60, 120, 144]) {
    for (let t = 0; t <= 2.6; t += 1 / fps) {
      const pose = sampleGlassMotion(t);
      for (const value of Object.values(pose).flat()) assert.ok(Number.isFinite(value));
    }
  }
  const end = sampleGlassMotion(2.6);
  assert.deepEqual(sampleGlassMotion(10), end);
  assert.equal(end.travel, 1);
  assert.deepEqual(end.rotation, [0.065, -0.18, 0]);
  assert.deepEqual(end.jelly, [0, 0, 0]);
});

test('no-JS placeholder retains the original logo; distance image is padded RGBA data', async () => {
  const root = new URL('../', import.meta.url);
  const [html, svg, png] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('assets/favicon-light.svg', root), 'utf8'),
    readFile(new URL('assets/logo/logo-distance.png', root)),
  ]);
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]).sort((a, b) => b.length - a.length);
  assert.ok(html.includes(`<path d="${paths[0]}"/>`));
  assert.ok(!html.includes('.mark-slot::before'));
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  assert.equal(png[25], 6); // RGBA, no palette conversion of numeric channels.
});

test('prepaint gate replays on every opening, including economy devices, and fails open', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const gate = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
    .find((script) => script.includes('Decide before paint'));
  function run({ reduced = false, seen = false, hash = '', search = '', navigator = {} } = {}) {
    const classes = new Set(), events = new Map();
    let fuse;
    const context = {
      document: { documentElement: { dataset: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } } },
      matchMedia: () => ({ matches: reduced }), location: { hash, search }, URLSearchParams,
      navigator, sessionStorage: { getItem: () => seen ? '1' : null },
      addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name) => events.delete(name),
      setTimeout: (fn) => { fuse = fn; return 1; }, clearTimeout() {},
    };
    context.window = context;
    runInNewContext(gate, context);
    return { classes, events, expire: () => fuse?.() };
  }
  for (const options of [{ reduced: true }, { search: '?intro=0' }, { hash: '#experience' },
    { navigator: { connection: { saveData: true } } }]) {
    assert.equal(run(options).classes.size, 0);
  }
  for (const options of [{ seen: true }, { navigator: { hardwareConcurrency: 2 } }, { navigator: { deviceMemory: 2 } }]) {
    assert.ok(run(options).classes.has('glass-intro-pending'));
  }
  assert.match(html, /<script type="module" src="\.\/assets\/logo\/boot.js/);
  assert.ok(!html.includes("addEventListener('load'"));
  const forced = run({ seen: true, search: '?intro=1' });
  assert.ok(forced.classes.has('glass-intro-pending'));
  forced.events.get('wheel')();
  assert.equal(forced.classes.size, 0);
  assert.equal(forced.events.size, 0);
  const stalled = run();
  stalled.expire();
  assert.equal(stalled.classes.size, 0);
});
