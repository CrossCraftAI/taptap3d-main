// What pressing Apply on the editor does to the answers Apply does not carry.
//
// ── THE DEFECT THIS FILE WAS WRITTEN FOR ────────────────────────────────────
//
// `catalogues.params` is ONE jsonb object holding every answer about how a
// catalogue prints, and `updateCatalogueParams` does `set({ params })` — it
// replaces the column, it does not merge into it. The editor's settings form
// posts five of those answers, so `setCatalogueParamsAction` rebuilt the
// object from five and `normaliseParams` filled the rest with its defaults.
//
// `audience` is not one of the five. It is the answer to WHO MAY READ THIS
// OUTPUT, and its default is `public` — so a house that set a catalogue to
// `house`, and then changed the density, silently published it. Every field
// the house had marked `internal` or `house` started printing again, which is
// the exact outcome the whole of Phase 3 exists to make impossible, reached by
// pressing a button that says Apply next to a number.
//
// The editor's own note predicted this in so many words — "a panel posting
// only `template` would silently reset the fit and the reference" — and the
// one answer it did not list is the one that matters most.
//
// `face` would have been the second, which is how it was found.
//
// Needs a database and says so by failing — see test/schema.db.test.ts on why
// there is no skip path anywhere in this suite.

import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, getPool, orgs } from "@/db";
import {
  ensureCatalogue,
  getCatalogue,
  updateCatalogueParams,
} from "@/lib/data/catalogues";
import { createEvent } from "@/lib/data/events";
import { normaliseParams } from "@/lib/engine/derive";

const db = getDb();
let orgId: string;

beforeAll(async () => {
  const [row] = await db
    .insert(orgs)
    .values({ name: "params", slug: `params-${randomUUID().slice(0, 8)}` })
    .returning({ id: orgs.id });
  orgId = row!.id;
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgId));
  await getPool().end();
});

/**
 * What the editor's settings form posts — the five fields it actually carries.
 * Deliberately NOT every key: that is the whole subject of this file.
 */
const FORM_FIELDS = {
  template: "catalogue",
  perPage: 9,
  imagePlacement: "above",
  showRef: true,
  fit: "width",
};

describe("changing one setting leaves the settings that form does not carry", () => {
  it("keeps the audience, which is the one that must never widen by accident", async () => {
    const event = await createEvent(orgId, { name: "Audience Sale" });
    const catalogue = await ensureCatalogue(orgId, event.id);

    // The house makes this catalogue internal.
    await updateCatalogueParams(orgId, catalogue.id, {
      ...normaliseParams({ audience: "house" }),
    });
    expect(normaliseParams((await getCatalogue(orgId, event.id))!.params).audience).toBe(
      "house",
    );

    // And then somebody changes the density, the way they do forty times a day.
    const stored = (await getCatalogue(orgId, event.id))!.params;
    await updateCatalogueParams(orgId, catalogue.id, {
      ...normaliseParams({ ...(stored as object), ...FORM_FIELDS }),
    });

    const after = normaliseParams((await getCatalogue(orgId, event.id))!.params);
    // THE ASSERTION THE DEFECT FAILED. Rebuilding the object from the form
    // alone answered `public` here, and every withheld field started printing.
    expect(after.audience).toBe("house");
    // And the thing they actually changed did change.
    expect(after.perPage).toBe(9);
    expect(after.fit).toBe("width");
  });

  it("keeps the typeface, which is not on that form either", async () => {
    const event = await createEvent(orgId, { name: "Face Sale" });
    const catalogue = await ensureCatalogue(orgId, event.id);

    await updateCatalogueParams(orgId, catalogue.id, {
      ...normaliseParams({ face: "sans" }),
    });
    const stored = (await getCatalogue(orgId, event.id))!.params;
    await updateCatalogueParams(orgId, catalogue.id, {
      ...normaliseParams({ ...(stored as object), ...FORM_FIELDS }),
    });

    expect(normaliseParams((await getCatalogue(orgId, event.id))!.params).face).toBe("sans");
  });

  it("and a catalogue nobody has set anything on still reads as the defaults", async () => {
    // The merge must not turn "never answered" into something else: a row
    // whose params are `{}` is every catalogue written before any of these
    // keys existed, and it has to keep printing what it printed.
    const event = await createEvent(orgId, { name: "Untouched Sale" });
    await ensureCatalogue(orgId, event.id);
    const params = normaliseParams((await getCatalogue(orgId, event.id))!.params);
    expect(params.audience).toBe("public");
    expect(params.face).toBe("serif");
  });
});
