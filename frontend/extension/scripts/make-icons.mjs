// Generates public/icons/icon{16,48,128}.png: an accent-blue rounded square
// with a white pencil stroke. Run once with `node scripts/make-icons.mjs`;
// the PNGs are committed, so the build does not need this script.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const ACCENT = [0x1f, 0x5f, 0xe0];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Distance from point p to segment a-b.
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function icon(size) {
  const S = 4; // supersampling for smooth edges
  const radius = size * 0.22;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let inside = 0;
      let white = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          // rounded square
          const qx = Math.max(radius - px, px - (size - radius), 0);
          const qy = Math.max(radius - py, py - (size - radius), 0);
          if (Math.hypot(qx, qy) > radius) continue;
          inside++;
          // pencil: a thick diagonal stroke from bottom-left to top-right
          const d = segDist(px / size, py / size, 0.3, 0.7, 0.7, 0.3);
          if (d < 0.085) white++;
        }
      }
      const n = S * S;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const w = white / Math.max(inside, 1);
      raw[o] = Math.round(ACCENT[0] + (255 - ACCENT[0]) * w);
      raw[o + 1] = Math.round(ACCENT[1] + (255 - ACCENT[1]) * w);
      raw[o + 2] = Math.round(ACCENT[2] + (255 - ACCENT[2]) * w);
      raw[o + 3] = Math.round((inside / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = new URL("../public/icons/", import.meta.url);
mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(new URL(`icon${size}.png`, outDir), icon(size));
console.log("icons written");
