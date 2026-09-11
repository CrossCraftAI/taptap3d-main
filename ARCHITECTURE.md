# Architecture — the rules this codebase is held to

Read `DFD.md` first: it says what the system is for. This says how it is allowed
to be built.

Everything here was argued before it was written. Where a principle has a
rejected alternative, the alternative is named — a rule whose alternatives are
invisible gets broken by the next person in good faith.

---

## The product in one paragraph

A physical business's inventory record produces **both** the printed catalogue
page and the online listing, from one source of truth. For a business that still
lives on paper, that is what "integrating online sales" means — the catalogue is
already the product listing; it just never leaves the page. Auction houses first,
because unique high-value goods concentrate the GMV and already treat the
catalogue as a production artefact.

---

## Principles

### 1. Keys are never positional

An element's identity in a laid-out document is a function of where it landed:
the same lot is `p5-s1` at 4-up and `p2-s3` at 9-up. Anything keyed to that is
destroyed by the next density change.

**Every human or machine correction is keyed `(lot, field)`.** Pins are keyed by
their **members**, never by page index — a page number is as positional as an
element id, and a pin keyed to "page 5" lands on unrelated content the moment the
density moves.

*Rejected:* keying by element id, which is the obvious build and silently
orphans every edit on repagination.

### 2. Nothing is stored that the engine cannot re-derive

No pixels as truth. No markup as truth. A correction is a **value** — an angle, a
frame, a colour axis, a pin — that the engine re-applies on every derivation.
This is what lets a year of human judgement survive a layout change, and it is
what makes the same record produce a print page and a listing without either
being authored twice.

*Rejected:* saving the edited HTML, which cannot repaginate, cannot re-target,
and cannot be printed reliably.

### 3. Derived by default, pinned by exception — and the default is measured

The engine places every lot so a human does not place 500 boxes. A **pin** marks
an arrangement as settled so re-derivation leaves it alone.

Pins exist for both parties: a human correction and a machine correction need the
same persistence, or the machine's suggestions evaporate on the next repagination.

Whether a new catalogue arrives **derived** or **blank** is not settled by
argument. It is settled by counting the actions required to reach the same result
from each starting point — which is only possible because of principle 5.

*Rejected:* a free canvas like Canva. Canva is simple precisely because it never
repaginates. Also rejected: groups that silently re-flow, whose failure mode is
that a merged arrangement tears apart without telling anyone.

### 4. Correctness is deterministic and universal; taste is learned and per-tenant

These are different things and they must not share a mechanism.

- **Defects** — text clipped at the trim, elements overlapping, a plate past the
  bleed, a caption orphaned from its lot. Every house must avoid these. Cheap,
  deterministic, checked in CI, blocking.
- **Taste** — gutter rhythm, how much air, plate dominance, caption convention.
  Every house is different. Learned from that house's own material, judged at
  **runtime by a vision model**, never encoded in a build-time rule.

A deterministic quality rule encodes the *developer's* taste and ships it to
every customer, who cannot change it. That is the worst property a multi-tenant
product can have.

*Rejected:* a vision model as the blocking CI gate. Non-deterministic, slow, paid
per run, and a flapping gate is disabled within a fortnight. It reviews; it does
not block.

### 5. Every gesture is counted, from the first commit

The action log is not analytics. It is the instrument that decides principle 3,
and the measurement of "hassle" cannot be retrofitted — if gestures are not
counted from the beginning, the experiment is unrunnable when the question
arrives.

### 6. One renderer behind every output

Preview, editor canvas, print PDF, HTML export and listing all come from one
implementation. A second renderer is how the preview stops resembling the
deliverable, and it is how the predecessor project ended up with two of them.

### 7. Tenancy in the schema from commit one; login later; a gate from day one

Every row carries `org_id`. Retrofitting tenancy means touching every table,
every query and every route, and is one of the genuinely painful migrations.
Doing it at schema level now is nearly free.

The *identity provider* is a separate, deferred decision (Hong Kong first,
international later, never mainland — so hosted providers are viable). Until it
lands, the whole application sits behind a single access gate. The predecessor
shipped to the public internet with no authentication and a `DELETE` endpoint
that anyone with a URL could call; that is not repeated here.

### 8. The preview is inert because of the Content-Security-Policy

The catalogue preview renders untrusted client data in an iframe. It is safe
because the document carries `default-src 'none'` with no `script-src`, as the
first tag in `<head>` — **not** because of a `sandbox` attribute.

This distinction is not pedantry. It cost a year: WebKit dispatches **no DOM
events at all** into a frame sandboxed without `allow-scripts`, so the entire
editing layer was dead in Safari while Chromium-only testing reported everything
green. The sandbox attribute bought nothing the CSP did not already provide, and
took the product with it.

Any frame a human edits in: **no sandbox attribute, CSP enforced, verified by
injecting a script and asserting it does not run.** Display-only frames may keep
the sandbox, because it costs them nothing.

### 9. A default, not a lock

The system may decide on a specialist's behalf. It may not decide *instead* of
them. Every automatic value is visible, adjustable in the units the machine
produced it in, and reversible. An automatic correction the human cannot reach is
a defect, regardless of how good the correction is.

A corollary: a machine proposal is not an edit. Proposals live apart from
decisions, and a rejection is remembered, so the next run does not re-propose
what someone already refused.

### 10. Measure, don't assert

Claims about the system are backed by a number from the running system. "The
tests pass" is not evidence that a feature works; roughly two dozen defects in
the predecessor were found by driving the application and none of them by the
suite. Where a check is cross-cutting — two browser engines, two renderers, two
densities — **run a control and believe it.**

### 11. No money path

No bidding, no checkout, no payments, no settlement, at any point on the current
roadmap. This is a licensing project, not a feature.

---

## Layers

```
identity / tenancy     org · user · membership · org_id on every row
        │
data                   event · lot · asset · override · pin · catalogue
        │
ingest                 arbitrary file → suggested field mapping → human clearance
        │
engine                 derives a placement for every lot; obeys overrides and pins
        │
document               the tree; the only thing the renderer reads
        │
renderer               one implementation → preview · PDF · HTML · listing
        │
editor                 parent-side overlay reading the preview's contentDocument
        │
intelligence           runtime vision: style profile · layout critique · chat   [deferred]
        │
publication            print PDF · HTML export · listing projection · lot embed
```

Two rules about the layering:

**The editor never writes into the preview document.** It reads painted boxes and
commits values through the data layer; the preview is re-derived from the server's
answer. "The preview *is* the catalogue" only stays true if nothing can move a box
in the preview that could not also reach the PDF.

**The engine never reads rendered output.** Geometry it needs — an asset's subject
box, its measured dimensions — is measured once and stored against the asset, not
scraped from a render.

---

## Lessons carried from the predecessor

The archived `tap3d` repository holds these in long commit messages. They are
distilled here because the history did not travel.

- **Positional ids orphan edits.** The reason for principle 1; discovered by
  keying geometry on element ids and watching a density change destroy it.
- **A parent-side overlay must not swallow the pointer.** A transparent
  `pointer-events: auto` layer over the preview is the obvious build, and it stops
  the wheel scrolling a 43-page document. Listen on the child; let the browser's
  own stacking answer the hit test; mount capture layers only for the life of a
  gesture.
- **A disabled input is blurred by the browser**, so a field that disables itself
  while saving eats its own keystrokes. Typing `-1.37` arrived as nothing.
- **Tests that self-skip make a green headline meaningless.** Database-backed
  suites that quietly skip when the database is unreachable removed ~121 tests
  while the summary stayed green. A skip is a failure unless someone asked for it.
- **`instanceof` lies across realms.** Nodes from the preview document are not
  `instanceof Element` in the parent. Duck-type.
- **The corpus is not the world.** Two automatic-correction features shipped and
  found almost nothing to correct, because the demo photographs were already
  straight and already neutral. Absence of findings in one corpus is not evidence
  the feature is unnecessary — and is not evidence it is necessary either.
- **The specialist overrules the clever default.** A panel that decided on the
  user's behalf was rejected in one sentence: it should behave like a normal
  editor. Hence principle 9.

---

## What is deliberately absent

- A second renderer, a second ingestion stack, or a second anything. The
  predecessor carried both and they were 44% of the source tree.
- Speculative abstraction for the second vertical. The nouns are generic; the
  behaviour is auction-specific until a second customer says otherwise.
- Channel adapters before a partner exists.
- Empty tables for cycle boxes nobody performs in the system yet.
- Heuristics that approximate a judgement a model now makes directly.
