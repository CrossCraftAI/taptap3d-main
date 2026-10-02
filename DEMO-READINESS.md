# What stands between taptap3d and a corporate demo

*Written 30 Sep 2026, after items 0–3 of the current plan shipped. For the
owner, to decide an order from. Every claim below was checked against the
code or measured against the deployed instance; where something is an
estimate it says so.*

---

## The short answer

The product can take a real 160-lot sale from a client's spreadsheet to a
printed PDF and back out to the ledger. That is the hard part and it works,
on the deployed instance, with a real house's archived artwork in it.

**Two things break a demo, and they break it for different audiences.**

| | An auction house prospect | Google for Startups / investors |
|---|---|---|
| **Reordering** | Fatal in ten minutes | Barely registers |
| **Sign-in** | "Can my registrar log in?" | Cannot *show* multi-tenancy |
| Comments | Noticed | Not asked |
| Demo data | Noticed | Noticed |

The remaining item on the current plan — **Playwright in CI** — is
engineering hygiene. It is worth doing and no demo audience can see it.

---

## 1. A sale cannot be re-sequenced — 2–3 days

**What is true.** `lots.position` has exactly one writer in the codebase:
`insertLots`, at import (`src/lib/data/lots.ts`). Nothing else writes it.
`createPin` (`src/lib/data/catalogues.ts:216`) refuses a pin whose lots are
not already neighbours, and tells the specialist so.

**Why it is fatal for a house.** The running order *is* the editorial work of
an auction: the opener, the cover lot, what faces what across a spread. Today
the order is frozen at whatever order the client's spreadsheet happened to be
in. A prospect will try to drag a lot within the first few minutes, because
it is the most obvious thing on the screen to try.

**It is already designed.** Phase 4c in the current plan, including the part
that makes it safe: `createPin` enforces contiguity only at creation, because
order was immutable, so making order mutable makes the forbidden state
reachable by two individually-legal operations — pin P03+P04, then drag P06
between them, and the pin silently stops doing anything. Reorder therefore
ships *with* a pin rule: move a pin's members as a unit, refuse a move that
would split one, or allow it and surface the break.

**It also fixes a bug that is live today.** `insertLots` numbers every import
from zero, so a *second* import into an existing sale does not append — it
interleaves. That is wrong now, independent of reordering.

---

## 2. There is no sign-in — 3–5 days for the demo version

**What is true.** `users` (`src/db/schema.ts:85`) has no password column, no
session table and no provider id. `currentOrgId()` (`src/lib/data/org.ts:37`)
requires exactly one org, or an env-pinned slug. The deployed instance is
behind a single shared HTTP basic password (`src/proxy.ts`). The
`owner | admin | member` enum exists and nothing reads it for authorisation —
the only `role` in the data layer is the literal `"member"` written when a
gate identity is created.

**The groundwork is unusually good, and that is the estimate.**
`src/lib/data/actor.ts` already routes every write through `currentActorId()`
and says in its own header: *"this is written to die. When sign-in lands it
becomes a session lookup and nothing that calls `currentActorId()` changes
shape."* Twenty-eight files call `currentOrgId` or `currentActorId`. The seat
is built; the occupant is missing.

**This is not ROADMAP D14.** D14 is a *bought identity provider with SSO*, and
the roadmap defers it as "lower priority than the pitch", unblocked by "real
customers with real users". That judgement was made when the pitch was the
goal. What a demo needs is much smaller: sessions, one sign-in screen, and
`currentOrgId()` reading the membership instead of counting rows. SSO stays
deferred.

**Why investors need it too, and this is the part that is easy to miss.**
Tenancy is genuinely real — 15 of the 17 tables carry `org_id`, and the two
that do not are `orgs` and `users`. It has been that way since the first
migration, which is the strongest architectural claim the product has. But
**you cannot demonstrate it**, because `currentOrgId()` throws on two orgs by
design. The claim is true and unprovable on screen. Adding sign-in plus the
org switcher (scheduled as S3, estimated "D14 plus an afternoon" — the top bar
already renders the house's name exactly where the switcher goes, and
`switcher.tsx` is a working two-axis control) makes it demonstrable.

**This is the one item that serves both audiences.**

---

## 3. Nobody can leave a note — part of Phase 9

There is no comments table. A house reviewing a proof has nowhere to write
"this caption is wrong" — the conversation happens in email, which is what
the product is meant to replace. The predecessor's `comments-panel.tsx` and
`comment-state.ts` (558 lines) are unported and scheduled in Phase 9.

Lower priority than 1 and 2: a prospect notices it, but it does not stop the
demo.

---

## 4. The demo data — one thing fixed, one thing needing your call

### Fixed, 2 Oct

Lot P01 of the UAT sale read `01.04.97 / 01.04.97`.

**I had this wrong in the first version of this document**, which called it "a
date mapped to the wrong column in the client's own spreadsheet". It was not.
The lot's own notes say so: *此作《01.04.97》為趙無極晚期重要油畫* — the work
genuinely IS titled 01.04.97, because Zao Wou-Ki dated his paintings instead
of naming them. The title was right and the record was wrong in a different
way: every other lot carries `{zh, en}` as two keys, and this one had the two
concatenated into `zh` because they are identical strings.

Corrected to `{"zh": "01.04.97", "en": "01.04.97"}` on the deployed instance.
Four rows — the same lot in each of the four copies of the sale — and nothing
else in the database had a slash in a title.

### Still open: the ledger is four copies of one sale, named for testers

    TEST                                            0 lots
    ★ UAT 測試用 — 43 件拍品・42 張圖（請用這一本）   43
    （備份示範・43 件・42 張圖）                      43
    （系統測試檔・沒有圖，不適合測試）                 43
    （舊版示範・只有 10 張圖）                        43

A prospect opening the product sees five sales, four of which are the same
sale, with names that are instructions to us: *please use this one*, *backup
demo*, *system test file, not suitable for testing*, *old demo, only 10
images*. That is the "developer note" category the owner asked to have
removed — scaffolding showing through the product.

**Not acted on, because it is destructive and outward-facing.** The owner's
standing instruction is to keep the UAT sale; the other three were never
mentioned, and deleting a sale carrying a client's archived artwork is not a
thing to infer. Renaming is the reversible alternative and still edits their
data.

Needs one decision: delete the three duplicates, rename all of them to
plausible sale names, or leave them.

## What I would NOT build for a demo

- **The money path.** Refused by rule (ARCHITECTURE.md principle 11), and in
  this jurisdiction it is a licensing project before it is a feature. S2's
  answer — a partner takes the money, and the partners already hold the
  licences — is a positioning answer and needs no code.
- **The free-object layer, rulers, spreads** (Phase 8). A specialist will want
  them; a demo survives without them.
- **Vocabulary** (Phase 10), **the workflow engine** (TBD until GCP).
- **The photograph library rebuild.** Refused on measurement: the gestures the
  drawing asks for already ship.

---

## Suggested order, and the trade in each

| | Item | Days | Serves | If you skip it |
|---|---|---|---|---|
| **A** | Sign-in + org switcher | 3–5 | Both | Cannot show two houses; cannot answer "who can log in" |
| **B** | The running order, with the pin rule | 2–3 | House prospect | The first thing a specialist tries does not work |
| **C** | Demo data tidy-up | hours | Both | First lot looks broken |
| **D** | Playwright in CI | 1 | Neither, directly | The safety net stays manual |
| **E** | Comments | ~3 | House prospect | Review happens in email |

**A before B** because it serves both audiences and because the org switcher
is nearly free once sessions exist. **C at any point** — it is an afternoon.
**D whenever there is a gap**; it protects everything above it but shows
nobody anything.

If only one thing gets built: **A**. If only one thing gets built for an
auction house specifically: **B**.

---

## What is already demo-ready, and worth saying out loud

Because the list above is all gaps, and the gaps are not the product:

- A real 160-lot sale, imported from a pasted spreadsheet with a cleared
  column mapping, 40 pages, Traditional Chinese throughout.
- Three templates drawn by the engine as page proxies, a density control, and
  a page rail that reaches page 23 of 43.
- Per-catalogue typeface, 明體 or 黑體, with the machine told when its own
  fonts cannot show the specialist the page the printer will make.
- Field visibility enforced in the engine, so a reserve cannot reach a public
  output even if a template names it.
- Movement and condition, with provenance printed from the chain.
- The lot record's four tabs, including where the record itself came from —
  which row of which file, under which mapping.
- A PDF that reports what it painted, including whether Chinese glyphs
  actually rendered rather than whether a font was named.
- 1,165 unit tests and 118 end-to-end across two browser engines.
