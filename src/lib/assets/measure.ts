// What a photograph's pixels are, read from its header.
//
// MEASURED ONCE, ON THE WAY IN, AND STORED AGAINST THE ASSET — ARCHITECTURE.md,
// "the engine never reads rendered output". The layout engine needs to know a
// plate's aspect before it can place it, and the only other way to learn that is
// to render something and measure it, which is the dependency this rule exists
// to forbid.
//
// NO IMAGE LIBRARY. Every format here states its dimensions in a header a few
// dozen bytes long, and reading those bytes is a page of code with no native
// binary, no install step and nothing to keep up to date. The Dockerfile refuses
// to carry Chromium speculatively for the same reason; a decoder is a bigger
// dependency than a decoder's worth of parsing.
//
// It returns null rather than guessing. An unmeasurable file is still a file the
// specialist uploaded, and it is stored — the engine falls back to the slot's
// own aspect for it, which is worse than knowing and much better than refusing
// the upload of a format nobody anticipated.

export interface Measured {
  width: number;
  height: number;
  /** What the bytes say they are, which is not always what the name says. */
  format: "jpeg" | "png" | "gif" | "webp" | "tiff";
}

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}
function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

function png(b: Uint8Array): Measured | null {
  // \x89PNG\r\n\x1a\n then IHDR at 16.
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  return { width: u32be(b, 16), height: u32be(b, 20), format: "png" };
}

function gif(b: Uint8Array): Measured | null {
  if (b.length < 10) return null;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) return null;
  return { width: u16le(b, 6), height: u16le(b, 8), format: "gif" };
}

function jpeg(b: Uint8Array): Measured | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++; // Resynchronise rather than give up: padding between segments is legal.
      continue;
    }
    const marker = b[i + 1]!;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // SOF0–SOF15, excluding the four that are not frame headers (DHT, JPG, DAC,
    // and the restart-interval marker). Progressive JPEGs are SOF2 and are
    // common straight out of a camera's editing software, so "SOF0 only" reads
    // a real corpus wrong.
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7), format: "jpeg" };
    }
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): Measured | null {
  if (b.length < 30) return null;
  const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (!riff || !isWebp) return null;
  const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (chunk === "VP8 ") {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff, format: "webp" };
  }
  if (chunk === "VP8L") {
    const bits = u32le(b, 21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: "webp",
    };
  }
  if (chunk === "VP8X") {
    const w = (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1;
    const h = (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1;
    return { width: w, height: h, format: "webp" };
  }
  return null;
}

function tiff(b: Uint8Array): Measured | null {
  // Auction photography arrives as TIFF more often than anywhere else, because
  // it is what a drum scanner and a repro house hand over.
  if (b.length < 8) return null;
  const little = b[0] === 0x49 && b[1] === 0x49;
  const big = b[0] === 0x4d && b[1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (i: number): number => (little ? u16le(b, i) : u16be(b, i));
  const u32 = (i: number): number => (little ? u32le(b, i) : u32be(b, i));
  if (u16(2) !== 42) return null;

  const ifd = u32(4);
  if (ifd + 2 > b.length) return null;
  const entries = u16(ifd);
  let width: number | undefined;
  let height: number | undefined;
  for (let e = 0; e < entries; e++) {
    const at = ifd + 2 + e * 12;
    if (at + 12 > b.length) break;
    const tag = u16(at);
    const type = u16(at + 2);
    // SHORT (3) and LONG (4) are the only types these two tags take.
    const value = type === 3 ? u16(at + 8) : u32(at + 8);
    if (tag === 0x0100) width = value;
    if (tag === 0x0101) height = value;
  }
  return width && height ? { width, height, format: "tiff" } : null;
}

/**
 * Read a photograph's dimensions, or return null.
 *
 * The bytes decide the format, not the file name: a client's "photo.jpg" that is
 * actually a PNG is ordinary, and trusting the extension would store the wrong
 * aspect for it and lay the plate out wrong.
 */
export function measureImage(bytes: Uint8Array): Measured | null {
  const measured =
    png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes) ?? tiff(bytes);
  if (!measured) return null;
  // A header can say zero. A zero-sided plate divides by zero in any layout
  // that reasons about aspect, so it is treated as unmeasurable.
  if (!(measured.width > 0 && measured.height > 0)) return null;
  return measured;
}

/** The media type the BYTES say, for the same reason. */
export function sniffMime(bytes: Uint8Array, fallback: string): string {
  const measured = measureImage(bytes);
  if (!measured) return fallback;
  return measured.format === "jpeg" ? "image/jpeg" : `image/${measured.format}`;
}
