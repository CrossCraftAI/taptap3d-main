import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { FilesystemAssetStore, hashBytes, isHash } from "@/lib/assets/store";

const root = mkdtempSync(join(tmpdir(), "taptap3d-assets-"));
const store = new FilesystemAssetStore(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("isHash", () => {
  it("refuses anything that is not 64 lowercase hex characters", () => {
    // The hash arrives as a URL path segment, and `..` is a valid path segment.
    // This is the whole of the defence, so it is total rather than a filter.
    for (const bad of [
      "..",
      "../../etc/passwd",
      "objects/aa/bb",
      "",
      "A".repeat(64),
      "a".repeat(63),
      "a".repeat(65),
      "a".repeat(63) + "g",
    ]) {
      expect(isHash(bad), bad).toBe(false);
    }
    expect(isHash(hashBytes(bytes("anything")))).toBe(true);
  });

  it("guards get and has, not only the route", async () => {
    // A traversal attempt must die in the store too — a second caller will
    // eventually forget the route's check.
    await expect(store.get("../../../etc/passwd")).resolves.toBeNull();
    await expect(store.has("..")).resolves.toBe(false);
  });
});

describe("FilesystemAssetStore", () => {
  it("addresses bytes by their content", async () => {
    const stored = await store.put(bytes("a photograph"));
    expect(stored.hash).toBe(hashBytes(bytes("a photograph")));
    expect(stored.size).toBe(12);
    expect(await store.has(stored.hash)).toBe(true);
  });

  it("round-trips the exact bytes", async () => {
    const original = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0xfe]);
    const { hash } = await store.put(original);
    expect(Array.from((await store.get(hash))!)).toEqual(Array.from(original));
  });

  it("stores identical bytes once and says it did not write again", async () => {
    // Two orgs uploading the same photograph share one blob. The row is what is
    // per-org; the bytes are not.
    const first = await store.put(bytes("shared plate"));
    const second = await store.put(bytes("shared plate"));
    expect(second.hash).toBe(first.hash);
    expect(first.written).toBe(true);
    expect(second.written).toBe(false);
  });

  it("returns null for a hash it does not hold rather than throwing", async () => {
    expect(await store.get("f".repeat(64))).toBeNull();
    expect(await store.has("f".repeat(64))).toBe(false);
  });

  it("never leaves a partial object under a complete name", async () => {
    // The name IS the hash, so a reader cannot tell a half-written object from a
    // whole one without re-hashing every read. Write-then-rename is what makes
    // the file either absent or correct.
    const { hash } = await store.put(bytes("atomic"));
    const read = await store.get(hash);
    expect(hashBytes(read!)).toBe(hash);
  });
});
