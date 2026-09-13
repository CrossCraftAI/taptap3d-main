import type { Metadata } from "next";

import { Nav } from "@/components/nav";
import { countAssets } from "@/lib/data/assets";
import { countEvents } from "@/lib/data/events";
import { currentOrgOrNull } from "@/lib/data/org";

import "./globals.css";

export const metadata: Metadata = {
  title: "taptap3d",
  description:
    "One inventory record, two destinations: the printed catalogue page and the online listing.",
};

// The rail reads the acting org, so the shell is per-request rather than static.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const org = await currentOrgOrNull();
  // The rail's numbers. Zeroes when there is no org, so the chrome renders on a
  // machine that has not been seeded rather than throwing and leaving a blank
  // page with no way to find out why.
  const [events, photographs] = org
    ? await Promise.all([countEvents(org.id), countAssets(org.id)])
    : [0, { total: 0, unassigned: 0 }];

  // zh-Hant, not zh-TW and not en: the first customers are Hong Kong auction
  // houses and the catalogue text is Traditional Chinese. Stated on the document
  // element so font fallback and line breaking start correct.
  return (
    <html lang="zh-Hant">
      <body className="min-h-full bg-field font-sans text-ink antialiased">
        <div className="flex min-h-screen">
          {/* THE RAIL DOES NOT MOVE, and it is present inside the editor too.
              The predecessor made its editor a separate world reached by a link,
              so an event was somewhere you escaped from rather than somewhere
              you were. */}
          <aside className="hidden w-56 shrink-0 border-r border-rule bg-paper md:block">
            <div className="sticky top-0 flex h-screen flex-col px-3 py-4">
              <div className="px-3">
                <p className="text-[15px] font-semibold tracking-tight">taptap3d</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">
                  {org ? org.name : "No organisation"}
                </p>
              </div>
              <Nav
                counts={{
                  events,
                  photographs: photographs.total,
                  unassigned: photographs.unassigned,
                }}
              />
              <p className="mt-auto px-3 text-[11px] leading-relaxed text-faint">
                M1 — the pitch. Catalogue production; no money path.
              </p>
            </div>
          </aside>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
