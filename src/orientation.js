/**
 * Phone screen orientation. Browsers only let a page lock the orientation
 * while it is fullscreen (Android Chrome), so locking enters fullscreen
 * first. iOS Safari and desktops refuse the lock; the player then rotates the
 * device by hand and the layout follows.
 */
export const ORIENTATION_LABELS = { auto: '기기 방향 따라가기', landscape: '가로', portrait: '세로' };

/**
 * What the HUD button asks for. While a chosen orientation is in force it
 * flips to the other one; once the lock has been dropped (fullscreen left)
 * the first press restores the saved choice instead of flipping away from it.
 */
export function buttonTarget(saved, fullscreen, portraitNow) {
  if (saved !== 'auto' && !fullscreen) return saved;
  return portraitNow ? 'landscape' : 'portrait';
}

/**
 * Resolves once the lock holds: when lock() settles, or when the screen has
 * turned to `target` — Android Chrome (154) rotates portrait → landscape but
 * never settles that lock() promise. Rejects if neither happens in `ms`.
 */
function lockSettled(o, target, ms) {
  return new Promise((resolve, reject) => {
    const turned = () => String(o.type || '').startsWith(target);
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      o.removeEventListener?.('change', onChange);
      fn(v);
    };
    const onChange = () => { if (turned()) finish(resolve); };
    o.addEventListener?.('change', onChange);
    const timer = setTimeout(() => (turned() ? finish(resolve) : finish(reject, new Error('orientation lock timed out'))), ms);
    o.lock(target).then(() => finish(resolve), (e) => finish(reject, e));
  });
}

/**
 * @param target 'auto' | 'landscape' | 'portrait'
 * @returns {Promise<boolean>} false when the browser refuses the lock
 */
export async function applyOrientation(target, doc = document, scr = screen, timeoutMs = 2000) {
  const o = scr.orientation;
  if (target === 'auto') {
    // unlock() throws where locking was never supported; nothing to release then.
    try { o?.unlock?.(); } catch { /* not supported */ }
    return true;
  }
  if (!o?.lock) return false;
  let entered = false;
  try {
    if (!doc.fullscreenElement && doc.documentElement.requestFullscreen) {
      await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
      entered = true;
    }
    await lockSettled(o, target, timeoutMs);
    return true;
  } catch {
    // Don't leave the player in a fullscreen they only got as a means to the lock.
    if (entered) await doc.exitFullscreen?.().catch(() => {});
    return false;
  }
}
