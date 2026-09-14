// A photograph for a driven test, made without an image library.
//
// A real PNG, so the upload path measures it and the renderer decodes it, but
// a synthetic one, so the repository carries no client material (the guards in
// test/guards.test.ts hold that line). Shared by the specs that need a plate on
// a lot; pdf.spec.ts keeps its own copy from before this file existed.

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** Write a w × h RGB gradient tinted by `tint`, and return the path. */
export function writePlate(path: string, w: number, h: number, tint: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      raw[i] = (tint + Math.round(200 * (x / w))) % 256;
      raw[i + 1] = (tint * 2 + Math.round(150 * (y / h))) % 256;
      raw[i + 2] = (tint * 3) % 256;
    }
  }
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return path;
}
