import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrientation, buttonTarget } from '../src/orientation.js';

function fakeEnv({ lock = 'ok', fullscreen = 'ok', unlockThrows = false } = {}) {
  const calls = [];
  const doc = {
    fullscreenElement: null,
    exitFullscreen: async () => { calls.push(['exit']); doc.fullscreenElement = null; },
    documentElement: {
      requestFullscreen: async (opts) => {
        calls.push(['fullscreen', opts]);
        if (fullscreen !== 'ok') throw new Error('denied');
        doc.fullscreenElement = doc.documentElement;
      },
    },
  };
  const orientation = lock === 'missing' ? {} : {
    lock: async (t) => { calls.push(['lock', t]); if (lock !== 'ok') throw new Error('NotSupportedError'); },
    unlock: () => { calls.push(['unlock']); if (unlockThrows) throw new Error('unsupported'); },
  };
  return { doc, scr: { orientation }, calls };
}

test('the button flips orientation, or restores a dropped lock first', () => {
  // Following the device, or locked in fullscreen: flip.
  assert.equal(buttonTarget('auto', false, true), 'landscape');
  assert.equal(buttonTarget('auto', true, false), 'portrait');
  assert.equal(buttonTarget('landscape', true, false), 'portrait');
  assert.equal(buttonTarget('portrait', true, true), 'landscape');
  // Lock dropped (fullscreen left): restore the saved choice, whatever the device shows.
  assert.equal(buttonTarget('landscape', false, false), 'landscape');
  assert.equal(buttonTarget('landscape', false, true), 'landscape');
  assert.equal(buttonTarget('portrait', false, false), 'portrait');
});

test('locking enters fullscreen first, then locks; already fullscreen skips it', async () => {
  const e = fakeEnv();
  assert.equal(await applyOrientation('landscape', e.doc, e.scr), true);
  assert.deepEqual(e.calls.map((c) => c[0]), ['fullscreen', 'lock']);
  assert.equal(e.calls[1][1], 'landscape');
  assert.equal(await applyOrientation('portrait', e.doc, e.scr), true);
  assert.deepEqual(e.calls.slice(2), [['lock', 'portrait']]);
});

test('browsers that refuse report false instead of throwing', async () => {
  for (const env of [fakeEnv({ lock: 'missing' }), fakeEnv({ lock: 'reject' }), fakeEnv({ fullscreen: 'reject' })]) {
    assert.equal(await applyOrientation('landscape', env.doc, env.scr), false);
  }
  // A refused lock backs out of the fullscreen it entered for it.
  const refused = fakeEnv({ lock: 'reject' });
  await applyOrientation('landscape', refused.doc, refused.scr);
  assert.deepEqual(refused.calls.map((c) => c[0]), ['fullscreen', 'lock', 'exit']);
  assert.equal(refused.doc.fullscreenElement, null);
  const iosLike = { doc: fakeEnv().doc, scr: {} };
  assert.equal(await applyOrientation('portrait', iosLike.doc, iosLike.scr), false);
});

test('auto releases the lock, even where unlock is unsupported', async () => {
  const e = fakeEnv();
  assert.equal(await applyOrientation('auto', e.doc, e.scr), true);
  assert.deepEqual(e.calls, [['unlock']]);
  const bad = fakeEnv({ unlockThrows: true });
  assert.equal(await applyOrientation('auto', bad.doc, bad.scr), true);
  assert.equal(await applyOrientation('auto', bad.doc, {}), true);
});
