"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { AssetRow } from "@/lib/data/assets";
import type { LotChoice } from "@/lib/data/lots";

/**
 * The library, and the bay of photographs nobody has filed yet.
 *
 * Selection is the ERP gesture: pick a run of rows, then act on all of them at
 * once. Assignment is a SEPARATE, LATER action from arrival — which is the whole
 * point of the screen, so the selection bar is the only thing that ever mentions
 * lots, and it appears only once something is selected.
 */
function sizeOf(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PhotographLibrary({
  assets,
  lots,
  filter,
}: {
  assets: AssetRow[];
  lots: LotChoice[];
  filter: "all" | "unassigned" | "assigned";
}): React.ReactElement {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // The picker is CLOSED until someone asks for it. It was open whenever
  // anything was selected, which meant selecting one photograph dropped a
  // twelve-row list over the grid and made the second one unclickable — found
  // by driving the screen, and invisible to anyone who only ever selected one.
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lots.slice(0, 12);
    return lots
      .filter(
        (lot) =>
          (lot.ref ?? "").toLowerCase().includes(q) ||
          lot.title.toLowerCase().includes(q) ||
          lot.eventName.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [lots, query]);

  function toggle(index: number, id: string, shiftKey: boolean): void {
    const next = new Set(selected);
    // Shift extends from the last click, which is how every file manager and
    // every ERP grid behaves. Assigning forty consecutive photographs to one lot
    // is the common case and forty clicks is not a workflow.
    if (shiftKey && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      for (let i = from; i <= to; i++) next.add(assets[i]!.id);
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
    setAnchor(index);
  }

  async function assignTo(lot: LotChoice): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/lots/${lot.id}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: [...selected] }),
      });
      const body = (await response.json()) as {
        attached?: number;
        alreadyThere?: number;
        error?: string;
      };
      if (!response.ok) {
        setMessage(body.error ?? "Nothing was assigned.");
        return;
      }
      const name = lot.ref ?? (lot.title || "that lot");
      setMessage(
        `${body.attached} assigned to ${name}` +
          (body.alreadyThere ? `, ${body.alreadyThere} already there` : ""),
      );
      setSelected(new Set());
      setQuery("");
      router.refresh();
    } catch {
      setMessage("That did not reach the server. Nothing was assigned.");
    } finally {
      setBusy(false);
    }
  }

  if (assets.length === 0) {
    return (
      <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
        <p className="text-[15px] font-medium">
          {filter === "unassigned"
            ? "Every photograph is on a lot."
            : filter === "assigned"
              ? "No photograph is on a lot yet."
              : "No photographs yet."}
        </p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
          {filter === "all"
            ? "Drop the shoot folder anywhere on this page. Working out which lot each one belongs to can wait."
            : "Switch the filter above to see the rest."}
        </p>
      </div>
    );
  }

  return (
    <>
      <div
        className={`mt-4 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 ${
          selected.size > 0 ? "pb-20" : ""
        }`}
      >
        {assets.map((asset, index) => {
          const isSelected = selected.has(asset.id);
          const geometry = asset.geometry as
            | { width?: number; height?: number }
            | null;
          return (
            <button
              key={asset.id}
              type="button"
              aria-pressed={isSelected}
              onClick={(e) => toggle(index, asset.id, e.shiftKey)}
              className={`group border bg-paper text-left transition-shadow ${
                isSelected
                  ? "border-seal shadow-[0_0_0_1px_var(--color-seal)]"
                  : "border-rule hover:border-ruleStrong"
              }`}
            >
              <div className="relative flex h-32 items-center justify-center overflow-hidden bg-sunk">
                {/* Lazy, because the library is the one screen that can hold a
                    thousand originals. Derivatives arrive when a corpus makes
                    them necessary; the store is content-addressed and ready for
                    them, and shipping a decoder before then is the speculative
                    weight the Dockerfile refuses elsewhere. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/assets/${asset.contentHash}`}
                  alt={asset.originalName ?? "photograph"}
                  loading="lazy"
                  decoding="async"
                  className="max-h-full max-w-full object-contain"
                />
                {asset.useCount === 0 && (
                  <span className="absolute left-1 top-1 bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white">
                    unassigned
                  </span>
                )}
                {asset.useCount > 0 && (
                  <span className="absolute left-1 top-1 bg-ink/75 px-1.5 py-0.5 text-[10px] text-white">
                    on {asset.useCount} {asset.useCount === 1 ? "lot" : "lots"}
                  </span>
                )}
              </div>
              <div className="border-t border-rule px-2 py-1.5">
                <p className="truncate text-[12px]" title={asset.originalName ?? ""}>
                  {asset.originalName ?? "untitled"}
                </p>
                <p className="mt-0.5 text-[10px] text-faint" data-numeric>
                  {geometry?.width && geometry?.height
                    ? `${geometry.width} × ${geometry.height} · `
                    : "unmeasured · "}
                  {sizeOf(asset.byteSize)}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-30 -mx-8 mt-4 border-t border-ruleStrong bg-paper px-8 py-3 shadow-[0_-2px_8px_rgba(0,0,0,.06)]">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] font-medium" data-numeric>
              {selected.size} selected
            </p>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-[12px] text-muted underline hover:text-ink"
            >
              Clear
            </button>
            <div className="relative min-w-64 flex-1">
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicking(true);
                }}
                onFocus={() => setPicking(true)}
                // Closed on blur, but AFTER the list has had its click: the
                // list suppresses mousedown below, so the button still fires.
                onBlur={() => setPicking(false)}
                placeholder="Assign to a lot — type a reference or a title"
                aria-label="Assign to a lot"
                disabled={busy}
                className="w-full border border-rule bg-paper px-2.5 py-1.5 text-[13px] placeholder:text-faint"
              />
              {picking && matches.length > 0 && (
                <ul
                  // Mousedown would blur the input and close this list before
                  // the click landed on the row someone just aimed at.
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute bottom-full left-0 right-0 mb-1 max-h-72 overflow-y-auto border border-ruleStrong bg-paper shadow-lg"
                >
                  {matches.map((lot) => (
                    <li key={lot.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void assignTo(lot)}
                        className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-sunk"
                      >
                        <span className="w-16 shrink-0 font-medium" data-numeric>
                          {lot.ref ?? "—"}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {lot.title || <span className="text-faint">untitled</span>}
                        </span>
                        <span className="shrink-0 text-[10px] text-faint">
                          {lot.eventName}
                          {lot.photoCount > 0 ? ` · ${lot.photoCount}` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {message && <p className="text-[12px] text-muted">{message}</p>}
          </div>
        </div>
      )}

      {message && selected.size === 0 && (
        <p className="mt-3 text-[13px] text-muted">{message}</p>
      )}
    </>
  );
}
