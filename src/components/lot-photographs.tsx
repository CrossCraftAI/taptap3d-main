"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { AssetRow } from "@/lib/data/assets";

/**
 * The photographs on one lot, and the two things a person does to them.
 *
 * WHICH ONE IS THE PLATE is the only decision here that reaches the catalogue —
 * the engine reads `images[0]` and nothing else — so it is stated on the
 * thumbnail rather than hidden in a menu, and it is one click.
 */
export function LotPhotographs({
  lotId,
  assets,
}: {
  lotId: string;
  assets: (AssetRow & { isPrimary?: boolean })[];
}): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(assetId: string, action: "detach" | "primary"): Promise<void> {
    setBusy(assetId);
    try {
      await fetch(`/api/lots/${lotId}/assets`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId, action }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (assets.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-rule bg-paper px-6 py-10 text-center">
        <p className="text-[13px] font-medium">No photograph on this lot yet.</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-muted">
          Drop one anywhere on this page and it attaches here. Or assign one from
          the library that has already arrived.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
      {assets.map((asset) => (
        <figure
          key={asset.id}
          className={`border bg-paper ${asset.isPrimary ? "border-seal" : "border-rule"}`}
        >
          <div className="relative flex h-40 items-center justify-center overflow-hidden bg-sunk">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/assets/${asset.contentHash}`}
              alt={asset.originalName ?? "photograph"}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full object-contain"
            />
            {asset.isPrimary && (
              <span className="absolute left-1 top-1 bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white">
                plate
              </span>
            )}
          </div>
          <figcaption className="border-t border-rule px-2 py-1.5">
            <p className="truncate text-[12px]" title={asset.originalName ?? ""}>
              {asset.originalName ?? "untitled"}
            </p>
            <div className="mt-1 flex gap-2 text-[11px]">
              {!asset.isPrimary && (
                <button
                  type="button"
                  disabled={busy === asset.id}
                  onClick={() => void act(asset.id, "primary")}
                  className="text-muted underline hover:text-ink disabled:no-underline"
                >
                  Use as plate
                </button>
              )}
              <button
                type="button"
                disabled={busy === asset.id}
                onClick={() => void act(asset.id, "detach")}
                className="text-muted underline hover:text-seal disabled:no-underline"
              >
                Remove
              </button>
            </div>
            {/* Said plainly, because "remove" is the one word here a person could
                reasonably read as "delete the file". */}
            <p className="mt-0.5 text-[10px] text-faint">
              Removing takes it off this lot, not out of the library.
            </p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
