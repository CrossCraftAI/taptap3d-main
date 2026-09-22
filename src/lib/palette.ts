// The palette's catalogue: what you can make from where you are standing.
//
// ── MAILCHIMP'S OBJECT CATALOGUE, AND WHY IT IS NEARLY EMPTY ────────────────
//
// The shape is borrowed deliberately: a spine of panels, and inside a panel
// groups of DESCRIBED rows — a name, one sentence, and the verb of what
// happens. Mailchimp's builder says "Form builder — Build, design, and
// translate signup forms" rather than offering a chip that says "Form", and
// the sentence is the feature: a house evaluating this product is exactly the
// reader who does not already know what we mean by a word.
//
// The mockup this is drawn from names 111 objects. Almost none of them exist
// here yet, and a row that names one and does nothing is worse than no row:
// test/e2e/rail.spec.ts already holds "every place is a place, not a dead
// link" and the same rule applies with more force to a panel whose whole
// promise is "you can add this". So the catalogue below is what the product
// can actually do today, and it is short. It grows by a row per capability,
// which is the only way it can grow honestly.
//
// ── PLACES IN THE RAIL, ACTIONS HERE ────────────────────────────────────────
//
// The dividing line is the one src/lib/nav.ts already draws. The rail answers
// "where am I"; this answers "what can I make". Import is the clearest case: it
// is a page, so it COULD be a rail item, but nobody navigates to an import —
// they import. It is one row here and no row there.
//
// A row that points at the screen you are already on is dropped rather than
// disabled or marked "you are here". A control whose only outcome is to stay
// put is the dead control this file exists to avoid, and the page it would
// have sent you to is already showing its own way in.
//
// ── PURE, SO IT IS HELD IN NODE ─────────────────────────────────────────────
//
// Every row carries Next's own route PATTERN beside the filled-in href, and
// test/palette.test.ts checks each pattern against src/app. That is a stronger
// guard than `typedRoutes` can give — a path assembled from an event id is a
// `string` to the compiler whatever it is annotated as — and it is the check
// that fails in a second rather than in a browser when a page is renamed.

export interface PaletteRow {
  key: string;
  name: string;
  /** One sentence. What it is and what happens, not what it is called. */
  note: string;
  /** The chip: the verb of what you will be doing at the other end. */
  verb: string;
  /** Next's own route pattern — what test/palette.test.ts looks for on disk. */
  route: string;
  href: string;
  /**
   * True when the answer is a stream of bytes rather than a screen, so the row
   * renders as a plain anchor. A client-side navigation has nowhere to put a
   * PDF; src/app/exports/page.tsx made the same call for the same reason.
   */
  stream?: boolean;
}

export interface PaletteGroup {
  key: string;
  name: string;
  rows: PaletteRow[];
}

export interface PalettePanel {
  key: string;
  /** The only label the spine can show. The word lives in aria-label and title. */
  icon: string;
  label: string;
  /** The head sentence: how this panel is used, in one line. */
  head: string;
  groups: PaletteGroup[];
}

export interface PaletteContext {
  pathname: string;
  /** The event the URL is inside, or null. src/lib/nav.ts `openEventId`. */
  eventId: string | null;
  /** Lots in that event. Nothing prints from an empty sale, so nothing offers it. */
  lots: number;
}

/**
 * The panels this screen has, with the rows that are real from here.
 *
 * Empty groups and empty panels are dropped, and an empty result means no
 * palette at all: a 44px spine that opens onto nothing is chrome that lies
 * about having something in it.
 */
export function paletteFor(context: PaletteContext): PalettePanel[] {
  const { pathname, eventId, lots } = context;

  const add: PalettePanel = {
    key: "add",
    icon: "+",
    label: "Add",
    head: "Pick one and it opens where that is done.",
    groups: [
      {
        key: "sale",
        name: "This event",
        rows: eventId
          ? [
              {
                key: "lots",
                name: "Lots",
                note:
                  "A spreadsheet the client sent, or a table pasted in. Columns " +
                  "are matched to fields and nothing is written until you confirm " +
                  "the match.",
                verb: "Import",
                route: "/events/[id]/import",
                href: `/events/${eventId}/import`,
              },
            ]
          : [],
      },
      {
        key: "house",
        name: "The house",
        rows: [
          {
            key: "photographs",
            name: "Photographs",
            note:
              "Drop a shoot folder onto the library. A file is held once, by its " +
              "content, however many lots print it.",
            verb: "Upload",
            route: "/photographs",
            href: "/photographs",
          },
        ],
      },
    ],
  };

  // THE DOCUMENT'S DEFAULTS ARE NOT HERE, and that is on purpose rather than
  // unfinished. Template, density, photograph placement, fit and "print the
  // reference" are one stored object and they already have live controls on the
  // editor's own toolbar (src/components/catalogue-controls.tsx). A second set
  // of controls here would have to post all five to
  // `setCatalogueParamsAction`, which re-normalises everything it is given — so
  // a panel that knew only the template would silently reset the fit and the
  // reference every time someone changed it. Moving those controls INTO this
  // panel is the right end state and it would give the editor back a toolbar
  // row; it is a change to the editor, made by whoever owns the editor, and it
  // is not made halfway from out here.
  const doc: PalettePanel = {
    key: "doc",
    icon: "▤",
    label: "Document",
    head: "What this event's document produces.",
    groups: [
      {
        key: "print",
        name: "Print",
        rows:
          eventId && lots > 0
            ? [
                {
                  key: "pdf",
                  name: "PDF",
                  note:
                    "The document as the printer receives it. One renderer paints " +
                    "the preview and this, so the two cannot differ.",
                  verb: "Download",
                  route: "/events/[id]/catalogue/pdf",
                  href: `/events/${eventId}/catalogue/pdf`,
                  stream: true,
                },
              ]
            : [],
      },
    ],
  };

  return [add, doc]
    .map((panel) => ({
      ...panel,
      groups: panel.groups
        .map((group) => ({
          ...group,
          rows: group.rows.filter((row) => row.href !== pathname),
        }))
        .filter((group) => group.rows.length > 0),
    }))
    .filter((panel) => panel.groups.length > 0);
}

/** Every row of a panel, flattened — what the search reads and counts. */
export function rowsOf(panel: PalettePanel): PaletteRow[] {
  return panel.groups.flatMap((group) => group.rows);
}

/**
 * Whether a row survives a search.
 *
 * Substring over the name AND the sentence, because the sentence is where the
 * word a person actually knows lives: nothing here is called "spreadsheet",
 * and "spreadsheet" is what they will type.
 */
export function matchesSearch(row: PaletteRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.name} ${row.note} ${row.verb}`.toLowerCase().includes(q);
}
