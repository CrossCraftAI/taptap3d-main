import { Storage, type Bucket } from "@google-cloud/storage";
import { hashBytes, isHash, type AssetStore, type StoredBlob } from "./store";

function codeOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? Number(error.code) : undefined;
}

/** Private bucket; all reads still pass through the org-scoped assets table. */
export class GcsAssetStore implements AssetStore {
  private readonly bucket: Bucket;
  constructor(name: string, storage = new Storage()) {
    this.bucket = storage.bucket(name);
  }
  private file(hash: string) {
    return this.bucket.file(`objects/${hash.slice(0, 2)}/${hash}`);
  }
  async put(bytes: Uint8Array): Promise<StoredBlob> {
    const hash = hashBytes(bytes);
    try {
      await this.file(hash).save(Buffer.from(bytes), {
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: "application/octet-stream" },
      });
      return { hash, size: bytes.byteLength, written: true };
    } catch (error) {
      // Concurrent uploads converge on one immutable object.
      if (codeOf(error) !== 412) throw error;
      return { hash, size: bytes.byteLength, written: false };
    }
  }
  async get(hash: string): Promise<Uint8Array | null> {
    if (!isHash(hash)) return null;
    try {
      const [bytes] = await this.file(hash).download();
      return bytes;
    } catch (error) {
      if (codeOf(error) === 404) return null;
      throw error;
    }
  }
  async has(hash: string): Promise<boolean> {
    if (!isHash(hash)) return false;
    const [exists] = await this.file(hash).exists();
    return exists;
  }
}
