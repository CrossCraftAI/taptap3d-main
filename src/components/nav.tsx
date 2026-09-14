"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { NAV, activeItem } from "@/lib/nav";

/**
 * The rail.
 *
 * Places, never actions — a global "Import" cannot know which sale a specialist
 * means, so it opens on the question rather than answering it for them. The
 * event's own header keeps its own buttons; nothing was hoisted up here.
 *
 * ── WHY ANYTHING COLLAPSES ──────────────────────────────────────────────────
 *
 * Seven categories is more than two, and most people work inside one of them for
 * a day at a time. Being able to shut the ones you are not in is how a rail that
 * names the whole cycle stays a rail instead of becoming a directory.
 *
 * ── WHY THE STATE IS localStorage AND NOT A COOKIE ──────────────────────────
 *
 * It is a per-viewer convenience with no consequence for anyone else, so it must
 * not become a header on every request nor something the server has to know
 * before it can render. Every read and write is wrapped, because a browser in a
 * private window throws on access rather than returning nothing, and a rail that
 * cannot render is a worse failure than a rail that forgets.
 *
 * It is read through `useSyncExternalStore` rather than copied into state by an
 * effect. localStorage IS an external store; reading it during render would make
 * the first client render disagree with the server's markup, and syncing it in
 * afterwards is the cascading-render pattern React now lints against. The hook
 * is the thing built for exactly this: the server snapshot says "nothing is
 * collapsed", hydration matches it, and the viewer's own answer arrives on the
 * next render.
 *
 * COLLAPSED IDS ARE STORED, NOT OPEN ONES. The eighth category, whenever it
 * lands, is then open for everyone who has ever used the product rather than
 * invisible to exactly those people.
 *
 * ── THE CATEGORY YOU ARE IN IS OPEN WHEN YOU ARRIVE ─────────────────────────
 *
 * Always, whatever was stored. A rail that hides where the viewer currently is
 * has stopped being a map. It can still be shut by hand afterwards — the control
 * is live, not decorative — and arriving there again opens it again, which also
 * becomes the remembered answer. One source of truth, not two.
 */

const STORAGE_KEY = "taptap3d.nav.collapsed";
const NOTHING: ReadonlySet<string> = new Set();

// Module state, and only ever touched from the browser: the server renders from
// `serverSnapshot` and never calls the rest, so there is nothing here for one
// request to leak into another. `snapshot` must return the SAME set for the same
// contents or useSyncExternalStore re-renders forever, which is why the parsed
// value is held rather than re-parsed per call.
let held: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): ReadonlySet<string> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(value) ? value.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return NOTHING;
  }
}

function load(): ReadonlySet<string> {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // Blocked outright, which a private window does by throwing rather than by
    // returning nothing. To a viewer it means the rail opens the way it does for
    // a stranger.
    return NOTHING;
  }
}

function snapshot(): ReadonlySet<string> {
  held ??= load();
  return held;
}

function serverSnapshot(): ReadonlySet<string> {
  return NOTHING;
}

function store(next: ReadonlySet<string>): void {
  // In memory first. A preference that cannot be written down is still a
  // preference for this session, and a toggle that does nothing because the
  // browser refuses to persist it reads as a broken control.
  held = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // See above.
  }
  for (const notify of listeners) notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // A viewer who collapsed something in their other tab is the same viewer.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    held = load();
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function Caret({ open }: { open: boolean }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`}
    >
      <path
        d="M1.5 3 L4 5.5 L6.5 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Nav({
  counts,
}: {
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const pathname = usePathname();
  const active = activeItem(pathname);
  const activeCategory = active?.categoryId ?? null;

  const collapsed = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  // Arriving somewhere opens the category holding it. Written to the store
  // rather than layered on top of it in render, because a category the viewer
  // cannot shut is a dead control and a rail whose displayed state disagrees
  // with its remembered state is two sources of truth.
  //
  // This is what an effect is for — reconciling an external store with a change
  // React knows about — and it does nothing at all in the ordinary case, which
  // is that the category was already open.
  useEffect(() => {
    if (!activeCategory || !collapsed.has(activeCategory)) return;
    const next = new Set(collapsed);
    next.delete(activeCategory);
    store(next);
  }, [activeCategory, collapsed]);

  const toggle = (id: string): void => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    store(next);
  };

  return (
    <nav aria-label="Sections" className="mt-6 flex flex-col gap-3">
      {NAV.map((category) => {
        // NAMED, NOT BUILT. No link, no button, nothing to click — the argument
        // is in src/lib/nav.ts. The tail is what separates "not yet" from
        // "broken", and it is visible text rather than only a title because a
        // hint nobody hovers is a hint nobody reads.
        if (category.items.length === 0) {
          return (
            <div
              key={category.id}
              title={category.hint}
              className="flex items-center gap-1.5 px-3 py-1"
            >
              <span className="w-2 shrink-0" />
              <span className="flex-1 text-[11px] tracking-wide text-faint">
                {category.label}
              </span>
              <span className="border border-rule px-1 text-[10px] leading-[14px] text-faint">
                not yet
              </span>
            </div>
          );
        }

        const open = !collapsed.has(category.id);
        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => toggle(category.id)}
              aria-expanded={open}
              aria-controls={`nav-${category.id}`}
              title={category.hint}
              // Muted at 11px, which is the weight this repository already gives
              // a column header — the category is the same kind of thing. The
              // named-but-unbuilt ones stay faint, so "built" and "not yet" are
              // separated by weight as well as by the tail.
              className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px] tracking-wide text-muted hover:text-ink"
            >
              <Caret open={open} />
              <span className="flex-1 text-left">{category.label}</span>
            </button>

            <ul
              id={`nav-${category.id}`}
              className={`flex-col gap-px ${open ? "flex" : "hidden"}`}
            >
              {category.items.map((item) => {
                const isActive = item.match(pathname);
                const total =
                  item.count === "events"
                    ? counts.events
                    : item.count === "photographs"
                      ? counts.photographs
                      : null;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      // Indented to the category's label rather than to its
                      // caret, so the names make one column and the carets
                      // another.
                      className={`flex items-center gap-2 py-1.5 pl-[1.625rem] pr-3 text-[13px] ${
                        isActive
                          ? "bg-sunk font-medium text-ink"
                          : "text-muted hover:bg-sunk hover:text-ink"
                      }`}
                    >
                      <span className="flex-1">{item.label}</span>
                      {/* The one number worth interrupting for: how many
                          photographs have arrived and not yet been filed. That
                          is the queue, and a queue nobody can see is a queue
                          nobody works. */}
                      {item.count === "photographs" && counts.unassigned > 0 && (
                        <span
                          className="bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white"
                          title={`${counts.unassigned} not yet on a lot`}
                          data-numeric
                        >
                          {counts.unassigned}
                        </span>
                      )}
                      {total !== null && (
                        <span className="text-[11px] text-faint" data-numeric>
                          {total}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
