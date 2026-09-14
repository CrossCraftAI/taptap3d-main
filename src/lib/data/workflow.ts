// Which workflow an organisation is on.
//
// Today: the built-in, for everyone. This function exists so that the ledger,
// the event page and the call to action ask ONE question — "what is this
// house's workflow?" — rather than importing a constant, because the constant
// is the thing that will change. SOPs differ enormously between an auction
// house, a gallery and a museum, and the day a house authors its own (through
// `workflowSchema`, the gate a stored row passes through), this reads a row and
// nothing that calls it changes shape. Like org.ts, it is written to be
// replaced.
//
// `orgId` is taken and not yet read, deliberately: the callers already pass the
// tenant, which is the argument the real lookup will need, and a signature that
// changes later is a signature every caller changes with it. Null is "no org
// resolved" — the chrome renders on a machine that has not been seeded, and it
// renders on the built-in.
//
// Rejected: a `workflow` column on `orgs` now. Nothing writes it and nothing
// offers a second value to store — an id with one possible value is a table
// with no writer by another name (DFD.md §2).

import { workflowFor, type Workflow } from "@/lib/workflow";

export async function workflowOf(_orgId: string | null): Promise<Workflow> {
  return workflowFor(undefined);
}
