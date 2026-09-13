import { describe, expect, it } from "vitest";

import { measureImage, sniffMime } from "@/lib/assets/measure";

// Minimal but REAL headers. A fixture that is only a magic number tests the
// magic number; these carry the dimension fields at the offsets the format
// actually puts them, which is the part that can be wrong.

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // length + "IHDR"
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
  const b = new Uint8Array(64);
  const view = new DataView(b.buffer);
  b.set([0xff, 0xd8], 0);
  // An APP0 segment first, so the parser has to walk rather than assume the
  // frame header is the second marker — which is what a real camera file looks
  // like and what a naive parser gets wrong.
  b.set([0xff, 0xe0], 2);
  view.setUint16(4, 16);
  const i = 4 + 16;
  b.set([0xff, marker], i);
  view.setUint16(i + 2, 17);
  b[i + 4] = 8; // precision
  view.setUint16(i + 5, height);
  view.setUint16(i + 7, width);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(16);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  const view = new DataView(b.buffer);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  return b;
}

function webpLossless(width: number, height: number): Uint8Array {
  const b = new Uint8Array(40);
  const view = new DataView(b.buffer);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  b.set([0x56, 0x50, 0x38, 0x4c], 12); // VP8L
  b[20] = 0x2f;
  view.setUint32(21, ((height - 1) << 14) | (width - 1), true);
  return b;
}

function tiff(width: number, height: number): Uint8Array {
  const b = new Uint8Array(64);
  const view = new DataView(b.buffer);
  b.set([0x49, 0x49], 0); // little-endian
  view.setUint16(2, 42, true);
  view.setUint32(4, 8, true); // first IFD at 8
  view.setUint16(8, 2, true); // two entries
  // ImageWidth, LONG
  view.setUint16(10, 0x0100, true);
  view.setUint16(12, 4, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, width, true);
  // ImageLength, LONG
  view.setUint16(22, 0x0101, true);
  view.setUint16(24, 4, true);
  view.setUint32(26, 1, true);
  view.setUint32(30, height, true);
  return b;
}

describe("measureImage", () => {
  it("reads every format the trade actually sends", () => {
    expect(measureImage(png(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
      format: "png",
    });
    expect(measureImage(jpeg(4032, 3024))).toEqual({
      width: 4032,
      height: 3024,
      format: "jpeg",
    });
    expect(measureImage(gif(12, 34))).toEqual({
      width: 12,
      height: 34,
      format: "gif",
    });
    expect(measureImage(webpLossless(640, 480))).toEqual({
      width: 640,
      height: 480,
      format: "webp",
    });
    // TIFF is what a drum scanner and a repro house hand over, so it is not an
    // exotic case in this trade.
    expect(measureImage(tiff(8000, 6000))).toEqual({
      width: 8000,
      height: 6000,
      format: "tiff",
    });
  });

  it("reads a progressive JPEG, not only a baseline one", () => {
    // SOF2. Anything that has been through editing software is likely to be
    // progressive, and "SOF0 only" reads a real corpus wrong.
    expect(measureImage(jpeg(100, 200, 0xc2))?.width).toBe(100);
  });

  it("walks past segments rather than assuming where the frame header is", () => {
    // The fixture carries an APP0 before the frame header, which is what every
    // camera file looks like.
    expect(measureImage(jpeg(7, 9))).toEqual({
      width: 7,
      height: 9,
      format: "jpeg",
    });
  });

  it("believes the bytes, not the file name", () => {
    // A client's "photo.jpg" that is really a PNG is ordinary. Trusting the
    // extension stores the wrong aspect and lays the plate out wrong.
    expect(sniffMime(png(10, 20), "image/jpeg")).toBe("image/png");
    expect(measureImage(png(10, 20))?.format).toBe("png");
  });

  it("returns null rather than guessing", () => {
    expect(measureImage(new Uint8Array(0))).toBeNull();
    expect(measureImage(new TextEncoder().encode("not an image at all"))).toBeNull();
    // A header may say zero, and a zero-sided plate divides by zero in anything
    // that reasons about aspect.
    expect(measureImage(png(0, 100))).toBeNull();
    expect(measureImage(png(100, 0))).toBeNull();
  });

  it("falls back to the declared type for something it cannot read", () => {
    const unknown = new TextEncoder().encode("%PDF-1.7");
    expect(sniffMime(unknown, "application/pdf")).toBe("application/pdf");
  });

  it("is total over arbitrary bytes", () => {
    // It runs on whatever a customer drops, so it must never throw.
    for (let i = 0; i < 200; i++) {
      const noise = new Uint8Array(64).map(() => Math.floor(Math.random() * 256));
      expect(() => measureImage(noise)).not.toThrow();
    }
  });
});
