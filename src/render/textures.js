import * as THREE from 'three';
import { mulberry32 } from '../sim/math.js';

/** All textures are painted at runtime on canvases – no external assets. */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

function speckle(ctx, w, h, rand, n, colors, maxR = 1.6) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(rand() * colors.length) | 0];
    const r = 0.4 + rand() * maxR;
    ctx.fillRect(rand() * w, rand() * h, r, r);
  }
}

/** Road surface: u = across (0..1 over the full width), v = along (1 tile = 9 m). */
export function roadTexture() {
  const [c, x] = canvas(1024, 1024);
  const rand = mulberry32(11);
  x.fillStyle = '#44464b';
  x.fillRect(0, 0, 1024, 1024);
  speckle(x, 1024, 1024, rand, 90000, ['#3a3c40', '#505257', '#5a5c60', '#34363a', '#606368'], 2.2);
  // Patches / resurfacing.
  for (let i = 0; i < 16; i++) {
    x.fillStyle = `rgba(${rand() < 0.5 ? '30,31,34' : '80,82,86'},${0.05 + rand() * 0.08})`;
    x.beginPath();
    x.ellipse(rand() * 1024, rand() * 1024, 40 + rand() * 160, 20 + rand() * 90, rand() * 3, 0, Math.PI * 2);
    x.fill();
  }
  // Cracks.
  x.strokeStyle = 'rgba(20,20,22,0.55)';
  x.lineWidth = 1.2;
  for (let i = 0; i < 14; i++) {
    let px = rand() * 1024, py = rand() * 1024;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 8; k++) { px += (rand() - 0.5) * 50; py += (rand() - 0.2) * 40; x.lineTo(px, py); }
    x.stroke();
  }
  // White edge lines (12 cm on a 9 m road).
  x.fillStyle = 'rgba(235,235,230,0.92)';
  x.fillRect(4, 0, 14, 1024);
  x.fillRect(1024 - 18, 0, 14, 1024);
  // Wear on the edge lines.
  speckle(x, 30, 1024, rand, 1500, ['#44464b', '#505257']);
  x.save(); x.translate(1024 - 30, 0); speckle(x, 30, 1024, rand, 1500, ['#44464b', '#505257']); x.restore();
  return toTexture(c);
}

export function concreteTexture() {
  const [c, x] = canvas(256, 256);
  const rand = mulberry32(5);
  x.fillStyle = '#6b6a66';
  x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, rand, 9000, ['#77756f', '#5f5e5a', '#838178', '#56554f'], 1.8);
  x.strokeStyle = 'rgba(40,40,40,0.35)';
  x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, 128); x.lineTo(256, 128); x.stroke();
  return toTexture(c);
}

/** Red/white curb stripes, one period = 2 tiles along v. */
export function curbTexture() {
  const [c, x] = canvas(64, 256);
  x.fillStyle = '#d42121'; x.fillRect(0, 0, 64, 128);
  x.fillStyle = '#f2f2ee'; x.fillRect(0, 128, 64, 128);
  const rand = mulberry32(3);
  speckle(x, 64, 256, rand, 900, ['rgba(0,0,0,0.12)', 'rgba(255,255,255,0.08)'], 2);
  return toTexture(c);
}

/** Soft dark streak for the rubbered-in racing line and skid marks. */
export function rubberTexture() {
  const [c, x] = canvas(128, 512);
  const rand = mulberry32(9);
  const g = x.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.25, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 512);
  x.globalCompositeOperation = 'destination-out';
  speckle(x, 128, 512, rand, 7000, ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.25)'], 2.5);
  return toTexture(c, { srgb: false });
}

export function checkerTexture() {
  const [c, x] = canvas(256, 64);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
    x.fillStyle = (i + j) % 2 ? '#111' : '#eee';
    x.fillRect(i * 16, j * 16, 16, 16);
  }
  return toTexture(c, { repeat: false });
}

export function grassTexture() {
  const [c, x] = canvas(512, 512);
  const rand = mulberry32(21);
  x.fillStyle = '#2d3a22';
  x.fillRect(0, 0, 512, 512);
  speckle(x, 512, 512, rand, 60000, ['#35452a', '#263220', '#3d4b2c', '#2f3a24', '#4a4a32'], 2.5);
  for (let i = 0; i < 30; i++) {
    x.fillStyle = `rgba(70,60,40,${0.08 + rand() * 0.1})`;
    x.beginPath();
    x.ellipse(rand() * 512, rand() * 512, 20 + rand() * 60, 10 + rand() * 40, rand() * 3, 0, Math.PI * 2);
    x.fill();
  }
  return toTexture(c);
}

export function lotTexture() {
  const [c, x] = canvas(256, 256);
  const rand = mulberry32(31);
  x.fillStyle = '#2c2d31';
  x.fillRect(0, 0, 256, 256);
  speckle(x, 256, 256, rand, 12000, ['#35363a', '#26272a', '#3d3e42'], 1.5);
  return toTexture(c);
}

export function chainLinkTexture() {
  const [c, x] = canvas(64, 64);
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(200,205,210,0.9)';
  x.lineWidth = 1.5;
  x.beginPath();
  x.moveTo(0, 0); x.lineTo(64, 64);
  x.moveTo(64, 0); x.lineTo(0, 64);
  x.moveTo(-32, 0); x.lineTo(32, 64); x.moveTo(32, 0); x.lineTo(96, 64);
  x.moveTo(32, 0); x.lineTo(-32, 64); x.moveTo(96, 0); x.lineTo(32, 64);
  x.stroke();
  return toTexture(c, { srgb: true, aniso: 4 });
}

/** Radial falloff used for fake light pools under lamps and neon glow. */
export function glowTexture(rgb = [255, 220, 160], alpha = 0.55) {
  const [c, x] = canvas(128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = (k) => `rgba(${rgb.join(',')},${(alpha * k).toFixed(3)})`;
  g.addColorStop(0, col(1));
  g.addColorStop(0.45, col(0.35));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return toTexture(c, { repeat: false });
}

export function windowsTexture(seed = 1) {
  const [c, x] = canvas(256, 512);
  const rand = mulberry32(seed);
  x.fillStyle = '#15171c';
  x.fillRect(0, 0, 256, 512);
  for (let r = 0; r < 32; r++) {
    for (let k = 0; k < 8; k++) {
      if (rand() < 0.45) continue;
      const warm = rand();
      x.fillStyle = warm < 0.7 ? `rgba(255,${200 + rand() * 40 | 0},${120 + rand() * 60 | 0},${0.5 + rand() * 0.5})` : `rgba(170,210,255,${0.4 + rand() * 0.4})`;
      x.fillRect(8 + k * 31, 6 + r * 16, 18, 9);
    }
  }
  return toTexture(c);
}

/** Front number panel: team colour, big white number. */
export function numberPanelTexture(number, color) {
  const [c, x] = canvas(512, 256);
  x.fillStyle = color;
  x.fillRect(0, 0, 512, 256);
  const g = x.createLinearGradient(0, 0, 512, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#fff';
  x.font = 'italic 900 190px "Arial Black", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(number), 256, 138);
  x.font = 'bold 34px Arial, sans-serif';
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillText('DUSK KART', 256, 30);
  return toTexture(c, { repeat: false });
}

/** Side-pod livery: dark base, team-colour sweep, white stripe and a number. */
export function sidePodTexture(number, color) {
  const [c, x] = canvas(512, 128);
  x.fillStyle = '#16181d';
  x.fillRect(0, 0, 512, 128);
  x.fillStyle = color;
  x.beginPath();
  x.moveTo(0, 128); x.lineTo(0, 40); x.bezierCurveTo(160, 20, 300, 70, 512, 30); x.lineTo(512, 128); x.fill();
  x.fillStyle = '#f4f4f4';
  x.beginPath();
  x.moveTo(250, 128); x.lineTo(300, 0); x.lineTo(380, 0); x.lineTo(330, 128); x.fill();
  x.fillStyle = '#16181d';
  x.font = 'italic 900 64px "Arial Black", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.save(); x.translate(315, 66); x.rotate(-1.18); x.fillText(String(number), 0, 0); x.restore();
  // Safety pictograms like on real rental karts.
  for (let i = 0; i < 3; i++) {
    const cx = 420 + i * 30, cy = 92;
    x.fillStyle = '#fff'; x.beginPath(); x.arc(cx, cy, 12, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#d11'; x.lineWidth = 4; x.beginPath(); x.arc(cx, cy, 10, 0, Math.PI * 2); x.moveTo(cx - 7, cy - 7); x.lineTo(cx + 7, cy + 7); x.stroke();
  }
  return toTexture(c, { repeat: false });
}

/** Centre plate of the steering wheel with warning pictograms. */
export function wheelHubTexture() {
  const [c, x] = canvas(256, 256);
  x.fillStyle = '#1b1c20';
  x.fillRect(0, 0, 256, 256);
  const icons = [[128, 70], [70, 170], [186, 170]];
  for (const [cx, cy] of icons) {
    x.fillStyle = '#f5f5f5'; x.beginPath(); x.arc(cx, cy, 30, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#d31515'; x.lineWidth = 8; x.beginPath(); x.arc(cx, cy, 26, 0, Math.PI * 2); x.moveTo(cx - 18, cy - 18); x.lineTo(cx + 18, cy + 18); x.stroke();
    x.fillStyle = '#222'; x.fillRect(cx - 6, cy - 12, 12, 20);
  }
  return toTexture(c, { repeat: false });
}

const BOOTH_WORDS = ['PRIZES', 'CANDY', 'GAMES', 'HOT DOGS', 'RING TOSS', 'SHOOT', 'DONUTS', 'LUCKY'];

export function boothSignTexture(i, hue) {
  const [c, x] = canvas(512, 128);
  x.fillStyle = `hsl(${hue},80%,18%)`;
  x.fillRect(0, 0, 512, 128);
  x.strokeStyle = `hsl(${(hue + 40) % 360},100%,70%)`;
  x.lineWidth = 8;
  x.strokeRect(6, 6, 500, 116);
  x.fillStyle = `hsl(${(hue + 180) % 360},100%,75%)`;
  x.font = '900 70px "Arial Black", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(BOOTH_WORDS[i % BOOTH_WORDS.length], 256, 68);
  return toTexture(c, { repeat: false });
}

export function stripeTexture(a, b, n = 8) {
  const [c, x] = canvas(256, 64);
  for (let i = 0; i < n; i++) {
    x.fillStyle = i % 2 ? a : b;
    x.fillRect((i * 256) / n, 0, 256 / n + 1, 64);
  }
  return toTexture(c);
}

export function bannerTexture(text, bg = '#101820', fg = '#ffb347') {
  const [c, x] = canvas(1024, 128);
  x.fillStyle = bg;
  x.fillRect(0, 0, 1024, 128);
  x.fillStyle = fg;
  x.font = 'italic 900 88px "Arial Black", Arial, sans-serif';
  // Course names differ in length: shrink to fit rather than clip.
  const w = x.measureText(text).width;
  if (w > 980) x.font = `italic 900 ${Math.floor(88 * 980 / w)}px "Arial Black", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 512, 68);
  return toTexture(c, { repeat: false });
}

export function nameTagTexture(name, color) {
  const [c, x] = canvas(256, 64);
  x.fillStyle = 'rgba(10,12,18,0.72)';
  x.beginPath();
  x.roundRect(4, 8, 248, 48, 12);
  x.fill();
  x.fillStyle = color;
  x.fillRect(14, 20, 8, 24);
  x.fillStyle = '#fff';
  x.font = 'bold 28px Arial, sans-serif';
  x.textBaseline = 'middle';
  x.fillText(name.slice(0, 14), 32, 33);
  return toTexture(c, { repeat: false });
}
