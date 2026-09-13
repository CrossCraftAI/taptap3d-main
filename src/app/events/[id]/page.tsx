import Link from "next/link";
import { notFound } from "next/navigation";

import { asText } from "@/lib/engine/derive";
import { getEvent } from "@/lib/data/events";
import { listLotsWithImages } from "@/lib/data/lots";
import { currentOrgId } from "@/lib/data/org";

export const dynamic = "force-dynamic";

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const lots = await listLotsWithImages(orgId, id);
  const photographed = lots.filter((l) => l.images.length > 0).length;

  return (
    <div className="px-8 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/"
            className="text-[12px] text-muted hover:text-seal hover:underline"
          >
            Events
          </Link>
          <h1 className="mt-1 truncate text-[19px] font-semibold tracking-tight">
            {event.name}
          </h1>
          <p className="mt-1 text-[12px] text-muted" data-numeric>
            {lots.length === 0
              ? "No lots yet"
              : `${lots.length} lots · ${photographed} photographed`}
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/events/${event.id}/import`}
            className="bg-seal px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[#8d241f]"
          >
            Import lots
          </Link>
          <Link
            href={`/events/${event.id}/catalogue`}
            className="border border-ruleStrong bg-paper px-3 py-1.5 text-[13px] font-medium hover:bg-field"
          >
            Catalogue
          </Link>
        </div>
      </header>

      {lots.length === 0 ? (
        /* AN EMPTY SCREEN IS AN INVITATION TO ACT, and it offers exactly one
           action because there is exactly one sensible next move. */
        <div className="mt-6 border border-rule bg-paper px-8 py-16 text-center">
          <p className="text-[14px] font-medium">This event has no lots.</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted">
            Import the file the client sent. A spreadsheet or a CSV goes straight
            in; anything else, paste the list as text and the same screen reads
            it.
          </p>
          <Link
            href={`/events/${event.id}/import`}
            className="mt-5 inline-block bg-seal px-4 py-2 text-[13px] font-medium text-white hover:bg-[#8d241f]"
          >
            Import lots
          </Link>
        </div>
      ) : (
        <div className="mt-6 border border-rule bg-paper">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] tracking-wide text-muted">
                <th className="w-28 px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="w-44 px-4 py-2 font-medium">Maker</th>
                <th className="w-52 px-4 py-2 font-medium">Estimate</th>
                <th className="w-20 px-4 py-2 text-right font-medium">Photos</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr
                  key={lot.id}
                  className="border-b border-rule last:border-b-0 hover:bg-field"
                >
                  <td className="px-4 py-2 font-medium" data-numeric>
                    {lot.ref ?? <span className="text-faint">—</span>}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2">
                    {asText(lot.fields.title) || (
                      <span className="text-faint">untitled</span>
                    )}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2 text-muted">
                    {asText(lot.fields.maker) || "—"}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2 text-muted">
                    {asText(lot.fields.price) || "—"}
                  </td>
                  <td className="px-4 py-2 text-right" data-numeric>
                    {lot.images.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      lot.images.length
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
