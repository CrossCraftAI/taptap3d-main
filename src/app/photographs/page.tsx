import Link from "next/link";

import { Dropzone } from "@/components/dropzone";
import { PageHeader } from "@/components/page-header";
import { PhotographLibrary } from "@/components/photograph-library";
import { countAssets, listAssets, type AssetFilter } from "@/lib/data/assets";
import { listLotChoices } from "@/lib/data/lots";
import { currentOrgOrNull } from "@/lib/data/org";

export const dynamic = "force-dynamic";

const FILTERS: { key: AssetFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "assigned", label: "On a lot" },
];

export default async function PhotographsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}): Promise<React.ReactElement> {
  const org = await currentOrgOrNull();
  if (!org) {
    return (
      <div className="mx-auto max-w-lg px-8 py-20">
        <h1 className="text-lg font-semibold">No organisation yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Photographs belong to an organisation, so there is nowhere to put one
          until there is one.
        </p>
      </div>
    );
  }

  const { filter: raw } = await searchParams;
  const filter: AssetFilter =
    raw === "unassigned" || raw === "assigned" ? raw : "all";

  const [rows, counts, lots] = await Promise.all([
    listAssets(org.id, { filter }),
    countAssets(org.id),
    listLotChoices(org.id),
  ]);

  return (
    <div className="px-8 py-8">
      <PageHeader
        title="Photographs"
        meta={
          counts.total === 0
            ? "none yet"
            : `${counts.total} held · ${counts.unassigned} not on a lot`
        }
      />

      {/* THE FILTER IS THE WORKFLOW, not a refinement. "Unassigned" is the pile a
          cataloguer works through, so it is one click from the landing rather
          than behind a search. */}
      <div className="mt-4 flex gap-px border-b border-rule">
        {FILTERS.map((option) => {
          const active = option.key === filter;
          const count =
            option.key === "all"
              ? counts.total
              : option.key === "unassigned"
                ? counts.unassigned
                : counts.total - counts.unassigned;
          return (
            <Link
              key={option.key}
              href={option.key === "all" ? "/photographs" : `/photographs?filter=${option.key}`}
              aria-current={active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${
                active
                  ? "border-seal font-medium text-ink"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {option.label}
              <span className="ml-1.5 text-[11px] text-faint" data-numeric>
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      <Dropzone>
        <PhotographLibrary assets={rows} lots={lots} filter={filter} />
      </Dropzone>
    </div>
  );
}
