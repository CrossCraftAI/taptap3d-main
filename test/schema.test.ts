// Structural guards on the schema.
//
// These introspect the real drizzle tables rather than reading the file as text,
// so they cannot be fooled by a comment and cannot drift from what the migration
// will actually create. They need no database — see src/db/index.ts on why the
// pool is lazy.

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/db/schema";

/**
 * Tables that legitimately carry no `org_id`, with the reason each is exempt.
 * Anything not on this list must be org-scoped; adding a table without one
 * fails the test below rather than being discovered in year two.
 */
const NOT_ORG_SCOPED: Record<string, string> = {
  orgs: "it IS the tenant; a self-reference would be noise",
  users:
    "identity is global — one person may belong to several orgs, and membership is what scopes them",
};

function tables(): Array<{ name: string; columns: string[] }> {
  // Drizzle marks its table objects with a well-known symbol. Checking for it is
  // sturdier than a name convention, and it does not pick up the relation
  // helpers or the enum exported from the same module.
  //
  // Widened to unknown[] first rather than written as a type predicate: the
  // exports are a union of ten differently-typed tables plus relations plus a
  // pgEnum, and `v is PgTable` is not assignable to that union — tsc rejects the
  // predicate even though the runtime check is exactly right.
  return (Object.values(schema) as unknown[])
    .filter(
      (v) =>
        typeof v === "object" &&
        v !== null &&
        Symbol.for("drizzle:IsDrizzleTable") in v,
    )
    .map((t) => {
      const config = getTableConfig(t as PgTable);
      return {
        name: config.name,
        columns: config.columns.map((c) => c.name),
      };
    });
}

describe("tenancy is structural", () => {
  const all = tables();

  it("finds the tables at all — a zero-match walk proves nothing", () => {
    // Without this, every assertion below passes vacuously if the symbol check
    // ever stops matching drizzle's internals.
    expect(all.length).toBeGreaterThanOrEqual(9);
    expect(all.map((t) => t.name)).toContain("lots");
  });

  it.each(tables().map((t) => [t.name, t.columns] as const))(
    "%s carries org_id, or is a named exception",
    (name, columns) => {
      if (name in NOT_ORG_SCOPED) {
        expect(columns).not.toContain("org_id");
        return;
      }
      // ARCHITECTURE.md principle 7. Retrofitting tenancy means touching every
      // table, every query and every route; this is what stops that happening.
      expect(columns).toContain("org_id");
    },
  );

  it("every table has id, created_at and updated_at", () => {
    for (const t of all) {
      expect(t.columns, `${t.name} is missing a base column`).toEqual(
        expect.arrayContaining(["id", "created_at", "updated_at"]),
      );
    }
  });
});

describe("corrections are keyed by (lot, field), never positionally", () => {
  // ARCHITECTURE.md principle 1. Element ids and page indices are positional —
  // the same lot is p5-s1 at 4-up and p2-s3 at 9-up — so a correction keyed to
  // one is destroyed by a density change.
  const positional = [
    "element_id",
    "page_index",
    "page",
    "slot",
    "slot_index",
    "element",
  ];

  it.each(["overrides", "pin_members"])("%s keys on lot_id and field", (name) => {
    const t = tables().find((x) => x.name === name);
    expect(t, `${name} is missing from the schema`).toBeDefined();
    expect(t!.columns).toContain("lot_id");
    expect(t!.columns).toContain("field");
  });

  it.each(tables().map((t) => [t.name, t.columns] as const))(
    "%s carries no positional key",
    (_name, columns) => {
      expect(columns.filter((c) => positional.includes(c))).toEqual([]);
    },
  );
});

describe("the instrument exists before there is anything to measure", () => {
  // ROADMAP D9 depends on this table having been here from the start: a
  // measurement of how many actions a task took cannot be backfilled.
  it("action_log can order gestures within a sitting", () => {
    const t = tables().find((x) => x.name === "action_log");
    expect(t).toBeDefined();
    // seq as well as a timestamp, because ordering by time alone loses gestures
    // that land in the same millisecond — which is exactly what a drag produces.
    expect(t!.columns).toEqual(
      expect.arrayContaining(["session_id", "seq", "action", "occurred_at"]),
    );
  });
});
