import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrientation, buttonTarget } from '../src/orientation.js';

function fakeEnv({ lock = 'ok', fullscreen = 'ok', unlockThrows = false, type = 'portrait-primary' } = {}) {
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
  const listeners = new Set();
  const orientation = lock === 'missing' ? {} : {
    type,
    addEventListener: (ev, fn) => listeners.add(fn),
    removeEventListener: (ev, fn) => listeners.delete(fn),
    lock: (t) => {
      calls.push(['lock', t]);
      if (lock === 'reject') return Promise.reject(new Error('NotSupportedError'));
      if (lock === 'hang-turns') {
        // Android Chrome: the screen turns, the promise never settles.
        setTimeout(() => { orientation.type = `${t}-primary`; for (const fn of [...listeners]) fn(); }, 5);
        return new Promise(() => {});
      }
      if (lock === 'hang') return new Promise(() => {});
      return Promise.resolve();
    },
    unlock: () => { calls.push(['unlock']); if (unlockThrows) throw new Error('unsupported'); },
  };
  orientation.listeners = listeners;
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

test('a lock() that never settles counts once the screen has turned', async () => {
  const e = fakeEnv({ lock: 'hang-turns' });
  assert.equal(await applyOrientation('landscape', e.doc, e.scr, 200), true);
  assert.equal(e.scr.orientation.listeners.size, 0, 'change listener removed');
  // Never settles and never turns: give up, and leave the fullscreen it entered.
  const stuck = fakeEnv({ lock: 'hang' });
  assert.equal(await applyOrientation('landscape', stuck.doc, stuck.scr, 30), false);
  assert.deepEqual(stuck.calls.map((c) => c[0]), ['fullscreen', 'lock', 'exit']);
  // Already showing the target when the timeout hits: that's a hold, not a failure.
  const already = fakeEnv({ lock: 'hang', type: 'landscape-secondary' });
  assert.equal(await applyOrientation('landscape', already.doc, already.scr, 30), true);
});

test('auto releases the lock, even where unlock is unsupported', async () => {
  const e = fakeEnv();
  assert.equal(await applyOrientation('auto', e.doc, e.scr), true);
  assert.deepEqual(e.calls, [['unlock']]);
  const bad = fakeEnv({ unlockThrows: true });
  assert.equal(await applyOrientation('auto', bad.doc, bad.scr), true);
  assert.equal(await applyOrientation('auto', bad.doc, {}), true);
});
