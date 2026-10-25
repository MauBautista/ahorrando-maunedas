/**
 * The home screen icons of 06 §7 (iPhone "Agregar a pantalla de inicio" and the web manifest): a white ring on the
 * brand green, drawn and PNG-encoded here so no image tool is needed. Run: node apps/web/scripts/icons.ts
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GREEN = [0x1b, 0x6b, 0x3a];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Antialiased by 4×4 supersampling; the ring stays inside the maskable safe zone (the inner 80 %). */
function icon(size: number): Buffer {
  const rows: Buffer[] = [];
  const c = size / 2;
  const outer = size * 0.3;
  const inner = size * 0.18;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3); // filter byte 0, then RGB
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const d = Math.hypot(x + (sx + 0.5) / 4 - c, y + (sy + 0.5) / 4 - c);
          if (d <= outer && d >= inner) hits++;
        }
      }
      const a = hits / 16;
      for (let i = 0; i < 3; i++) row[1 + x * 3 + i] = Math.round(GREEN[i]! * (1 - a) + WHITE[i]! * a);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
] as const) {
  writeFileSync(new URL(`../public/icons/${name}`, import.meta.url), icon(size));
}
