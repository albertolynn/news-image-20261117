// "The World in One Day" — Tuesday 17 November 2026.
//
// A Node program (standard library only, no network) that draws a one-page
// news front page for Tuesday 17 November 2026 and writes it as a PNG to
// <output>/entry.png. Everything is rasterised by hand: a small PNG encoder
// over an RGB pixel buffer, 2x supersampling for clean edges, and a vector
// stroke font defined below, glyph by glyph.
//
// Stories shown (all reported on 17 Nov 2026):
//   LEAD    Ukraine hits the Crimea Bridge in the biggest drone attack of
//           the war (Reuters / AFP, 17 Nov).
//   PANEL   US jets strike an IRGC site on Iran's Qeshm Island in the Strait
//           of Hormuz, replying to a drone attack on a US radar in Bahrain.
//   PANEL   China confirms the first Xi-Trump-Putin trilateral summit,
//           Shenzhen, 19 Nov.
//   PANEL   Oil, gold and stocks fall worldwide; Nasdaq in correction.
//   PANEL   PAHO ends the United States' 26-year measles elimination status.
//   STRIP   COP31 draft deal urges a faster exit from fossil fuels.
//   TICKER  Pattinson named the new James Bond; Ebola cases double in DR
//           Congo; five EU nations plan a Rwanda migrant hub.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/* ------------------------------------------------------------------ */
/* PNG encoder                                                         */
/* ------------------------------------------------------------------ */

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

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgb, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y += 1) {
    const rowStart = y * (1 + w * 3);
    raw[rowStart] = 0; // filter: none
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), rowStart + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Canvas: 1024x1024 design space, rasterised at 2x and downsampled    */
/* ------------------------------------------------------------------ */

const W = 1024;
const H = 1024;
const SS = 2;
const IW = W * SS;
const IH = H * SS;
const buf = new Uint8Array(IW * IH * 3);

function setPx(ix, iy, c, a) {
  if (ix < 0 || iy < 0 || ix >= IW || iy >= IH) return;
  const i = (iy * IW + ix) * 3;
  if (a >= 1) {
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  } else {
    buf[i] = Math.round(buf[i] * (1 - a) + c[0] * a);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - a) + c[1] * a);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - a) + c[2] * a);
  }
}

function fillRect(x, y, w, h, c, a = 1) {
  const x0 = Math.round(x * SS);
  const y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS);
  const y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) setPx(xx, yy, c, a);
}

function fillCircle(cx, cy, r, c, a = 1) {
  const CX = cx * SS;
  const CY = cy * SS;
  const R = r * SS;
  const x0 = Math.floor(CX - R);
  const x1 = Math.ceil(CX + R);
  const y0 = Math.floor(CY - R);
  const y1 = Math.ceil(CY + R);
  for (let yy = y0; yy <= y1; yy += 1) {
    for (let xx = x0; xx <= x1; xx += 1) {
      const dx = xx + 0.5 - CX;
      const dy = yy + 0.5 - CY;
      if (dx * dx + dy * dy <= R * R) setPx(xx, yy, c, a);
    }
  }
}

function stampLine(x1, y1, x2, y2, w, c, a = 1) {
  const r = w / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.45)));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    fillCircle(x1 + dx * t, y1 + dy * t, r, c, a);
  }
}

function polyline(pts, w, c, a = 1, closed = false) {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    stampLine(p[0], p[1], q[0], q[1], w, c, a);
  }
}

function fillPoly(pts, c, a = 1) {
  const P = pts.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of P) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(IH - 1, Math.ceil(maxY));
  for (let yy = y0; yy <= y1; yy += 1) {
    const yc = yy + 0.5;
    const xs = [];
    for (let i = 0; i < P.length; i += 1) {
      const [x1, y11] = P[i];
      const [x2, y2] = P[(i + 1) % P.length];
      if ((y11 <= yc && y2 > yc) || (y2 <= yc && y11 > yc)) {
        xs.push(x1 + ((yc - y11) * (x2 - x1)) / (y2 - y11));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.ceil(xs[k] - 0.5);
      const xb = Math.floor(xs[k + 1] - 0.5);
      for (let xx = xa; xx <= xb; xx += 1) setPx(xx, yy, c, a);
    }
  }
}

function rectOutline(x, y, w, h, t, c) {
  fillRect(x, y, w, t, c);
  fillRect(x, y + h - t, w, t, c);
  fillRect(x, y, t, h, c);
  fillRect(x + w - t, y, t, h, c);
}

function downsample() {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 3;
      for (let ch = 0; ch < 3; ch += 1) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy += 1) {
          for (let dx = 0; dx < SS; dx += 1) {
            sum += buf[((y * SS + dy) * IW + (x * SS + dx)) * 3 + ch];
          }
        }
        out[o + ch] = Math.round(sum / (SS * SS));
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Stroke font. Glyphs live in an 8 x 10 box (x right, y down,         */
/* baseline at y=10, cap top at y=0). s = strokes, d = filled dots.    */
/* ------------------------------------------------------------------ */

function arcPts(cx, cy, rx, ry, a0, sweep, n) {
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = ((a0 + (sweep * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}

const FONT = {
  A: { s: [[[0, 10], [4, 0], [8, 10]], [[2.3, 6.4], [5.7, 6.4]]] },
  B: { s: [[[0, 0], [0, 10]], [[0, 0], [4.2, 0], [6, 1.4], [6, 3.4], [4.6, 4.9], [0, 4.9]], [[0, 4.9], [5, 4.9], [6.7, 6.3], [6.7, 8.6], [5, 10], [0, 10]]] },
  C: { s: [arcPts(4.1, 5, 3.6, 4.9, -50, -260, 22)] },
  D: { s: [[[0, 0], [0, 10]], [[0, 0], [3.8, 0], [6.6, 2.4], [6.6, 7.6], [3.8, 10], [0, 10]]] },
  E: { s: [[[7, 0], [0, 0], [0, 10], [7, 10]], [[0, 5], [5.4, 5]]] },
  F: { s: [[[0, 10], [0, 0], [7.2, 0]], [[0, 5], [5.4, 5]]] },
  G: { s: [arcPts(4.1, 5, 3.6, 4.9, -50, -298, 26), [[7.7, 5.6], [4.4, 5.6]]] },
  H: { s: [[[0, 0], [0, 10]], [[8, 0], [8, 10]], [[0, 5], [8, 5]]] },
  I: { s: [[[4, 0], [4, 10]], [[1.6, 0], [6.4, 0]], [[1.6, 10], [6.4, 10]]] },
  J: { s: [[[7.4, 0], [7.4, 7], [6, 9.5], [3.4, 10], [1.2, 8.6]], [[4.6, 0], [7.4, 0]]] },
  K: { s: [[[0, 0], [0, 10]], [[7.4, 0], [1, 5.2]], [[1.8, 4.2], [7.4, 10]]] },
  L: { s: [[[0, 0], [0, 10], [7.2, 10]]] },
  M: { s: [[[0, 10], [0, 0], [4, 5.8], [8, 0], [8, 10]]] },
  N: { s: [[[0, 10], [0, 0], [8, 10], [8, 0]]] },
  O: { s: [arcPts(4, 5, 3.7, 5, 0, 360, 28)] },
  P: { s: [[[0, 10], [0, 0]], [[0, 0], [4.4, 0], [6.5, 1.5], [6.5, 3.7], [4.4, 5.2], [0, 5.2]]] },
  Q: { s: [arcPts(4, 5, 3.7, 5, 0, 360, 28), [[5.2, 6.8], [8.4, 10.2]]] },
  R: { s: [[[0, 10], [0, 0]], [[0, 0], [4.4, 0], [6.5, 1.5], [6.5, 3.7], [4.4, 5.2], [0, 5.2]], [[3.2, 5.2], [7.4, 10]]] },
  S: { s: [[[7, 1.8], [5.2, 0.5], [2.6, 0.5], [0.9, 2.1], [1.3, 3.9], [3.2, 5.1], [5.8, 6.3], [7.1, 8.1], [5.8, 9.6], [3, 9.9], [0.8, 8.8]]] },
  T: { s: [[[4, 0], [4, 10]], [[0, 0], [8, 0]]] },
  U: { s: [[[0, 0], [0, 7], [1.5, 9.4], [4, 10], [6.5, 9.4], [8, 7], [8, 0]]] },
  V: { s: [[[0, 0], [4, 10], [8, 0]]] },
  W: { s: [[[0, 0], [1.9, 10], [4, 4.4], [6.1, 10], [8, 0]]] },
  X: { s: [[[0, 0], [8, 10]], [[8, 0], [0, 10]]] },
  Y: { s: [[[0, 0], [4, 4.8], [8, 0]], [[4, 4.8], [4, 10]]] },
  Z: { s: [[[0, 0], [8, 0], [0, 10], [8, 10]]] },
  0: { s: [arcPts(4, 5, 3.3, 5, 0, 360, 26)] },
  1: { s: [[[2.2, 2.6], [5, 0], [5, 10]], [[2.2, 10], [7.4, 10]]] },
  2: { s: [[[0.9, 2.8], [2.2, 0.7], [5.2, 0.5], [7, 2.2], [6.6, 4.2], [1, 10], [7.4, 10]]] },
  3: { s: [[[0.9, 2], [2.6, 0.5], [5.2, 0.6], [6.7, 2.3], [5.4, 4.3], [3.2, 4.9]], [[3.2, 4.9], [5.4, 5.1], [6.9, 6.9], [5.9, 9.3], [3, 9.9], [0.8, 8.6]]] },
  4: { s: [[[0.7, 7.4], [8, 7.4]], [[5.4, 10], [5.4, 0], [0.7, 7.4]]] },
  5: { s: [[[7.2, 0], [1.2, 0], [0.9, 4.2], [4.4, 3.9], [6.7, 5.6], [6.6, 8.4], [4.8, 9.8], [1.8, 9.7], [0.5, 8.2]]] },
  6: { s: [[[6.8, 1.6], [4.6, 0.5], [2, 2.2], [0.8, 5.6], [1.2, 8.4], [3, 9.9], [5.4, 9.7], [7, 8], [6.7, 5.8], [4.8, 4.7], [2.4, 5.2], [1, 6.8]]] },
  7: { s: [[[0.7, 0], [7.5, 0], [3.9, 10]]] },
  8: { s: [arcPts(4, 2.7, 2.5, 2.7, 0, 360, 18), arcPts(4, 7.3, 2.9, 2.7, 0, 360, 20)] },
  9: { s: [[[1.2, 8.4], [3.4, 9.5], [6, 7.8], [7.2, 4.4], [6.8, 1.7], [5, 0.3], [2.6, 0.5], [1.1, 2.3], [1.5, 4.5], [3.6, 5.5], [5.9, 4.9], [7.1, 3.4]]] },
  '-': { s: [[[1.6, 5], [6.4, 5]]] },
  '.': { d: [[4, 9.3, 0.95]] },
  ',': { s: [[[4.7, 9], [3.9, 10.8]]], d: [[4, 8.6, 0.9]] },
  "'": { s: [[[4.3, 0], [3.6, 2.4]]] },
  ':': { d: [[4, 2.8, 0.9], [4, 8.6, 0.9]] },
  ';': { s: [[[4.7, 9], [3.9, 10.8]]], d: [[4, 2.8, 0.9], [4, 8.6, 0.85]] },
  '!': { s: [[[4, 0], [4, 6.6]]], d: [[4, 9.3, 0.95]] },
  '?': { s: [[[1.1, 2.6], [2.3, 0.7], [5.1, 0.5], [6.8, 2.1], [6.1, 4.1], [4, 5.6], [4, 7.2]]], d: [[4, 9.5, 0.95]] },
  '/': { s: [[[1.2, 10.4], [6.8, -0.4]]] },
  '(': { s: [[[5.8, -0.6], [3.2, 1.8], [2.3, 5], [3.2, 8.2], [5.8, 10.6]]] },
  ')': { s: [[[2.2, -0.6], [4.8, 1.8], [5.7, 5], [4.8, 8.2], [2.2, 10.6]]] },
  '%': { s: [arcPts(2.1, 2.1, 1.4, 1.4, 0, 360, 12), arcPts(5.9, 7.9, 1.4, 1.4, 0, 360, 12), [[1.6, 10.2], [6.4, -0.2]]] },
  '+': { s: [[[4, 1.8], [4, 8.2]], [[1, 5], [7, 5]]] },
  ' ': { s: [] },
};

function charAdvance(ch, scale, track) {
  return (ch === ' ' ? 5 : 8) * scale + track;
}

function measureText(str, size, track) {
  const scale = size / 10;
  let w = 0;
  for (const ch of str) w += charAdvance(ch, scale, track);
  return str.length ? w - track : 0;
}

function drawText(str, x, y, size, c, weight, track = 2) {
  const scale = size / 10;
  let cx = x;
  for (const ch of str.toUpperCase()) {
    const g = FONT[ch] || FONT[' '];
    for (const st of g.s || []) {
      polyline(st.map(([gx, gy]) => [cx + gx * scale, y + gy * scale]), weight, c);
    }
    for (const [dx, dy, dr] of g.d || []) {
      fillCircle(cx + dx * scale, y + dy * scale, Math.max(dr * scale, weight * 0.55), c);
    }
    cx += charAdvance(ch, scale, track);
  }
  return cx - x;
}

function drawTextC(str, cx, y, size, c, weight, track = 2) {
  return drawText(str, cx - measureText(str, size, track) / 2, y, size, c, weight, track);
}

function drawTextR(str, xRight, y, size, c, weight, track = 2) {
  return drawText(str, xRight - measureText(str, size, track), y, size, c, weight, track);
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

const PAPER = [247, 242, 231];
const WHITE = [255, 255, 255];
const INK = [20, 30, 52];
const INK_SOFT = [62, 62, 56];
const RED = [178, 34, 43];
const RED_BRIGHT = [217, 58, 43];
const SKY = [174, 214, 232];
const SUN = [245, 214, 123];
const SEA = [46, 110, 158];
const SEA_LIGHT = [127, 179, 213];
const DECK = [51, 64, 79];
const PIER = [38, 48, 62];
const DRONE = [30, 40, 52];
const ORANGE = [232, 119, 34];
const GOLD = [233, 161, 59];
const TEAL = [30, 125, 90];
const TAN = [217, 179, 106];
const SMOKE_A = [138, 143, 152];
const SMOKE_B = [110, 116, 126];
const VIRUS = [217, 79, 79];

/* ------------------------------------------------------------------ */
/* Lead scene: the Crimea Bridge under a drone swarm                   */
/* ------------------------------------------------------------------ */

function drawDrone(x, y, s) {
  stampLine(x - s, y - s * 0.62, x + s, y + s * 0.62, s * 0.34, DRONE);
  stampLine(x - s, y + s * 0.62, x + s, y - s * 0.62, s * 0.34, DRONE);
  for (const [ox, oy] of [[-s, -s * 0.62], [s, -s * 0.62], [-s, s * 0.62], [s, s * 0.62]]) {
    fillCircle(x + ox, y + oy, s * 0.44, DRONE);
  }
  fillCircle(x, y, s * 0.42, DRONE);
  fillCircle(x, y + s * 0.55, s * 0.17, RED_BRIGHT);
}

function drawStar(cx, cy, rOuter, rInner, points, c) {
  const pts = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const t = (Math.PI * i) / points - Math.PI / 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  fillPoly(pts, c);
}

function drawLeadScene(sx, sy) {
  const sw = 952;
  // Sky and sea
  fillRect(sx, sy, sw, 152, SKY);
  fillRect(sx, sy + 152, sw, 118, SEA);
  fillCircle(sx + 872, sy + 40, 23, SUN, 0.95);
  // Wave dashes on the sea
  const waves = [[70, 196, 44], [240, 224, 60], [430, 204, 38], [610, 232, 56], [790, 208, 42], [150, 244, 52], [520, 250, 44], [880, 240, 50]];
  for (const [dx, dy, len] of waves) stampLine(sx + dx, sy + dy, sx + dx + len, sy + dy, 2.6, SEA_LIGHT, 0.8);
  // Piers
  for (const px of [150, 432, 545, 806]) fillRect(sx + px - 6, sy + 128, 12, 66, PIER);
  // Bridge deck
  fillRect(sx, sy + 124, sw, 9, DECK);
  // Two arch spans with hangers
  for (const [ax0, ax1] of [[118, 472], [516, 836]]) {
    const base = sy + 124;
    const peak = sy + 40;
    const pts = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = i / 24;
      pts.push([sx + ax0 + (ax1 - ax0) * t, base - (base - peak) * 4 * t * (1 - t)]);
    }
    polyline(pts, 7, DECK);
    for (let i = 2; i < 24; i += 3) {
      const t = i / 24;
      const x = sx + ax0 + (ax1 - ax0) * t;
      const yTop = base - (base - peak) * 4 * t * (1 - t);
      stampLine(x, yTop, x, base, 1.8, DECK, 0.85);
    }
  }
  // Broken span at the right end, tilted into the water
  fillPoly([[sx + 842, sy + 124], [sx + 952, sy + 152], [sx + 952, sy + 161], [sx + 842, sy + 133]], DECK);
  fillPoly([[sx + 872, sy + 208], [sx + 922, sy + 220], [sx + 916, sy + 232], [sx + 866, sy + 220]], PIER);
  fillCircle(sx + 878, sy + 204, 7, WHITE, 0.75);
  fillCircle(sx + 908, sy + 210, 5, WHITE, 0.7);
  // Explosion and smoke at the break
  drawStar(sx + 848, sy + 112, 30, 12, 10, ORANGE);
  drawStar(sx + 848, sy + 112, 16, 6, 10, SUN);
  fillCircle(sx + 866, sy + 82, 15, SMOKE_A, 0.6);
  fillCircle(sx + 890, sy + 62, 19, SMOKE_B, 0.55);
  fillCircle(sx + 918, sy + 46, 13, SMOKE_A, 0.5);
  // Tracer lines
  stampLine(sx + 430, sy + 76, sx + 700, sy + 116, 2, ORANGE, 0.75);
  stampLine(sx + 578, sy + 58, sx + 836, sy + 106, 2, ORANGE, 0.75);
  // The drone swarm
  const drones = [[60, 30, 9], [132, 58, 11], [206, 24, 8], [286, 66, 10], [362, 36, 9], [432, 80, 11], [506, 28, 8], [576, 62, 10], [652, 40, 9], [716, 86, 11], [772, 30, 8], [906, 68, 9], [162, 98, 8], [622, 106, 8], [92, 88, 10], [822, 98, 8]];
  for (const [dx, dy, s] of drones) drawDrone(sx + dx, sy + dy, s);
  // Frame
  rectOutline(sx, sy, sw, 270, 2.5, INK);
}

/* ------------------------------------------------------------------ */
/* Panel icons (drawn inside a 110 x 88 box at ix, iy)                 */
/* ------------------------------------------------------------------ */

function iconTanker(ix, iy) {
  fillRect(ix, iy, 110, 88, [220, 235, 245]);
  fillRect(ix, iy + 56, 110, 32, SEA);
  fillPoly([[ix, iy + 56], [ix + 27, iy + 33], [ix + 54, iy + 56]], TAN);
  // Jet overhead
  fillPoly([[ix + 64, iy + 7], [ix + 92, iy + 13], [ix + 64, iy + 19], [ix + 71, iy + 13]], INK);
  stampLine(ix + 48, iy + 13, ix + 60, iy + 13, 2, INK, 0.5);
  // Tanker
  fillPoly([[ix + 16, iy + 51], [ix + 97, iy + 51], [ix + 88, iy + 64], [ix + 25, iy + 64]], [122, 59, 46]);
  fillRect(ix + 23, iy + 45, 64, 6, [74, 74, 68]);
  fillRect(ix + 29, iy + 35, 14, 10, RED_BRIGHT);
  fillRect(ix + 45, iy + 35, 14, 10, TEAL);
  fillRect(ix + 61, iy + 35, 12, 10, GOLD);
  fillRect(ix + 79, iy + 29, 9, 16, WHITE);
  fillRect(ix + 79, iy + 29, 9, 4, INK);
}

function iconFlags(ix, iy) {
  fillRect(ix, iy, 110, 88, [246, 239, 221]);
  fillRect(ix + 4, iy + 80, 102, 3, [138, 130, 114]);
  const poles = [ix + 14, ix + 45, ix + 76];
  for (const px of poles) stampLine(px, iy + 8, px, iy + 81, 3, [107, 93, 79]);
  // China: red with gold stars (dots)
  fillRect(poles[0] + 2, iy + 8, 28, 19, [222, 41, 27]);
  fillCircle(poles[0] + 8, iy + 14.5, 2.3, GOLD);
  for (const [ox, oy] of [[13.5, 10.5], [14.8, 13.8], [13.5, 17], [11.8, 19.8]]) {
    fillCircle(poles[0] + ox, iy + oy, 0.95, GOLD);
  }
  // United States: stripes and a blue canton
  for (let i = 0; i < 7; i += 1) fillRect(poles[1] + 2, iy + 8 + i * 2.72, 28, 1.4, i % 2 === 0 ? [178, 34, 52] : WHITE);
  fillRect(poles[1] + 2, iy + 8, 13, 9.5, [60, 59, 110]);
  // Russia: white, blue, red bands
  fillRect(poles[2] + 2, iy + 8, 28, 6.4, WHITE);
  fillRect(poles[2] + 2, iy + 14.4, 28, 6.4, [29, 111, 184]);
  fillRect(poles[2] + 2, iy + 20.8, 28, 6.2, [213, 43, 30]);
}

function iconChart(ix, iy) {
  fillRect(ix, iy, 110, 88, [22, 35, 60]);
  for (let gx = 22; gx < 110; gx += 22) stampLine(ix + gx, iy + 6, ix + gx, iy + 82, 1, [42, 60, 94]);
  for (let gy = 20; gy < 88; gy += 20) stampLine(ix + 6, iy + gy, ix + 104, iy + gy, 1, [42, 60, 94]);
  const pts = [[7, 15], [23, 23], [37, 19], [53, 35], [67, 33], [83, 51], [99, 66]];
  polyline(pts.map(([dx, dy]) => [ix + dx, iy + dy]), 4.5, RED_BRIGHT);
  for (const [dx, dy] of pts) fillCircle(ix + dx, iy + dy, 2.4, GOLD);
  fillPoly([[ix + 106, iy + 72], [ix + 90, iy + 70], [ix + 99, iy + 57]], RED_BRIGHT);
  // Gold coin
  fillCircle(ix + 19, iy + 71, 10, GOLD);
  polyline(arcPts(ix + 19, iy + 71, 6, 6, 0, 360, 18), 1.8, [185, 127, 34]);
  // Oil barrel with a gold drop
  fillRect(ix + 82, iy + 52, 20, 32, [70, 88, 110]);
  stampLine(ix + 82, iy + 60, ix + 102, iy + 60, 2, [42, 54, 72]);
  stampLine(ix + 82, iy + 76, ix + 102, iy + 76, 2, [42, 54, 72]);
  fillCircle(ix + 92, iy + 45, 3.4, GOLD);
  fillPoly([[ix + 88.6, iy + 45], [ix + 95.4, iy + 45], [ix + 92, iy + 37]], GOLD);
}

function iconSyringe(ix, iy) {
  fillRect(ix, iy, 110, 88, [251, 234, 234]);
  // Viruses
  for (const [vx, vy, vr] of [[19, 19, 8], [95, 73, 6.5]]) {
    for (let k = 0; k < 8; k += 1) {
      const t = (Math.PI * k) / 4;
      stampLine(ix + vx + Math.cos(t) * vr * 0.8, iy + vy + Math.sin(t) * vr * 0.8, ix + vx + Math.cos(t) * (vr + 4), iy + vy + Math.sin(t) * (vr + 4), 1.8, VIRUS);
      fillCircle(ix + vx + Math.cos(t) * (vr + 4.6), iy + vy + Math.sin(t) * (vr + 4.6), 1.7, VIRUS);
    }
    fillCircle(ix + vx, iy + vy, vr, VIRUS);
  }
  // Syringe, diagonal. P(t, s): t along the barrel, s across it.
  const bx = ix + 30;
  const by = iy + 62;
  const ux = 0.777;
  const uy = -0.629;
  const nx = 0.629;
  const ny = 0.777;
  const L = 54;
  const P = (t, s) => [bx + ux * L * t + nx * s, by + uy * L * t + ny * s];
  fillPoly([P(0, -9.5), P(1, -9.5), P(1, 9.5), P(0, 9.5)], INK);
  fillPoly([P(0.02, -8), P(0.98, -8), P(0.98, 8), P(0.02, 8)], [234, 242, 248]);
  fillPoly([P(0.1, -7.5), P(0.68, -7.5), P(0.68, 7.5), P(0.1, 7.5)], TEAL, 0.55);
  for (const t of [0.3, 0.45, 0.6]) {
    const [tx1, ty1] = P(t, -8);
    const [tx2, ty2] = P(t, -3);
    stampLine(tx1, ty1, tx2, ty2, 1.6, INK);
  }
  // Hub and needle
  fillPoly([P(0.98, -4), P(1.08, -4), P(1.08, 4), P(0.98, 4)], INK);
  const [hx, hy] = P(1.06, 0);
  stampLine(hx, hy, hx + ux * 25, hy + uy * 25, 2.4, [154, 163, 173]);
  // Finger flange and plunger
  const [f1x, f1y] = P(0, -11.5);
  const [f2x, f2y] = P(0, 11.5);
  stampLine(f1x, f1y, f2x, f2y, 3, INK);
  const ex = bx - ux * 15;
  const ey = by - uy * 15;
  stampLine(bx, by, ex, ey, 3.4, INK);
  stampLine(ex + nx * 8, ey + ny * 8, ex - nx * 8, ey - ny * 8, 3.4, INK);
}

function iconGlobe(cx, cy) {
  fillCircle(cx, cy, 24, SEA);
  for (const [ox, oy, r] of [[-8, -6, 7], [6, 2, 7], [-2, 10, 6], [10, -10, 5.5], [-13, 5, 4.5]]) {
    fillCircle(cx + ox, cy + oy, r, TEAL);
  }
  // Leaf overlapping, bottom right
  const lx = cx + 14;
  const ly = cy + 16;
  fillPoly([[lx, ly + 8], [lx + 3, ly - 6], [lx + 14, ly - 13], [lx + 20, ly - 12], [lx + 17, ly + 1], [lx + 7, ly + 8]], [46, 160, 90]);
  stampLine(lx + 1, ly + 9, lx + 15, ly - 9, 1.8, [27, 110, 60]);
}

/* ------------------------------------------------------------------ */
/* Page composition                                                    */
/* ------------------------------------------------------------------ */

function panel(x, y, tag, head1, head2, caption, icon) {
  fillRect(x, y, 469, 132, WHITE);
  rectOutline(x, y, 469, 132, 2, INK);
  drawText(tag, x + 16, y + 10, 13, RED, 2.8, 3);
  icon(x + 14, y + 32);
  drawText(head1, x + 140, y + 30, 25, INK, 4.2, 1.5);
  drawText(head2, x + 140, y + 64, 25, INK, 4.2, 1.5);
  drawText(caption, x + 140, y + 104, 15, INK_SOFT, 2.6, 1.5);
}

function compose() {
  fillRect(0, 0, W, H, PAPER);

  // Masthead
  drawText('THE WORLD IN ONE DAY', 36, 28, 19, INK, 3.4, 3);
  drawTextR('TUESDAY', 988, 28, 19, RED, 3.4, 3);
  fillRect(36, 58, 952, 5, RED);
  drawTextC('17 NOVEMBER 2026', 512, 76, 68, INK, 9, 3);
  fillRect(36, 166, 952, 2.5, INK);

  // Lead story
  drawLeadScene(36, 190);
  drawText('WAR IN UKRAINE', 36, 474, 15, RED, 3, 4);
  drawText('UKRAINE HITS CRIMEA BRIDGE', 36, 496, 39, INK, 6, 2);
  drawText('BIGGEST DRONE ATTACK OF THE WAR', 36, 546, 20, INK_SOFT, 3.2, 1.8);

  fillRect(36, 580, 952, 2, INK, 0.35);

  // Secondary stories, 2 x 2
  panel(36, 594, 'MIDDLE EAST', 'US JETS HIT', 'IRAN ISLAND', 'REPLY TO BAHRAIN ATTACK', iconTanker);
  panel(519, 594, 'DIPLOMACY', 'XI-TRUMP-PUTIN', 'SUMMIT SET', 'FIRST: SHENZHEN NOV 19', iconFlags);
  panel(36, 738, 'ECONOMY', 'OIL, GOLD AND', 'STOCKS FALL', 'NASDAQ IN CORRECTION', iconChart);
  panel(519, 738, 'HEALTH', 'US LOSES', 'MEASLES STATUS', 'ELIMINATED FOR 26 YEARS', iconSyringe);

  // Climate strip
  fillRect(36, 882, 952, 64, [234, 243, 236]);
  rectOutline(36, 882, 952, 64, 2, INK);
  iconGlobe(72, 914);
  drawText('COP31 DRAFT: EXIT FOSSIL FUELS FASTER', 140, 890, 23, INK, 4, 1.8);
  drawText('UN CLIMATE TALKS IN ANTALYA, TURKEY', 140, 922, 14, INK_SOFT, 2.4, 1.6);
  drawTextR('CLIMATE', 972, 890, 13, RED, 2.8, 3);

  // Ticker
  fillRect(0, 958, 1024, 66, INK);
  const t1a = 'PATTINSON IS THE NEW JAMES BOND';
  const t1b = 'EBOLA CASES DOUBLE IN DR CONGO';
  const w1 = measureText(t1a, 15.5, 1.5) + 26 + measureText(t1b, 15.5, 1.5);
  let tx = 512 - w1 / 2;
  tx += drawText(t1a, tx, 968, 15.5, WHITE, 2.6, 1.5) + 1.5;
  fillCircle(tx + 12, 976, 3.2, RED_BRIGHT);
  drawText(t1b, tx + 26, 968, 15.5, WHITE, 2.6, 1.5);
  drawTextC('FIVE EU NATIONS PLAN RWANDA MIGRANT HUB', 512, 992, 15.5, WHITE, 2.6, 1.5);
}

compose();
const png = encodePng(downsample(), W, H);
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes)`);
