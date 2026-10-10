import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { currentOrgId, fieldPolicyOf } from "@/lib/data/org";
import { getLot } from "@/lib/data/lots";
import { listAssetsForLot } from "@/lib/data/assets";
import { organisationRole } from "@/lib/data/access";
import { publicationForLot } from "@/lib/data/publications";
import { levelOf } from "@/lib/engine/visibility";
import { publicId, publicationOrigin, isPublishableField } from "@/lib/publication";
import { approveAction, withdrawAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function PublishPage({ params }: { params: Promise<{ id: string; lotId: string }> }) {
  const { id, lotId } = await params, orgId = await currentOrgId();
  const lot = await getLot(orgId, lotId);
  if (!lot || lot.eventId !== id) notFound();
  const role = await organisationRole(orgId);
  if (role !== "owner" && role !== "admin") return <main className="p-8"><h1>Publish listing</h1><p>An administrator must approve public listings.</p></main>;
  const [policy, photos, publication] = await Promise.all([fieldPolicyOf(orgId), listAssetsForLot(orgId, lotId), publicationForLot(orgId, lotId)]);
  const keys = Object.keys(lot.fields).filter(key => !key.startsWith("_") && levelOf(policy, key) === "public" && isPublishableField(lot.fields[key]));
  let origin: string;
  try { origin = publicationOrigin(); } catch { return <main className="p-8"><h1>Publish listing</h1><p>Publication is unavailable until the service address is configured.</p></main>; }
  const pid = publication ? publicId(publication.id) : null;
  return <main className="max-w-3xl space-y-6 p-8 text-[13px]"><h1 className="text-[16px] font-semibold">Publish listing · {lot.ref}</h1>
    <p>Select exactly what may appear publicly. This approves a snapshot of the record; later record edits and catalogue overrides do not change it.</p>
    <ActionForm action={approveAction}><input type="hidden" name="lotId" value={lotId} />
      <fieldset className="space-y-3 border border-rule bg-paper p-5"><legend>Approved fields</legend>
        {keys.map(key => <label key={key} className="min-h-[var(--tap)] block"><input className="min-h-[var(--tap)]" type="checkbox" name="fields" value={key} /> <strong>{key}</strong><span className="ml-3 whitespace-pre-wrap">{typeof lot.fields[key] === "object" ? Object.entries(lot.fields[key] as Record<string, string>).map(([language, text]) => `${language}: ${text}`).join("\n") : String(lot.fields[key])}</span></label>)}
        <label className="min-h-[var(--tap)] block">Title <select name="titleField" required className="min-h-[var(--tap)] ml-2 border border-rule p-2"><option value="">Choose a selected field</option>{keys.map(key => <option key={key}>{key}</option>)}</select></label>
        <p>Description includes the selected fields below, in record order:</p>{keys.map(key => <label className="min-h-[var(--tap)] mr-4 inline-block" key={key}><input className="min-h-[var(--tap)]" type="checkbox" name="descriptionFields" value={key} /> {key}</label>)}
        <label className="min-h-[var(--tap)] block">Language <select name="language" className="min-h-[var(--tap)] ml-2 border border-rule p-2"><option value="zh-Hant">Traditional Chinese</option><option value="en">English</option></select></label>
      </fieldset>
      <p>For bilingual fields, only the chosen language is published. A missing translation must be supplied before approval.</p>
      <fieldset className="space-y-3 border border-rule bg-paper p-5"><legend>Approved images</legend>{photos.map(photo => <label key={photo.id} className="min-h-[var(--tap)] block"><input className="min-h-[var(--tap)]" type="checkbox" name="images" value={photo.contentHash} /> {photo.originalName ?? "Photograph"}</label>)}
        <label className="min-h-[var(--tap)] block"><input className="min-h-[var(--tap)]" type="checkbox" name="imageRights" /> We have permission to publish the selected images.</label></fieldset>
      <label className="min-h-[var(--tap)] block">Website origins allowed to embed or fetch this listing<textarea name="origins" rows={3} defaultValue={publication?.origins.join("\n") ?? ""} placeholder="https://shop.example.com" className="min-h-[var(--tap)] mt-2 block w-full border border-rule p-2" /></label>
      <p>One HTTPS origin per line. Anyone with the public link can read the approved listing. Origin registration restricts browser integrations, not public access.</p>
      <label className="min-h-[var(--tap)] block"><input className="min-h-[var(--tap)]" type="checkbox" name="reviewed" required /> I reviewed these fields and images and approve their public release.</label>
      <button className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-4 py-2">Approve public revision</button>
    </ActionForm>
    {pid && <section className="space-y-3 border border-rule bg-paper p-5"><h2 className="font-medium">{publication!.withdrawnAt ? "Previous publication withdrawn" : "Public integration"}</h2>
      <label className="min-h-[var(--tap)] block">Listing URL<input readOnly value={`${origin}/p/${pid}`} className="min-h-[var(--tap)] block w-full border border-rule p-2" /></label>
      <label className="min-h-[var(--tap)] block">JSON URL<input readOnly value={`${origin}/v1/publications/${pid}`} className="min-h-[var(--tap)] block w-full border border-rule p-2" /></label>
      <label className="min-h-[var(--tap)] block">Embed HTML<textarea readOnly rows={3} className="min-h-[var(--tap)] block w-full border border-rule p-2" value={`<iframe src="${origin}/embed/${pid}" title="Public listing" width="100%" height="600" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe>`} /></label>
      {!publication!.withdrawnAt && <ActionForm action={withdrawAction}><input type="hidden" name="publicationId" value={pid} /><label className="min-h-[var(--tap)] block"><input className="min-h-[var(--tap)]" name="confirmed" type="checkbox" required /> Withdraw this publication, including every older revision and image URL.</label><button className="min-h-[var(--tap)] border border-ruleStrong px-4 py-2">Withdraw publication</button></ActionForm>}
    </section>}
  </main>;
}
