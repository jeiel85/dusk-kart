import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityTuner } from '../src/perf.js';

const run = (tuner, seconds, { fps = 60, driving = true, scale = 1 } = {}) => {
  let verdict = null;
  for (let i = 0; i < seconds * fps; i++) verdict = tuner.sample(1 / fps, driving, typeof scale === 'function' ? scale(i / fps) : scale) || verdict;
  return verdict;
};

test('a device with headroom gets one step up after 20 s of driving', () => {
  const t = new QualityTuner('low', 'high');
  assert.equal(run(t, 19), null, 'not before the window');
  assert.deepEqual(run(t, 2), { quality: 'medium', ceiling: 'high' });
  assert.equal(run(t, 60), null, 'one verdict per load');
});

test('only driving time counts', () => {
  const t = new QualityTuner('low', 'high');
  assert.equal(run(t, 120, { driving: false }), null);
  assert.equal(run(t, 10), null);
  assert.ok(run(t, 11));
});

test('no step up at the ceiling, at top quality, or without real headroom', () => {
  assert.equal(run(new QualityTuner('medium', 'medium'), 25), null);
  assert.equal(run(new QualityTuner('high', 'high'), 25), null);
  assert.equal(run(new QualityTuner('low', 'high'), 25, { fps: 50 }), null, 'below 57 fps');
  assert.equal(run(new QualityTuner('low', 'high'), 25, { scale: (t) => (t > 10 && t < 12 ? 0.85 : 1) }), null, 'governor had to step down once');
});

test('a struggling device steps down at once and caps the ceiling there', () => {
  const t = new QualityTuner('high', 'high');
  assert.deepEqual(run(t, 8, { scale: (s) => (s < 3 ? 1 : s < 6 ? 0.85 : 0.7) }), { quality: 'medium', ceiling: 'medium' });
  assert.equal(run(new QualityTuner('low', 'high'), 8, { scale: 0.6 }), null, 'nothing below low');
});

test('hitches and hidden-tab gaps are ignored', () => {
  const t = new QualityTuner('low', 'high');
  for (let i = 0; i < 100; i++) assert.equal(t.sample(0.5, true, 1), null);
  assert.equal(t.time, 0);
});
