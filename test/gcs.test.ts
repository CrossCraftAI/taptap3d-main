import { beforeEach, describe, expect, it, vi } from "vitest";
import { Storage } from "@google-cloud/storage";
import { GcsAssetStore } from "@/lib/assets/gcs";
import { hashBytes } from "@/lib/assets/store";

const save = vi.fn();
const download = vi.fn();
const exists = vi.fn();
const file = vi.fn(() => ({ save, download, exists }));
const storage = { bucket: () => ({ file }) } as unknown as Storage;
const store = new GcsAssetStore("private-assets", storage);
beforeEach(() => vi.resetAllMocks());
describe("GCS immutable shared blobs", () => {
  it("creates atomically at the same key as the filesystem store", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = hashBytes(bytes);
    expect(await store.put(bytes)).toEqual({ hash, size: 3, written: true });
    expect(file).toHaveBeenCalledWith(`objects/${hash.slice(0, 2)}/${hash}`);
    expect(save.mock.calls[0]![1]).toMatchObject({ preconditionOpts: { ifGenerationMatch: 0 } });
  });
  it("deduplicates concurrent creation without overwriting", async () => {
    save.mockRejectedValueOnce({ code: 412 });
    expect((await store.put(new Uint8Array([1]))).written).toBe(false);
  });
  it("missing is different from inaccessible", async () => {
    download.mockRejectedValueOnce({ code: 404 });
    expect(await store.get("a".repeat(64))).toBeNull();
    download.mockRejectedValueOnce({ code: 403 });
    await expect(store.get("a".repeat(64))).rejects.toEqual({ code: 403 });
  });
  it("rejects malformed keys before calling GCP", async () => {
    expect(await store.get("../secret")).toBeNull();
    expect(await store.has("../secret")).toBe(false);
    expect(file).not.toHaveBeenCalled();
  });
  it("reports failed writes rather than pretending success", async () => {
    save.mockRejectedValueOnce({ code: 503 });
    await expect(store.put(new Uint8Array([1]))).rejects.toEqual({ code: 503 });
  });
});
