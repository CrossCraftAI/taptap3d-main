"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The rail's links.
 *
 * A client component only because the active item has to be known, and knowing
 * it needs the pathname. Everything else in the shell stays on the server.
 */
export function Nav(): React.ReactElement {
  const pathname = usePathname();
  const onEvents = pathname === "/" || pathname.startsWith("/events");

  return (
    <nav className="mt-6 flex flex-col gap-px">
      <Link
        href="/"
        aria-current={onEvents ? "page" : undefined}
        className={`flex items-center justify-between px-3 py-1.5 text-[13px] ${
          onEvents
            ? "bg-sunk font-medium text-ink"
            : "text-muted hover:bg-sunk hover:text-ink"
        }`}
      >
        Events
      </Link>
    </nav>
  );
}
