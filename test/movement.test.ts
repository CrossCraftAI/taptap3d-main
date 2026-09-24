// Movement: the derivations, held in node.
//
// Everything this file tests is a question about an array or a date, which is
// why none of it needs a database — and why it is worth holding here rather
// than only by driving a browser. The one claim the whole feature rests on is
// "where it is, is the last movement's destination"; that is three lines of
// code and it is read by the lot's screen, by the sale's register and by the
// crate gesture, so all three break together if it is wrong.
//
// The WRITERS are in test/custody.db.test.ts, against a real Postgres.

import { describe, expect, it } from "vitest";

import {
  formatDay,
  formatMoment,
  provenanceLine,
  provenanceOf,
  provenanceText,
  whereItIs,
  type MovementLeg,
} from "@/lib/data/movements";

const at = (iso: string): Date => new Date(iso);

function leg(input: Partial<MovementLeg> & { toPlace: string; occurredAt: Date }): MovementLeg {
  return {
    id: `${input.toPlace}-${input.occurredAt.getTime()}`,
    fromPlace: null,
    custodian: null,
    reason: null,
    note: null,
    isPublic: false,
    movedWith: 1,
    reports: 0,
    ...input,
  };
}

/**
 * The chain as the reader gets it: NEWEST FIRST, which is the order it is
 * painted in and the order `listMovements` returns.
 */
const CHAIN: MovementLeg[] = [
  leg({
    occurredAt: at("2026-09-19T01:40:00Z"),
    fromPlace: "Warehouse, Kwai Chung",
    toPlace: "Saleroom, Wong Chuk Hang",
    custodian: "L. Cheung",
    reason: "Pre-sale viewing",
    movedWith: 40,
  }),
  leg({
    occurredAt: at("2026-09-02T08:05:00Z"),
    fromPlace: "Photography studio",
    toPlace: "Warehouse, Kwai Chung",
    custodian: "K. Ng",
    reason: "Return after photography",
  }),
  leg({
    occurredAt: at("2026-08-28T06:20:00Z"),
    fromPlace: "Lin family collection, Taipei",
    toPlace: "Photography studio",
    custodian: "L. Cheung",
    reason: "On receipt from consignor",
    isPublic: true,
  }),
  leg({
    occurredAt: at("1998-04-01T00:00:00Z"),
    // An arrival: it came from somewhere this system never held.
    fromPlace: null,
    toPlace: "Lin family collection, Taipei",
    reason: "Acquired from a Hong Kong dealer",
    isPublic: true,
  }),
];

describe("where it is, is the last movement's destination", () => {
  it("reads the head of the chain, because the chain is newest first", () => {
    expect(whereItIs(CHAIN)).toEqual({
      place: "Saleroom, Wong Chuk Hang",
      custodian: "L. Cheung",
      since: at("2026-09-19T01:40:00Z"),
    });
  });

  it("is null for a lot nobody has ever moved", () => {
    // NOT "at the house" and not "lost". Every lot imported before the table
    // existed is in this state, and the screen paints it as "nowhere
    // recorded" rather than inventing a first leg.
    expect(whereItIs([])).toBeNull();
  });

  it("a correction is the newest leg and simply wins", () => {
    // The whole shape of the feature: correcting where something is APPENDS.
    // The wrong leg is still in the chain and the reading has moved on.
    const corrected = [
      leg({
        occurredAt: at("2026-09-19T03:00:00Z"),
        fromPlace: "Saleroom, Wong Chuk Hang",
        toPlace: "Warehouse, Kwai Chung",
        reason: "Correction",
      }),
      ...CHAIN,
    ];
    expect(whereItIs(corrected)?.place).toBe("Warehouse, Kwai Chung");
    // And nothing was erased: the leg that was wrong is still the one before
    // it, and the oldest leg is still the oldest.
    expect(corrected).toHaveLength(CHAIN.length + 1);
    expect(corrected[1]).toBe(CHAIN[0]);
    expect(corrected.at(-1)).toBe(CHAIN.at(-1));
  });
});

describe("the public half of the chain is what a catalogue prints", () => {
  it("names the place a leg LEFT, oldest first", () => {
    // Provenance is a list of who HELD a thing, so a public leg prints its
    // ORIGIN. The chain is newest first and a catalogue reads forwards.
    expect(provenanceOf(CHAIN).map((entry) => entry.place)).toEqual([
      "Lin family collection, Taipei",
    ]);
  });

  it("skips a public arrival, because it has no holder to name", () => {
    // The 1998 leg is public and came from outside the house. "Acquired from
    // —" in a printed catalogue is worse than a shorter provenance.
    const arrivals = CHAIN.filter((entry) => entry.fromPlace === null);
    expect(arrivals).toHaveLength(1);
    expect(arrivals[0]!.isPublic).toBe(true);
    expect(provenanceOf(CHAIN)).toHaveLength(1);
  });

  it("prints a year and not a day", () => {
    // A day and a month is warehouse detail, and printing it would put the
    // house's internal movements in front of a bidder.
    expect(provenanceLine(provenanceOf(CHAIN)[0]!)).toBe(
      "Lin family collection, Taipei, until 2026",
    );
  });

  it("is nothing at all when nobody has marked a leg public", () => {
    const internal = CHAIN.map((entry) => ({ ...entry, isPublic: false }));
    expect(provenanceOf(internal)).toEqual([]);
    expect(provenanceText(internal)).toBe("");
  });

  it("is one line per public leg, in printing order", () => {
    const both = CHAIN.map((entry) =>
      entry.toPlace === "Warehouse, Kwai Chung" ? { ...entry, isPublic: true } : entry,
    );
    expect(provenanceText(both).split("\n")).toEqual([
      "Lin family collection, Taipei, until 2026",
      "Photography studio, until 2026",
    ]);
  });
});

describe("a custody date is read where the thing physically is", () => {
  // ASIA/HONG_KONG, pinned. A server in another zone must not report a crate
  // leaving on the wrong day, and this instant is chosen to prove the zone is
  // applied: 17:00 UTC on the 18th is 01:00 on the 19th in Hong Kong.
  const crossesMidnight = at("2026-09-18T17:00:00Z");

  // "Sept", not "Sep", and that is the platform's answer rather than a choice:
  // ICU's en-GB abbreviation for September is four letters, and
  // src/components/ledger.tsx has printed it that way since it shipped. Pinned
  // here so the two screens are known to agree, and so a locale-data change
  // fails a test instead of quietly making one screen read differently.
  it("says the 19th, not the 18th", () => {
    expect(formatDay(crossesMidnight)).toBe("19 Sept 2026");
  });

  it("carries the clock where a custody record is argued to the hour", () => {
    expect(formatMoment(crossesMidnight)).toBe("19 Sept 2026, 01:00");
  });

  it("uses a 24-hour clock, so 13:40 is never 1:40", () => {
    expect(formatMoment(at("2026-09-19T05:40:00Z"))).toBe("19 Sept 2026, 13:40");
  });
});

describe("a gesture is derived from the values, not from a batch id", () => {
  it("a leg that moved forty lots says so, and one that moved one does not", () => {
    // `movedWith` is counted by the query from the movements sharing an
    // instant, an origin and a destination — there is no batch column, and
    // this is the shape the chain renders from.
    const crate = CHAIN[0]!;
    expect(crate.movedWith).toBe(40);
    expect(crate.movedWith - 1).toBe(39);
    expect(CHAIN[1]!.movedWith).toBe(1);
  });
});
