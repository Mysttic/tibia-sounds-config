'use strict';

/**
 * Generuje build/icon.png (256x256) bez zadnych zaleznosci graficznych.
 * electron-builder sam przerobi ten PNG na .ico dla Windows i .icns dla macOS.
 *
 * Ikona jest liczona per-piksel, wiec jest deterministyczna i wersjonowalna
 * jako kod, a nie jako binarka wrzucona "z palca".
 *
 * Uzycie: node tools/make-icon.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;

// paleta zgodna z motywem aplikacji (renderer/styles.css)
const BG = [30, 25, 19];
const BORDER = [58, 47, 36];
const GOLD = [201, 162, 39];
const GREEN = [143, 179, 57];

// --- prymitywy -------------------------------------------------------------

/** Odleglosc punktu od prostokata o zaokraglonych rogach (signed distance). */
function roundedRectDist(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Czy punkt lezy w trojkacie (wsp. barycentryczne). */
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
  const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
  return a >= 0 && b >= 0 && a + b <= 1;
}

/** Wycinek pierscienia - "fala dzwiekowa". */
function inArc(px, py, cx, cy, radius, thickness, maxAngleDeg) {
  const dx = px - cx;
  const dy = py - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(r - radius) > thickness / 2) return false;
  if (dx <= 0) return false;
  const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
  return angle <= maxAngleDeg;
}

function mix(dst, src, alpha, offset) {
  for (let i = 0; i < 3; i += 1) {
    dst[offset + i] = Math.round(dst[offset + i] * (1 - alpha) + src[i] * alpha);
  }
  dst[offset + 3] = Math.max(dst[offset + 3], Math.round(255 * alpha));
}

// --- rysowanie -------------------------------------------------------------

function renderPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4, 0);
  const SS = 3; // supersampling 3x3 - wystarcza na gladkie krawedzie

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const o = (y * SIZE + x) * 4;
      let bg = 0;
      let border = 0;
      let gold = 0;
      let green = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;

          const d = roundedRectDist(fx, fy, 128, 128, 122, 122, 40);
          if (d > 0) continue;
          if (d > -7) border += 1;
          else bg += 1;

          // glosnik: prostokat + trojkat
          const body = fx >= 62 && fx <= 96 && fy >= 106 && fy <= 150;
          const cone = inTriangle(fx, fy, [96, 128], [140, 76], [140, 180]);
          if (body || cone) gold += 1;

          // dwie fale
          if (inArc(fx, fy, 138, 128, 46, 11, 46)) gold += 1;
          if (inArc(fx, fy, 138, 128, 74, 11, 42)) green += 1;
        }
      }

      const total = SS * SS;
      if (bg + border > 0) mix(px, border > bg ? BORDER : BG, (bg + border) / total, o);
      if (gold > 0) mix(px, GOLD, Math.min(gold / total, 1), o);
      if (green > 0) mix(px, GREEN, Math.min(green / total, 1), o);
    }
  }
  return px;
}

// --- enkoder PNG -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filtr adaptacyjny
  ihdr[12] = 0; // bez przeplotu

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filtr None
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function main() {
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const png = encodePng(renderPixels(), SIZE);
  fs.writeFileSync(out, png);
  console.log(`zapisano ${out} (${SIZE}x${SIZE}, ${png.length} B)`);
}

module.exports = { encodePng, renderPixels, crc32, SIZE };

if (require.main === module) main();
