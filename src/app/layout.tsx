import type { Metadata } from "next";

import { Shell } from "@/components/shell";
import { countAssets } from "@/lib/data/assets";
import { listEventChoices } from "@/lib/data/events";
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
  // The chrome's numbers, and the switcher's list. Empty when there is no org,
  // so the chrome renders on a machine that has not been seeded rather than
  // throwing and leaving a blank page with no way to find out why.
  //
  // `listEventChoices` rather than `countEvents`: the top bar has to name the
  // sales to offer them, and the rail's count is then that list's length, so
  // the switcher costs no query the rail was not already making.
  const [events, photographs] = org
    ? await Promise.all([listEventChoices(org.id), countAssets(org.id)])
    : [[], { total: 0, unassigned: 0 }];

  // zh-Hant, not zh-TW and not en: the first customers are Hong Kong auction
  // houses and the catalogue text is Traditional Chinese. Stated on the document
  // element so font fallback and line breaking start correct.
  return (
    <html lang="zh-Hant">
      <body className="min-h-full bg-field font-sans text-ink antialiased">
        {/* THE NAVIGATION CAN BE PUT AWAY, and the editor arrives with it away.
            The shell owns that (src/components/shell.tsx, src/lib/chrome.ts);
            this layout only reads what the chrome shows. Measured before: the
            chrome had 78% of a 1440×900 window and the page had 22%.

            The ORG is resolved per request and passed in — never read from a
            constant anywhere below. src/components/top-bar.tsx says what has
            to be true before a second one can be chosen here. */}
        <Shell
          org={org?.name ?? null}
          events={events}
          counts={{
            events: events.length,
            photographs: photographs.total,
            unassigned: photographs.unassigned,
          }}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
