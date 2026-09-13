"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * The rail.
 *
 * Two sections, each a place rather than a page: things being catalogued, and
 * the photographs that will end up in them. Both carry a count, because the
 * first question anyone asks an operations system is "how much is in there" and
 * making them click to find out is how a rail becomes decoration.
 *
 * The badge on Photographs is the one number worth interrupting for: how many
 * have arrived and not yet been filed. That is the queue, and a queue nobody can
 * see is a queue nobody works.
 */
const SECTIONS: { href: Route; label: string; match: (p: string) => boolean }[] = [
  {
    href: "/",
    label: "Events",
    match: (p) => p === "/" || p.startsWith("/events"),
  },
  {
    href: "/photographs",
    label: "Photographs",
    match: (p) => p.startsWith("/photographs"),
  },
];

export function Nav({
  counts,
}: {
  counts: { events: number; photographs: number; unassigned: number };
}): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav className="mt-6 flex flex-col gap-px">
      {SECTIONS.map((section) => {
        const active = section.match(pathname);
        const total = section.href === "/" ? counts.events : counts.photographs;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2 px-3 py-1.5 text-[13px] ${
              active
                ? "bg-sunk font-medium text-ink"
                : "text-muted hover:bg-sunk hover:text-ink"
            }`}
          >
            <span className="flex-1">{section.label}</span>
            {section.href === "/photographs" && counts.unassigned > 0 && (
              <span
                className="bg-seal px-1.5 py-0.5 text-[10px] font-medium text-white"
                title={`${counts.unassigned} not yet on a lot`}
                data-numeric
              >
                {counts.unassigned}
              </span>
            )}
            <span className="text-[11px] text-faint" data-numeric>
              {total}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
