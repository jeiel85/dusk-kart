// Builds the PWA icon set in public/ (SVG + 180/192/512 PNGs, standard and
// maskable) with plain Node and zlib — no image dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: None
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Signed distance to a rounded box centered at (0, 0) with half-size b and corner radius r.
function sdRoundBox(px, py, b, r) {
  const qx = Math.abs(px) - b + r;
  const qy = Math.abs(py) - b + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Signed distance to a segment from (ax, ay) to (bx, by).
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = px - ax, vy = py - ay;
  const ux = bx - ax, uy = by - ay;
  const h = clamp01((vx * ux + vy * uy) / (ux * ux + uy * uy));
  return Math.hypot(vx - ux * h, vy - uy * h);
}

/**
 * Renders the Dusk Kart steering-wheel mark onto a size×size RGBA buffer.
 * Coordinates are normalized to [-1, 1]; `maskable` fills the full square and
 * scales the emblem into the 80% safe zone.
 */
function renderIcon(size, { maskable = false, rounded = true } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 2 / size;
  const scale = maskable ? 0.82 : 1;
  for (let y = 0; y < size; y++) {
    const ny = ((y + 0.5) / size) * 2 - 1;
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const boxAlpha = rounded && !maskable ? 1 - smooth(-aa, aa, sdRoundBox(nx, ny, 1, 0.4375)) : 1;
      if (boxAlpha <= 0) continue;

      const sx = nx / scale;
      const sy = (ny - 0.04 * scale) / scale;

      // Base dusk navy (#0d1426) with a warm sunset glow from the top-left.
      const glow = Math.max(0, 1 - Math.hypot(nx + 0.35, ny + 0.45) * 0.9);
      let r = 13 + glow * 28;
      let g = 20 + glow * 14;
      let b = 38 + glow * 18;

      const mix = (cr, cg, cb, a) => {
        const k = clamp01(a);
        r += (cr - r) * k;
        g += (cg - g) * k;
        b += (cb - b) * k;
      };

      // Horizontal + lower spoke in crisp white (#eef1f7).
      const dBar = sdSegment(sx, sy, -0.48, 0, 0.48, 0) - 0.062;
      const dStem = sdSegment(sx, sy, 0, 0, 0, 0.46) - 0.058;
      const spoke = 1 - smooth(-aa / scale, aa / scale, Math.min(dBar, dStem));
      mix(238, 241, 247, spoke);

      // Outer steering-wheel ring in dusk orange (#ff7a1a).
      const rad = Math.hypot(sx, sy);
      const dRing = Math.abs(rad - 0.5) - 0.095;
      const ring = 1 - smooth(-aa / scale, aa / scale, dRing);
      mix(255, 122, 26, ring);

      // Cyan top-center marker (#37c6ff) on the wheel rim.
      const dMark = sdSegment(sx, sy, 0, -0.405, 0, -0.595) - 0.042;
      const mark = (1 - smooth(-aa / scale, aa / scale, dMark)) * ring;
      mix(55, 198, 255, mark);

      // Center hub (#0d1426 core with orange cap).
      const hubOuter = 1 - smooth(-aa / scale, aa / scale, rad - 0.13);
      mix(13, 20, 38, hubOuter);
      const hubInner = 1 - smooth(-aa / scale, aa / scale, rad - 0.065);
      mix(255, 122, 26, hubInner);

      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(clamp01(r / 255) * 255);
      buf[idx + 1] = Math.round(clamp01(g / 255) * 255);
      buf[idx + 2] = Math.round(clamp01(b / 255) * 255);
      buf[idx + 3] = Math.round(boxAlpha * 255);
    }
  }
  return encodePng(size, size, buf);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="g" cx="32%" cy="28%" r="70%">
      <stop offset="0%" stop-color="#292238"/>
      <stop offset="100%" stop-color="#0d1426"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <path d="M16 33.3h32M32 33.3v15" stroke="#eef1f7" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32" cy="33.3" r="16" fill="none" stroke="#ff7a1a" stroke-width="6"/>
  <path d="M32 14.3v6" stroke="#37c6ff" stroke-width="3" stroke-linecap="round"/>
  <circle cx="32" cy="33.3" r="4.2" fill="#0d1426"/>
  <circle cx="32" cy="33.3" r="2.1" fill="#ff7a1a"/>
</svg>
`;

writeFileSync('public/icon.svg', svg);
writeFileSync('public/icon-192.png', renderIcon(192));
writeFileSync('public/icon-512.png', renderIcon(512));
writeFileSync('public/icon-maskable-512.png', renderIcon(512, { maskable: true, rounded: false }));
writeFileSync('public/apple-touch-icon.png', renderIcon(180, { rounded: false }));
console.log('PWA icons generated in public/');
