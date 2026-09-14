# Roadmap — what ships, what waits, and what never comes

Companion to `DFD.md` (what the system is for) and `ARCHITECTURE.md` (how it may
be built). This one is commercial: it says what opens a door, and what is being
consciously left undone so that it can.

The organising constraint is real and comes from the customer side: **clients do
not hand over their files until there is something to look at.** The demo
therefore gates the sample data, which gates the ingestion design, which gates
almost everything downstream. Nothing that does not serve the pitch belongs in
front of it.

---

## M0 — Foundations

Not demonstrable. Everything after it is.

- Repository, toolchain, CI. Clean public history; the predecessor stays archived
  and private, checked out beside this one as a read-only reference.
- Schema with `org_id` on every row from the first commit — `org`, `user`,
  `membership`, `event`, `lot`, `asset`, `override`, `pin`, `catalogue`.
- A single access gate in front of the deployed application. Not the real
  identity system; the thing that stops a public URL being a public database.
- The action log, from commit one. It cannot be retrofitted.
- `taptap3d.fly.dev` deploying from `main` on green.

---

## M1 — The pitch

**This is the definition of done for phase one: the demo script, performed
end to end, on a file we have never seen.**

1. The ERP shell is the landing — a rich left navigation, quick-add on the right,
   row-based list of events below.
2. Create an event → an empty editor.
3. Import whatever file the client brought.
4. A field-matching screen in the manner of HubSpot: suggested mappings, human
   clearance, nothing applied silently.
5. Manual clearance, plus pin/lock decisions on positions.
6. The template generates a visually pleasing layout.

**The single largest risk in the business is step 3**, because it runs live, in
front of the customer, on a file nobody here has ever opened. Spreadsheets are
handled. Everything else must degrade gracefully rather than fail — at minimum,
*paste your text here* must be a route through the screen. Over-engineer the
importer and the matching screen; under-engineer the shell's polish.

Carried into M1 rather than fixed twice in a repository being abandoned:

- Dragging objects and controls is hard; the centre canvas is occasionally
  unscrollable.
- Object selection shows a larger frame than the image it contains — resolved via
  the decouple/merge controls, so the slot and the picture are both honest.
- Caption prints over spanning artwork.
- No per-object z-order.
- A fresh shape's hairline is invisible under the selection ring.
- 符合頁面 and 符合寬度 behave identically in two-up.
- The cover is not selectable on the canvas.

---

## Deferred functions

Each of these was discussed and consciously postponed. The register exists so
that "not yet" does not decay into "forgotten", and so that the trigger for
revisiting is written down rather than remembered.

| # | Function | Why deferred | Unblocked by | Commercial value when it lands |
|---|---|---|---|---|
| D1 | **Vision style cold-start** — upload a house's past catalogues, derive their layout taste | Not needed for the pitch; the client need not surrender PDFs during a sales conversation | M1 shipped; a customer willing to share their back catalogue | The strongest demo in the product: *"upload your last three catalogues, here is your next one."* Also the answer to per-house taste, which no build-time rule can encode |
| D2 | **Listing projection** — one lot as channel-neutral structured data + images | The data model must settle first; nothing consumes it yet | M1 data model stable | Turns a catalogue tool into an online-sales system. This is the scope-(c) thesis made real |
| D3 | **Per-lot embeddable iframe** | Depends on D2 | D2 | The simplest thing a house can paste into a site they already have — lowest-friction adoption path |
| D4 | **Whole-catalogue online publication** | A genuinely different problem from D3; repeating the per-lot answer does not solve it | D2, D3 | Replaces the "digital catalogue" PDFs houses currently email |
| D5 | **Channel adapters** — Shopline, Boutir, SleekFlow | Pointless before a partner is real; each is partner-specific and cheap once the projection exists | D2 + a signed partner | Distribution. The partners already own the merchant relationships we would otherwise have to win one at a time |
| D6 | **Templates as data** — a validated layout schema rather than hardcoded shapes | **Landed** — see M1.md §8e. The decision on how much structure the engine keeps: the engine keeps the grammar (pagination, the entry, three arrangements — grid, table, sheet), the template supplies the words (densities and their budgets, page, plate, fields). Three built-ins — catalogue, price list, tearsheet — as validated constants; no table until a house authors one | ~~M1; a decision on how much structure the engine keeps~~ | Lets houses and, later, the AI author layouts. Without it, every new layout is an engineering ticket. Not yet: a screen where a house authors one (needs D14, and is the first writer of a `templates` table) |
| D7 | **AI chat bar** — image-capable, edits by natural language, generates templates | Depends on D6 for template generation; the editing half depends on a stable operation vocabulary | D6 | Runtime UX for the thing that is otherwise hectic: every house wants a different layout and none of them will learn our editor |
| D8 | **Deterministic defect gate in CI** — clipping, overlap, trim collisions | Needs the renderer ported and a stable document model first | M1 | Stops shipping broken pages. Note this covers *defects only*; taste is D1's job and belongs at runtime |
| D9 | **Actions-to-result experiment** — measure derived vs blank start | Requires both arms to exist in one system plus the action log | M1 + pins | Settles the layout-default question with evidence instead of opinion. Per house, not globally |
| D10 | **Condition reports** | Photography and assets already attach to lots; the report itself is paperwork we have not earned the right to replace | A customer doing condition checks inside the system | The natural next box in the cycle after cataloguing, and where the 3D and colour work attaches |
| D11 | **3D scanning pipeline** | Bracketed as *additional* in the operator's own diagram; the cycle completes without it | D10 | Differentiator, and the product's namesake. Not an obligation |
| D12 | **Warehouse location and logistics** | Real ERP work with real incumbents, and not where the wedge is | A customer asking, having already adopted the catalogue path | Deepens lock-in once the catalogue is indispensable |
| D13 | **Showcase module** | Named in the cycle; becomes a view over D2 rather than a new subsystem | D2 | Closes the cycle from catalogue to viewing to sale |
| D14 | **Bought identity provider + SSO** | Lower priority than the pitch; Hong Kong first and never mainland, so hosted providers are viable and the reachability objection does not apply | Real customers with real users | Enterprise houses will require their own SSO eventually |
| D15 | **Billing, plans, self-serve signup** | Selling by hand for the foreseeable future | Repeatable self-serve demand | Only worth building when sales stop being conversations |
| D16 | **Non-spreadsheet ingestion** — Word, email, PDF, scanned paper | No client samples exist yet, and building parsers for formats nobody has sent is inventing work | D1-era customer files arriving | Widens the funnel; scanned catalogues are common in this trade and nobody handles them well |
| D17 | **Second vertical / generic commerce** | A model abstracted before its second customer is abstracted along the wrong axis | An actual second vertical asking | The scope-(c) endgame: the runtime machine any physical business logs into |
| D18 | **Localisation beyond 繁體中文 and English** | No demand yet | International expansion | Follows D17's geography |

---

## Not on the roadmap at all

- **The money path** — bidding, checkout, payments, settlement. Deferred
  *indefinitely*, not scheduled. Taking money for an auction in this jurisdiction
  is a licensing project rather than a feature, and the partners in D5 already do
  it.
- **Mainland China deployment.** Hong Kong first, international later, never
  mainland. This is a standing constraint, not a sequencing decision, and it is
  why hosted infrastructure choices are unconstrained by reachability.
- **Being the house's system of record** for consignors, contracts or money. We
  are the production and publication layer.

---

## How this document is maintained

A deferred function moves when its **unblocked by** column is satisfied — not
when it becomes interesting. If a line is being pulled forward for any other
reason, that is a scope decision and it belongs in a conversation, not in a
commit.
