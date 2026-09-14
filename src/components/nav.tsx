"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV } from "@/lib/nav";

/**
 * The rail: what is built, as a flat list.
 *
 * Places, never actions — a global "Import" cannot know which sale a specialist
 * means, and the ledger's Next column answers that per sale. An object's own
 * header keeps its own buttons; nothing is hoisted up here.
 *
 * No categories, no carets, no remembered state. The reasoning is in
 * src/lib/nav.ts; the short version is that four items do not need a filing
 * system, and the one they had implied an order that misled.
 */
export function Nav({
  counts,
}: {
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav aria-label="Sections" className="mt-6">
      <ul className="flex flex-col gap-px">
        {NAV.map((item) => {
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
                className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${
                  isActive
                    ? "bg-sunk font-medium text-ink"
                    : "text-muted hover:bg-sunk hover:text-ink"
                }`}
              >
                <span className="flex-1">{item.label}</span>
                {/* The one number worth interrupting for: how many photographs
                    have arrived and not yet been filed. That is the queue, and
                    a queue nobody can see is a queue nobody works. */}
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
      {/* THE HAIRLINE CLOSES THE LIST. Above it is everything that is built;
          below it is nothing, and the rule is what makes that read as a
          decision rather than as a menu that stopped loading. The roadmap's
          names — custody, channels, administration — are not here as labels
          with "not yet" on them, because a feature list is not a roadmap. */}
      <hr className="mx-3 mt-3 border-0 border-t border-rule" />
    </nav>
  );
}
