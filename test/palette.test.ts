// The palette's catalogue, held to the one rule it exists under: every row is
// a thing this product can actually do.
//
// The drawing it comes from names 111 objects and flashes "shown for reference"
// when you press one. A deployed application may not do that, so the guard here
// is the same one test/nav.test.ts puts on the rail — every destination is
// checked against src/app on disk — plus the checks that are specific to a
// catalogue: that no panel or group is shown empty, that no row offers the
// screen you are already on, and that nothing is offered for a document that
// cannot be produced.

import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { matchesSearch, paletteFor, rowsOf, type PaletteRow } from "@/lib/palette";

const ROOT = path.resolve(import.meta.dirname, "..");
const EVENT = "11111111-2222-3333-4444-555555555555";

/** A page or a route handler: the PDF is bytes, and bytes are a route. */
function servedBy(route: string): string | null {
  const dir = path.join(ROOT, "src", "app", route === "/" ? "" : route);
  for (const file of ["page.tsx", "route.ts"]) {
    if (existsSync(path.join(dir, file))) return file;
  }
  return null;
}

/** Every row the palette can ever draw, from the richest context there is. */
const EVERY: PaletteRow[] = paletteFor({
  pathname: `/events/${EVENT}`,
  eventId: EVENT,
  lots: 12,
}).flatMap(rowsOf);

describe("every row goes somewhere that exists", () => {
  it("draws more than nothing, or the checks below pass by being empty", () => {
    // The predecessor's lesson: a walk that silently matches zero files
    // reports success for weeks.
    expect(EVERY.length).toBeGreaterThan(0);
  });

  it.each(EVERY.map((row) => [row.name, row.route]))(
    "%s → %s is served",
    (_name, route) => {
      expect(servedBy(route)).not.toBeNull();
    },
  );

  it("fills every dynamic segment of the href", () => {
    for (const row of EVERY) {
      expect(row.href, row.name).not.toContain("[");
      expect(row.href.startsWith("/"), row.name).toBe(true);
    }
  });

  it("says what happens, in a name, a sentence and a verb", () => {
    // The sentence IS the feature: a chip that says only "Provenance" assumes
    // the reader already knows what this product means by the word, which is
    // exactly what a house evaluating it does not.
    for (const row of EVERY) {
      expect(row.name.length, row.name).toBeGreaterThan(0);
      expect(row.verb.length, row.name).toBeGreaterThan(0);
      expect(row.note.length, row.name).toBeGreaterThan(20);
      expect(row.note.trimEnd().endsWith("."), row.name).toBe(true);
    }
  });

  it("gives every row a key of its own", () => {
    const keys = EVERY.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("nothing empty is ever drawn", () => {
  const contexts = [
    { pathname: "/", eventId: null, lots: 0 },
    { pathname: "/photographs", eventId: null, lots: 0 },
    { pathname: "/catalogues", eventId: null, lots: 0 },
    { pathname: "/exports", eventId: null, lots: 0 },
    { pathname: `/events/${EVENT}`, eventId: EVENT, lots: 0 },
    { pathname: `/events/${EVENT}`, eventId: EVENT, lots: 12 },
    { pathname: `/events/${EVENT}/catalogue`, eventId: EVENT, lots: 12 },
    { pathname: `/events/${EVENT}/import`, eventId: EVENT, lots: 12 },
  ];

  it.each(contexts.map((c) => [c.pathname, c.eventId, c.lots] as const))(
    "%s (event %s, %i lots) has no hollow panel or group",
    (pathname, eventId, lots) => {
      for (const panel of paletteFor({ pathname, eventId, lots })) {
        expect(panel.groups.length, panel.key).toBeGreaterThan(0);
        for (const group of panel.groups) {
          expect(group.rows.length, `${panel.key}/${group.key}`).toBeGreaterThan(0);
        }
      }
    },
  );

  it("never offers the screen you are standing on", () => {
    for (const context of contexts) {
      for (const panel of paletteFor(context)) {
        for (const row of rowsOf(panel)) {
          expect(row.href, `${context.pathname} → ${row.name}`).not.toBe(
            context.pathname,
          );
        }
      }
    }
  });

  it("has nothing at all to say on the library with no event open", () => {
    // The one row that would show there is the library itself. A 44px spine
    // that opens onto nothing is chrome promising something is inside it.
    expect(paletteFor({ pathname: "/photographs", eventId: null, lots: 0 })).toEqual(
      [],
    );
  });
});

describe("what each context offers", () => {
  it("offers an import only inside an event", () => {
    const outside = paletteFor({ pathname: "/", eventId: null, lots: 0 }).flatMap(
      rowsOf,
    );
    expect(outside.map((row) => row.key)).not.toContain("lots");

    const inside = paletteFor({
      pathname: `/events/${EVENT}`,
      eventId: EVENT,
      lots: 0,
    }).flatMap(rowsOf);
    expect(inside.map((row) => row.key)).toContain("lots");
    expect(inside.find((row) => row.key === "lots")?.href).toBe(
      `/events/${EVENT}/import`,
    );
  });

  it("offers no PDF for a sale with nothing in it", () => {
    // A Chromium launch that prints an empty document is four seconds spent
    // saying nothing; src/app/exports/page.tsx refuses it for the same reason.
    const empty = paletteFor({
      pathname: `/events/${EVENT}`,
      eventId: EVENT,
      lots: 0,
    });
    expect(empty.map((panel) => panel.key)).toEqual(["add"]);

    const full = paletteFor({
      pathname: `/events/${EVENT}`,
      eventId: EVENT,
      lots: 1,
    });
    expect(full.map((panel) => panel.key)).toEqual(["add", "doc"]);
    expect(full[1] && rowsOf(full[1])[0]?.stream).toBe(true);
  });
});

describe("the search reads the sentence, not just the name", () => {
  const row = EVERY.find((r) => r.key === "lots")!;

  it("matches everything on an empty or blank query", () => {
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "   ")).toBe(true);
  });

  it("matches the name, whatever the case", () => {
    expect(matchesSearch(row, "LOT")).toBe(true);
  });

  it("matches a word only the sentence uses", () => {
    // Nothing here is CALLED "spreadsheet", and "spreadsheet" is what somebody
    // will type. A search over names alone answers "no hits" to the one word
    // the reader brought with them.
    expect(matchesSearch(row, "spreadsheet")).toBe(true);
    expect(row.name.toLowerCase()).not.toContain("spreadsheet");
  });

  it("says no when it means no", () => {
    expect(matchesSearch(row, "provenance")).toBe(false);
  });
});
