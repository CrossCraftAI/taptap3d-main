import Link from "next/link";
import { notFound } from "next/navigation";

import { ImportFlow } from "@/components/import-flow";
import { getEvent } from "@/lib/data/events";
import { currentOrgId } from "@/lib/data/org";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const orgId = await currentOrgId();
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  return (
    <div className="px-8 py-8">
      <header>
        <Link
          href={`/events/${event.id}`}
          className="text-[12px] text-muted hover:text-seal hover:underline"
        >
          {event.name}
        </Link>
        <h1 className="mt-1 text-[16px] font-semibold tracking-tight">
          Import lots
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
          Nothing is written until you have seen the mapping and said so.
        </p>
      </header>

      <ImportFlow eventId={event.id} />
    </div>
  );
}
