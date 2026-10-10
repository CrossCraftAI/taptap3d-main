import { ActionForm } from "@/components/action-form";
import { currentOrgId } from "@/lib/data/org";
import { organisationRole } from "@/lib/data/access";
import { listMembers } from "@/lib/data/team";
import { inviteAction, memberAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function TeamPage() {
  const orgId = await currentOrgId();
  if (await organisationRole(orgId) !== "owner") return <main className="p-8"><h1>Team access</h1><p>The organisation owner manages team access.</p></main>;
  const members = await listMembers(orgId);
  return <main className="max-w-3xl space-y-6 p-8 text-[13px]"><h1 className="text-[16px] font-semibold">Team access</h1>
    <p>Members edit records and catalogues. Administrators also manage settings and approve public listings. Owners manage team access.</p>
    <section className="border border-rule bg-paper p-5"><h2 className="mb-4 font-medium">Grant access</h2><ActionForm action={inviteAction}>
      <label className="min-h-[var(--tap)] block">Google account email <input className="min-h-[var(--tap)] ml-2 border border-rule p-2" name="email" type="email" required maxLength={254} /></label>
      <label className="min-h-[var(--tap)] block">Role <select name="role" className="min-h-[var(--tap)] ml-2 border border-rule p-2"><option value="member">Member</option><option value="admin">Administrator</option><option value="owner">Owner</option></select></label>
      <button className="min-h-[var(--tap)] border border-ruleStrong px-4 py-2">Grant access</button></ActionForm></section>
    {members.map(member => <section key={member.id} className="border border-rule bg-paper p-5"><h2 className="font-medium">{member.email}</h2>
      <p className="mb-3 text-muted">{member.joined ? "Has signed in" : "Awaiting first sign-in"}</p><ActionForm action={memberAction}>
        <input type="hidden" name="userId" value={member.id} /><label className="min-h-[var(--tap)]">Role <select name="role" defaultValue={member.role} className="min-h-[var(--tap)] border border-rule p-2"><option value="member">Member</option><option value="admin">Administrator</option><option value="owner">Owner</option><option value="remove">Remove access</option></select></label>
        <button className="min-h-[var(--tap)] ml-3 border border-ruleStrong px-4 py-2">Update access</button></ActionForm></section>)}
  </main>;
}
