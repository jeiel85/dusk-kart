export function fmtTime(t) {
  if (t === null || t === undefined || !Number.isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

const $ = (sel) => document.querySelector(sel);

const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
/** In-race control hints, one set per input device. */
export const KEY_GUIDES = {
  keyboard: [
    [k('W', '↑'), '가속'], [k('S', '↓'), '브레이크'], [k('A', 'D'), '조향'],
    [k('C'), '카메라'], [k('R'), '트랙 복귀'], [k('Esc'), '일시정지'], [k('H'), '안내 숨기기'],
  ],
  pad: [
    [k('RT'), '가속'], [k('LT'), '브레이크'], [k('L 스틱'), '조향'],
    [k('Y'), '카메라'], [k('Back'), '트랙 복귀'], [k('Start'), '일시정지'],
  ],
  touch: [
    ['왼쪽 드래그', '조향'], [k('GAS'), '가속'], [k('BRAKE'), '브레이크 · 정지 중 길게 = 후진'],
    [k('🎥'), '카메라'], [k('🔄'), '가로/세로'], [k('❚❚'), '일시정지'],
  ],
};

/** DOM heads-up display: timing, speedo, standings, minimap, banners. */
export class Hud {
  constructor(track, line) {
    this.el = $('#hud');
    this.pos = $('#hud-pos');
    this.lap = $('#hud-lap');
    this.cur = $('#hud-cur');
    this.last = $('#hud-last');
    this.best = $('#hud-best');
    this.speed = $('#hud-speed');
    this.rpm = $('#hud-rpm');
    this.board = $('#hud-board');
    this.banner = $('#hud-banner');
    this.toast = $('#hud-toast');
    this.lights = [...document.querySelectorAll('#hud-lights i')];
    this.lightsBox = $('#hud-lights');
    this.net = $('#hud-net');
    this.map = $('#hud-map');
    this.mapCtx = this.map.getContext('2d');
    this.track = track;
    this.prepareMap(line);
    this.bannerUntil = 0;
    this.toastUntil = 0;
    this.lastBoard = '';
    this.keys = $('#hud-keys');
    this.keysDevice = null;
    this.keysUntil = 0;
  }

  show(on) { this.el.hidden = !on; }

  prepareMap(line) {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.count; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const W = this.map.width, H = this.map.height, pad = 14;
    const sc = Math.min((W - 2 * pad) / (maxX - minX), (H - 2 * pad) / (maxZ - minZ));
    // True top-down view: +X right, +Z down (three.js is right-handed, Y up).
    const ox = pad + ((W - 2 * pad) - (maxX - minX) * sc) / 2;
    const oy = pad + ((H - 2 * pad) - (maxZ - minZ) * sc) / 2;
    this.toMap = (x, z) => [ox + (x - minX) * sc, oy + (z - minZ) * sc];
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const c = bg.getContext('2d');
    c.lineJoin = c.lineCap = 'round';
    const path = () => {
      c.beginPath();
      for (let i = 0; i <= t.count; i++) {
        const k = i % t.count;
        const [x, y] = this.toMap(t.px[k], t.pz[k]);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
    };
    c.strokeStyle = 'rgba(0,0,0,0.55)'; c.lineWidth = 11; path(); c.stroke();
    c.strokeStyle = 'rgba(235,238,245,0.9)'; c.lineWidth = 6; path(); c.stroke();
    c.strokeStyle = 'rgba(60,64,72,1)'; c.lineWidth = 3.5; path(); c.stroke();
    const [sx, sy] = this.toMap(t.px[0], t.pz[0]);
    c.fillStyle = '#fff'; c.fillRect(sx - 1.5, sy - 6, 3, 12);
    this.mapBg = bg;
  }

  drawMap(dots) {
    const c = this.mapCtx;
    c.clearRect(0, 0, this.map.width, this.map.height);
    c.drawImage(this.mapBg, 0, 0);
    for (const d of dots) {
      const [x, y] = this.toMap(d.x, d.z);
      c.beginPath();
      c.arc(x, y, d.me ? 5.5 : 4, 0, Math.PI * 2);
      c.fillStyle = d.color;
      c.fill();
      c.lineWidth = d.me ? 2.5 : 1.5;
      c.strokeStyle = d.me ? '#fff' : 'rgba(0,0,0,0.7)';
      c.stroke();
    }
  }

  update({ pos, total, lap, laps, cur, last, best, kmh, rpm }) {
    this.pos.innerHTML = pos ? `<b>P${pos}</b><small>/${total}</small>` : '';
    this.lap.textContent = laps > 0 ? `LAP ${Math.max(1, Math.min(lap, laps))}/${laps}` : `LAP ${Math.max(1, lap)}`;
    this.cur.textContent = fmtTime(cur);
    this.last.textContent = fmtTime(last);
    this.best.textContent = fmtTime(best);
    this.speed.textContent = String(Math.round(kmh));
    this.rpm.style.setProperty('--rpm', Math.min(1, rpm / 6600).toFixed(3));
  }

  standings(rows) {
    const html = rows.map((r, i) => `<li class="${r.me ? 'me' : ''}${r.finished ? ' fin' : ''}"><span>${i + 1}</span><i style="background:${r.color}"></i>${escapeHtml(r.name)}${r.finished ? ' 🏁' : ''}</li>`).join('');
    if (html !== this.lastBoard) { this.board.innerHTML = html; this.lastBoard = html; }
  }

  setLights(n, green, visible) {
    this.lightsBox.hidden = !visible;
    this.lights.forEach((l, k) => { l.className = green ? 'g' : k < n ? 'r' : ''; });
  }

  flash(text, ms = 1600, cls = '') {
    this.banner.textContent = text;
    this.banner.className = `show ${cls}`;
    this.bannerUntil = performance.now() + ms;
  }

  info(text, ms = 1400) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this.toastUntil = performance.now() + ms;
  }

  netStatus(text) {
    this.net.textContent = text || '';
    this.net.hidden = !text;
  }

  /** Fill the control hints for the player's current input device. */
  keyGuide(device) {
    if (device === this.keysDevice || !KEY_GUIDES[device]) return;
    this.keysDevice = device;
    this.keys.innerHTML = KEY_GUIDES[device].map(([keys, what]) => `<span>${keys} ${what}</span>`).join('');
  }

  /** Show the control hints; with `ms` they fade out on their own after that long. */
  showKeys(on, ms = 0) {
    this.keys.classList.toggle('show', on);
    this.keysUntil = on && ms > 0 ? performance.now() + ms : 0;
  }

  toggleKeys() { this.showKeys(!this.keys.classList.contains('show')); }

  /** Let hints that are still up fade out after `ms` (no-op if the player hid them). */
  fadeKeys(ms) { if (this.keys.classList.contains('show')) this.showKeys(true, ms); }

  tick() {
    const t = performance.now();
    if (this.keysUntil && t > this.keysUntil) this.showKeys(false);
    if (this.bannerUntil && t > this.bannerUntil) { this.banner.className = ''; this.bannerUntil = 0; }
    if (this.toastUntil && t > this.toastUntil) { this.toast.classList.remove('show'); this.toastUntil = 0; }
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
