"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { AssetRow } from "@/lib/data/assets";
import type { LotChoice } from "@/lib/data/lots";
// A pure module. Its only import from the data layer is a TYPE, which erases,
// so nothing here drags the database driver into the client bundle —
// src/lib/ledger.ts states the same rule about itself.
import { libraryHref, shortName, type LibraryView } from "@/lib/photographs";

/**
 * The library, and the bay of photographs nobody has filed yet.
 *
 * Selection is the ERP gesture: pick a run of rows, then act on all of them at
 * once. Assignment is a SEPARATE, LATER action from arrival — which is the whole
 * point of the screen, so the selection bar is the only thing that ever mentions
 * lots, and it appears only once something is selected.
 *
 * ── WHAT A PAGER DOES TO "EXTEND", AND WHAT WAS CHOSEN ──────────────────────
 *
 * Shift-click extends from the anchor to the row clicked, and the anchor is an
 * INDEX INTO WHAT IS ON SCREEN. A pager changes what that sentence means, and
 * there were two answers:
 *
 *   A selection that spans pages. Pick twelve here, turn the page, pick eight
 *   more, assign twenty. Rejected, and not narrowly: the bar would then say
 *   "20 selected" over a grid showing eight of them, and the button beside it
 *   writes to the database. A destructive-adjacent action whose extent is
 *   partly off screen is the shape of mistake that is discovered afterwards.
 *   Holding the ids in the URL or in storage would make it survivable but not
 *   visible, which is the wrong half of the problem.
 *
 *   A selection that is what is on screen. Chosen. Turning the page clears it,
 *   the bar counts this page, and "extend" keeps exactly the meaning it had:
 *   from the anchor to here, among the tiles a person can see. The page is
 *   sized so the gesture still fits — src/lib/photographs.ts `PAGE_SIZE` is
 *   chosen to be larger than the run this screen exists for.
 *
 * It is ENFORCED rather than hoped for. A client-side navigation between two
 * queries of the same route re-renders the page without necessarily
 * remounting this component, so the selection could have survived into a grid
 * of different tiles; the page keys this component on the whole query
 * (src/app/photographs/page.tsx) so a page turn is a remount and the state
 * genuinely is what is on screen.
 *
 * ── THE FILTERS WERE ALREADY LINKS, AND THEY STILL ARE ──────────────────────
 *
 * They live in the page's header beside the search and the pager, because they
 * are the same kind of thing: a URL. Nothing about them changed here except
 * that they clear the selection too, for the reason above — pressing
 * "Unassigned" while eleven photographs are selected used to leave the
 * selection standing over a grid that no longer contained most of them.
 */
function sizeOf(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PhotographLibrary({
  assets,
  lots,
  lotsHeld,
  view,
}: {
  /** This page's photographs, in the order the grid draws them. */
  assets: AssetRow[];
  lots: LotChoice[];
  /**
   * How many lots the house has, which is not always how many are in `lots`.
   *
   * The picker is sent the newest `LOT_CHOICE_CAP` and filters them here with
   * no round trip. Past the cap that filter is over a SUBSET, and a person
   * typing a reference from an older sale gets "no match" for a lot that
   * exists — so the difference is said out loud rather than left to be
   * discovered.
   */
  lotsHeld: number;
  view: LibraryView;
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
    //
    // THE ANCHOR IS AN INDEX INTO `assets`, WHICH IS THIS PAGE. That is the
    // whole of what a pager changed about this gesture, and it is the whole
    // of why the page is sized above the run somebody selects in one go — the
    // header on this component argues both, and the page keys this component
    // on the query so the state cannot outlive the tiles it indexes.
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

  if (assets.length === 0) return <Nothing view={view} />;

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
                {/* ── A TILE THAT CANNOT DRAW SAYS WHY ──────────────────────
                    `/api/assets/[hash]` answers 410 when the row is there and
                    the bytes are not, and it says so in a sentence — which
                    nobody reads, because the only thing on screen is the
                    browser's broken-image glyph. That state is real: the
                    migration can produce it, and a build destroyed a local
                    store while this was being written. A photograph that has
                    lost its file is something a cataloguer has to act on
                    (re-upload it), so the grid names it rather than looking
                    like a slow network. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/assets/${asset.contentHash}`}
                  alt={asset.originalName ?? "photograph"}
                  loading="lazy"
                  decoding="async"
                  // BOTH, AND THE REF IS THE ONE THAT MATTERS ABOVE THE FOLD.
                  // `onError` is attached at hydration, and a tile at the top
                  // of the grid has usually already failed by then — the
                  // driven pass caught exactly that: the lazy tiles further
                  // down swapped to the sentence while the first row still
                  // showed the browser's broken glyph with the filename
                  // spilling out of the tile. A ref callback runs at mount and
                  // can ask the element what already happened.
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth === 0) missing(el);
                  }}
                  onError={(e) => missing(e.currentTarget)}
                  className="max-h-full max-w-full object-contain"
                />
                <span
                  data-missing
                  hidden
                  className="px-2 text-center text-[10px] leading-relaxed text-muted"
                >
                  This photograph&rsquo;s file is missing from the store. Upload
                  it again to restore it.
                </span>
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
                {/* SHORTENED IN THE MIDDLE, not by CSS at the end: a tile is
                    148px and every name a camera writes is a shared prefix
                    with the distinguishing part on the tail. `truncate` stays
                    as the floor for a name that is one long word. */}
                <p className="truncate text-[12px]" title={asset.originalName ?? ""}>
                  {asset.originalName ? shortName(asset.originalName) : "untitled"}
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
            {/* "ON THIS PAGE" IS NOT PADDING. The grid is one page of the
                library now, and a bar that said "12 selected" beside a
                pager would leave a person to guess whether the other pages
                are in it. They are not, and the bar is where that is said. */}
            <p className="text-[13px] font-medium" data-numeric>
              {selected.size} selected
              {view.pages > 1 && (
                <span className="font-normal text-muted"> on this page</span>
              )}
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
              {/* SAID WHERE THE SEARCHING HAPPENS, not in a banner at the top
                  of the page. The person who needs this sentence is the one
                  who has just typed a reference and been shown nothing, and
                  they are looking at this box. */}
              {lotsHeld > lots.length && (
                <p className="mt-1 text-[10px] leading-relaxed text-muted">
                  Showing the {lots.length.toLocaleString()} newest lots of{" "}
                  {lotsHeld.toLocaleString()}. A lot from an older sale is not in
                  this list — open it from its own sale and add the photograph
                  there.
                </p>
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

/**
 * The ways this grid is empty, told apart.
 *
 * There were three and now there are four, because there is a search. One
 * sentence for all of them is the usual outcome — "No results", under a filter
 * the person has forgotten they set — and the ledger's own empty state
 * (src/components/ledger.tsx) makes the same distinction for the same reason:
 * each of these names what is in the way and offers the press that removes it.
 *
 * A DROPPED FOLDER STILL WORKS HERE. This box is inside the dropzone, so the
 * "drop the shoot folder" sentence is an instruction the surface under it can
 * actually carry out — which is why it is that sentence and not "upload one".
 */
function Nothing({ view }: { view: LibraryView }): React.ReactElement {
  const { q, filter } = view.query;
  const filtered = filter !== "all";

  return (
    <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
      <p className="text-[15px] font-medium">
        {q !== "" ? (
          <>
            No photograph here is named{" "}
            <span className="text-ink">&ldquo;{q}&rdquo;</span>.
          </>
        ) : filter === "unassigned" ? (
          "Every photograph is on a lot."
        ) : filter === "assigned" ? (
          "No photograph is on a lot yet."
        ) : (
          "No photographs yet."
        )}
      </p>

      <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
        {q === "" && !filtered
          ? "Drop the shoot folder anywhere on this page. Working out which lot each one belongs to can wait."
          : "A photograph is searched by the filename it arrived with — that is the only name it has until it is on a lot."}
      </p>

      {/* FLOORED, WHERE THE LEDGER'S EQUIVALENT IS NOT. These two are the only
          way out of an empty grid, so they are the screen's controls rather
          than links inside a sentence — and this is a screen somebody stands
          at with a tablet and a pile of prints. `inline-flex`, because
          `min-h` does nothing to an inline box (page-header.tsx paid for that
          lesson once). */}
      {(q !== "" || filtered) && (
        <p className="mt-3 text-[13px]">
          {q !== "" && (
            <>
              <Link
                href={libraryHref(view.query, { q: "", page: 1 })}
                className="inline-flex min-h-[var(--tap)] items-center text-muted underline hover:text-ink"
              >
                Clear the search
              </Link>
              {filtered && <span className="px-2 text-rule">·</span>}
            </>
          )}
          {filtered && (
            <Link
              href={libraryHref(view.query, { q: "", filter: "all", page: 1 })}
              className="inline-flex min-h-[var(--tap)] items-center text-muted underline hover:text-ink"
            >
              Look at every photograph
            </Link>
          )}
        </p>
      )}
    </div>
  );
}

/** Put the sentence in the tile's place. See the note at the `<img>`. */
function missing(el: HTMLImageElement): void {
  el.style.display = "none";
  el.parentElement?.querySelector("[data-missing]")?.removeAttribute("hidden");
}
