import Link from "next/link";
import type { Route } from "next";

/**
 * One header shape for every object in the system.
 *
 * Where you are, what it is, what it amounts to, and what you can do to it — in
 * the same four places on every screen. That consistency is most of what makes
 * an ERP navigable: a person learns the frame once and then only has to read the
 * contents. It is also what makes the product legible to something integrating
 * with it later, because every object turns out to have the same parts.
 */
export function PageHeader<T extends string>({
  parent,
  title,
  meta,
  actions,
}: {
  // Generic over the route so a dynamic href — `/events/${id}` — type-checks
  // the way it does on Link. A bare `Route` accepts only the literal routes.
  parent?: { href: Route<T>; label: string };
  title: string;
  /** The one line of numbers that says what this object amounts to. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {parent && (
          <Link
            href={parent.href}
            className="text-[12px] text-muted hover:text-seal hover:underline"
          >
            {parent.label}
          </Link>
        )}
        <h1
          className={`truncate text-[19px] font-semibold tracking-tight ${parent ? "mt-1" : ""}`}
        >
          {title}
        </h1>
        {meta && (
          <p className="mt-1 text-[12px] text-muted" data-numeric>
            {meta}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
