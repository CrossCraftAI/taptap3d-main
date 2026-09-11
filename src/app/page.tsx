const DOCS = [
  { file: "DFD.md", question: "What the system is for" },
  { file: "ARCHITECTURE.md", question: "How it may be built" },
  { file: "ROADMAP.md", question: "What ships, what waits, what never comes" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">taptap3d</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          One inventory record, two destinations: the printed catalogue page and
          the online listing.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <p className="text-sm font-medium">M0 — foundations</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          There is no product here yet, and this page says so rather than
          pretending otherwise. The shell, the importer and the editor arrive at
          M1.
        </p>
      </div>

      <ul className="space-y-2 text-sm">
        {DOCS.map((doc) => (
          <li key={doc.file} className="flex gap-3">
            <code className="font-mono text-slate-500">{doc.file}</code>
            <span className="text-slate-600 dark:text-slate-400">
              {doc.question}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
