/**
 * Progressive Web App helpers: service-worker registration and the main-menu
 * install button (`beforeinstallprompt` on Chromium + "Add to Home Screen"
 * guidance on iOS/iPadOS Safari).
 */

/** True when the game is already running as an installed app window. */
export function isStandalone(win = window, nav = navigator) {
  if (nav?.standalone === true) return true;
  if (win?.matchMedia?.('(display-mode: standalone)')?.matches) return true;
  if (win?.matchMedia?.('(display-mode: fullscreen)')?.matches) return true;
  return false;
}

/** True on iPhone/iPad browsers when not yet launched from the Home Screen. */
export function isIosInstallable(win = window, nav = navigator) {
  const ua = String(nav?.userAgent || '');
  const ios = /\b(iPad|iPhone|iPod)\b/i.test(ua) || (nav?.platform === 'MacIntel' && Number(nav?.maxTouchPoints) > 1);
  return ios && !isStandalone(win, nav);
}

/**
 * Registers `./sw.js` unless running inside an embedding iframe (e.g. itch.io)
 * or on a non-HTTP(S) scheme. Rejections (blocked storage / private browsing)
 * are swallowed so they never break the game.
 */
export async function registerServiceWorker(nav = navigator, win = window, embedded = false) {
  if (embedded || !nav?.serviceWorker?.register) return null;
  const proto = win?.location?.protocol;
  if (proto && proto !== 'https:' && proto !== 'http:') return null;
  try {
    return await nav.serviceWorker.register('./sw.js', { scope: './' });
  } catch {
    return null;
  }
}

/**
 * Wires the main-menu install button (`#btn-install`) and optional hint note
 * (`#install-note`). Hidden by default; shown when Chromium fires
 * `beforeinstallprompt` or on iOS where manual "Add to Home Screen" applies.
 */
export function setupInstallButton({ button, note = null, win = window, nav = navigator, embedded = false, iosHint = '' } = {}) {
  if (!button) return { trigger: async () => false };
  button.hidden = true;
  if (note) note.hidden = true;
  if (embedded || isStandalone(win, nav)) return { trigger: async () => false };

  let deferred = null;
  if (isIosInstallable(win, nav)) button.hidden = false;

  win?.addEventListener?.('beforeinstallprompt', (e) => {
    e.preventDefault?.();
    deferred = e;
    button.hidden = false;
    if (note) note.hidden = true;
  });

  win?.addEventListener?.('appinstalled', () => {
    deferred = null;
    button.hidden = true;
    if (note) note.hidden = true;
  });

  const trigger = async () => {
    if (deferred) {
      const promptEvent = deferred;
      deferred = null;
      try {
        await promptEvent.prompt?.();
        const choice = await promptEvent.userChoice;
        button.hidden = true;
        if (note) note.hidden = true;
        return choice?.outcome === 'accepted';
      } catch {
        button.hidden = true;
        return false;
      }
    }
    if (isIosInstallable(win, nav) && note) {
      note.textContent = typeof iosHint === 'function' ? iosHint() : String(iosHint);
      note.hidden = !note.hidden;
    }
    return false;
  };

  button.onclick = () => { trigger(); };
  return { trigger };
}
