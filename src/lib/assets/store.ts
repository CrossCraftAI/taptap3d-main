// Where photographs live.
//
// CONTENT-ADDRESSED, and the address is the SHA-256 of the bytes. Two orgs
// uploading the same photograph share one blob on disk and hold two rows in
// `assets` — deduplication happens here, where it saves space, and never in the
// table, where it would make one house's row reachable from another house's
// query.
//
// THE STORE DOES NOT AUTHORISE. `get(hash)` returns bytes to anyone who can name
// the hash, which is why nothing user-facing may call it with a hash that came
// from a request. The route resolves the hash through the `assets` table scoped
// to the acting org first; the store is the layer below that decision, not the
// place it is made. The predecessor shared its store globally and then had to
// reason, repeatedly, about what that leaked.
//
// Filesystem today, S3 the day a second machine is needed. That is the whole
// reason this is an interface with one implementation rather than three
// functions: M1.md §5 says scaling past one machine is an implementation of this
// same shape, and nothing above it changes.

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredBlob {
  hash: string;
  size: number;
  /** False when the bytes were already present — the caller may want to say so. */
  written: boolean;
}

export interface AssetStore {
  put(bytes: Uint8Array): Promise<StoredBlob>;
  get(hash: string): Promise<Uint8Array | null>;
  has(hash: string): Promise<boolean>;
}

export function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A hash, or nothing.
 *
 * Every path into the store goes through this. A hash arriving from a URL is a
 * path segment, and `..` is a valid path segment — so the shape is checked
 * rather than trusted, and the check is total: 64 lowercase hex characters or
 * the value is refused.
 */
export function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** `objects/ab/abcdef…` — two levels, so no directory holds a million entries. */
function objectPath(root: string, hash: string): string {
  return join(root, "objects", hash.slice(0, 2), hash);
}

export function assetRoot(): string {
  // `/data/assets` in production, on the volume. `.data/assets` locally, which
  // .gitignore already excludes.
  return process.env.TAPTAP3D_ASSET_ROOT ?? join(process.cwd(), ".data", "assets");
}

export class FilesystemAssetStore implements AssetStore {
  constructor(private readonly root: string = assetRoot()) {}

  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const hash = hashBytes(bytes);
    const target = objectPath(this.root, hash);
    if (await this.has(hash)) {
      return { hash, size: bytes.byteLength, written: false };
    }
    await mkdir(dirname(target), { recursive: true });
    // WRITE THEN RENAME. A reader that finds a half-written object cannot tell
    // it from a complete one — the name is the hash, so the usual "verify what
    // you read" check would have to re-hash every read to notice. Rename is
    // atomic within a filesystem, so an object is either absent or whole.
    const staging = `${target}.${process.pid}.${Date.now()}.part`;
    await writeFile(staging, bytes);
    await rename(staging, target);
    return { hash, size: bytes.byteLength, written: true };
  }

  async get(hash: string): Promise<Uint8Array | null> {
    if (!isHash(hash)) return null;
    try {
      return await readFile(objectPath(this.root, hash));
    } catch {
      return null;
    }
  }

  async has(hash: string): Promise<boolean> {
    if (!isHash(hash)) return false;
    try {
      await access(objectPath(this.root, hash), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}

let store: AssetStore | undefined;

/** Lazy, for the same reason `getDb` is: importing must not touch the disk. */
export function getAssetStore(): AssetStore {
  store ??= new FilesystemAssetStore();
  return store;
}
