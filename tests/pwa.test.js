import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { isStandalone, isIosInstallable, registerServiceWorker, setupInstallButton } from '../src/pwa.js';

function fakeWindow({ standalone = false, fullscreen = false, protocol = 'https:' } = {}) {
  const listeners = new Map();
  return {
    location: { protocol },
    matchMedia: (q) => ({
      matches: (q.includes('standalone') && standalone) || (q.includes('fullscreen') && fullscreen),
    }),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    emit(type, ev = {}) {
      for (const fn of listeners.get(type) || []) fn(ev);
    },
  };
}

test('isStandalone and isIosInstallable detect installed vs browser sessions', () => {
  const win = fakeWindow();
  assert.equal(isStandalone(win, {}), false);
  assert.equal(isStandalone(fakeWindow({ standalone: true }), {}), true);
  assert.equal(isStandalone(fakeWindow({ fullscreen: true }), {}), true);
  assert.equal(isStandalone(win, { standalone: true }), true);

  assert.equal(isIosInstallable(win, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), true);
  assert.equal(isIosInstallable(win, { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(isIosInstallable(fakeWindow({ standalone: true }), { userAgent: 'Mozilla/5.0 (iPhone)' }), false);
  assert.equal(isIosInstallable(win, { userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), false);
});

test('registerServiceWorker registers ./sw.js only in top-level HTTP(S) contexts', async () => {
  const calls = [];
  const nav = {
    serviceWorker: {
      register: async (url, opts) => {
        calls.push([url, opts]);
        return { scope: './' };
      },
    },
  };
  const reg = await registerServiceWorker(nav, fakeWindow(), false);
  assert.deepEqual(reg, { scope: './' });
  assert.deepEqual(calls, [['./sw.js', { scope: './' }]]);

  // Embedded iframes (itch.io) and file:// URLs skip registration.
  assert.equal(await registerServiceWorker(nav, fakeWindow(), true), null);
  assert.equal(await registerServiceWorker(nav, fakeWindow({ protocol: 'file:' }), false), null);
  assert.equal(calls.length, 1);

  // Blocked service workers resolve to null instead of throwing.
  const throwingNav = {
    serviceWorker: { register: async () => { throw new Error('SecurityError'); } },
  };
  assert.equal(await registerServiceWorker(throwingNav, fakeWindow(), false), null);
});

test('setupInstallButton handles beforeinstallprompt, user choice and appinstalled', async () => {
  const win = fakeWindow();
  const button = { hidden: false, onclick: null };
  const note = { hidden: false, textContent: '' };
  const ctl = setupInstallButton({ button, note, win, nav: { userAgent: 'Chrome/130' }, iosHint: 'iOS hint' });
  assert.equal(button.hidden, true);
  assert.equal(note.hidden, true);

  let prevented = false;
  let prompted = false;
  win.emit('beforeinstallprompt', {
    preventDefault() { prevented = true; },
    async prompt() { prompted = true; },
    userChoice: Promise.resolve({ outcome: 'accepted' }),
  });
  assert.equal(prevented, true);
  assert.equal(button.hidden, false);

  const accepted = await ctl.trigger();
  assert.equal(prompted, true);
  assert.equal(accepted, true);
  assert.equal(button.hidden, true);

  // Re-triggered prompt followed by appinstalled event hides the button.
  win.emit('beforeinstallprompt', {
    preventDefault() {},
    async prompt() {},
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  });
  assert.equal(button.hidden, false);
  win.emit('appinstalled');
  assert.equal(button.hidden, true);
});

test('setupInstallButton shows Add-to-Home-Screen guidance on iOS and hides when embedded or standalone', async () => {
  const win = fakeWindow();
  const button = { hidden: true, onclick: null };
  const note = { hidden: true, textContent: '' };
  const nav = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)' };
  setupInstallButton({ button, note, win, nav, iosHint: () => 'Add to Home Screen' });
  assert.equal(button.hidden, false);
  assert.equal(note.hidden, true);

  button.onclick();
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Add to Home Screen');
  button.onclick();
  assert.equal(note.hidden, true);

  // Embedded or already-installed sessions keep the button hidden.
  const b2 = { hidden: false };
  setupInstallButton({ button: b2, win, nav, embedded: true });
  assert.equal(b2.hidden, true);
  const b3 = { hidden: false };
  setupInstallButton({ button: b3, win: fakeWindow({ standalone: true }), nav });
  assert.equal(b3.hidden, true);
});

test('manifest, icons and index.html PWA links are valid and complete', () => {
  const html = readFileSync('index.html', 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(html, /<link rel="apple-touch-icon" href="\.\/apple-touch-icon\.png"/);

  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.short_name, 'Dusk Kart');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 3);

  for (const icon of manifest.icons) {
    const file = `public/${icon.src.replace(/^\.\//, '')}`;
    assert.ok(existsSync(file), `missing icon ${file}`);
    if (icon.type === 'image/png') {
      const buf = readFileSync(file);
      assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      assert.equal(`${w}x${h}`, icon.sizes);
    }
  }
  const touchIcon = readFileSync('public/apple-touch-icon.png');
  assert.equal(touchIcon.readUInt32BE(16), 180);
  assert.equal(touchIcon.readUInt32BE(20), 180);
  assert.ok(existsSync('public/sw.js'));
});
