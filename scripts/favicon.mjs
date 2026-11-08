import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
}

const navy = [30, 75, 128];
const bars = [
  [7, 13, 11, 3],
  [20, 13, 5, 3],
  [7, 18.5, 11, 3],
  [20, 18.5, 5, 3],
  [7, 24, 11, 3],
  [20, 24, 5, 3],
];

function insideRoundRect(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRect(px, py, x, y, w, h) {
  return px >= x && px < x + w && py >= y && py < y + h;
}

function paint(x, y, size) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  const samples = 4;
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const px = ((x + (sx + 0.5) / samples) * 32) / size;
      const py = ((y + (sy + 0.5) / samples) * 32) / size;
      if (!insideRoundRect(px, py, 0, 0, 32, 32, 3)) continue;
      let cr = navy[0];
      let cg = navy[1];
      let cb = navy[2];
      const angle = (8 * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dx = px - 16;
      const dy = py - 6;
      const ux = 16 + dx * cos - dy * sin;
      const uy = 6 + dx * sin + dy * cos;
      if (insideRect(ux, uy, 7, 4.5, 18, 3)) {
        cr = Math.round(255 * 0.4 + cr * 0.6);
        cg = Math.round(255 * 0.4 + cg * 0.6);
        cb = Math.round(255 * 0.4 + cb * 0.6);
      }
      if (bars.some(([bx, by, bw, bh]) => insideRect(px, py, bx, by, bw, bh))) {
        cr = 255;
        cg = 255;
        cb = 255;
      }
      r += cr;
      g += cg;
      b += cb;
      a += 255;
    }
  }
  const count = samples * samples;
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)];
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x, y, size);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync("public/favicon-32.png", png(32));
writeFileSync("public/apple-touch-icon.png", png(180));
