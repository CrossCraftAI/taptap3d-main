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

/**
 * Write a w × h RGB gradient tinted by `tint`, and return the path.
 *
 * ── `seed` MAKES THE FILE UNIQUE, AND IT IS NOT OPTIONAL IN SPIRIT ──────────
 *
 * The store is content-addressed: `recordAsset` de-duplicates on the hash, so
 * two tests that write the same gradient get ONE row back, under whichever
 * filename arrived first, already filed against whichever lot claimed it. A
 * test that then looks for its own upload by name finds nothing and waits until
 * it times out — which is how it presents, and it looks nothing like the cause.
 *
 * This was found across RUNS rather than within one: the same seven tints came
 * back every time the suite ran, so a second run's plate was the first run's
 * asset. `seed` goes into the pixels and therefore into the hash, so a caller
 * that passes something unique per run gets a file nothing else in the database
 * can be.
 */
export function writePlate(
  path: string,
  w: number,
  h: number,
  tint: number,
  seed = 0,
): string {
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
  // Stamped into the top-left pixels of the first row, where it changes the
  // bytes without changing the geometry — `assets.geometry` is what the plate
  // note reads, and a caller asking for 2870×100 is asking for a 28.7:1 work.
  let rest = seed >>> 0;
  for (let i = 0; i < 4 && 1 + i < raw.length; i++) {
    raw[1 + i] = rest & 0xff;
    rest = Math.floor(rest / 256);
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
