import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "taptap3d",
  description:
    "One inventory record, two destinations: the printed catalogue page and the online listing.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // zh-Hant, not zh-TW and not en: the first customers are Hong Kong auction
  // houses and the catalogue text is Traditional Chinese. Stated in the document
  // element so font fallback and line breaking start correct rather than being
  // corrected later.
  return (
    <html lang="zh-Hant">
      <body className="min-h-full bg-white text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
