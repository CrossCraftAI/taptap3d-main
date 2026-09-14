// The correction loop's writers, against a real Postgres.
//
// Until this landed, the only thing that had ever written to `overrides`,
// `pins` or `pin_members` was the migration, and nothing had ever written to
// `action_log` at all. So the claim that a year of human judgement survives a
// repagination was a design. These prove the data layer holds its end of it:
// that a decision is written as a decision and a proposal stays a proposal,
// that a pin is its members and refuses to be one the engine would ignore, that
// the record and the catalogue are two different reaches, and that the
// instrument records what it is told without failing on a retry.
//
// Needs a database and says so by failing — see test/schema.db.test.ts.

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  catalogues,
  getDb,
  getPool,
  lots as lotsTable,
  memberships,
  orgs,
  overrides,
  users,
} from "@/db";
import { listActions, recordActions } from "@/lib/data/actions";
import { currentActorId, gateEmail, isGateIdentity } from "@/lib/data/actor";
import {
  createPin,
  deletePin,
  ensureCatalogue,
  getCatalogue,
  listPins,
} from "@/lib/data/catalogues";
import { createEvent } from "@/lib/data/events";
import { insertLots, listLots, updateLotFields } from "@/lib/data/lots";
import {
  clearOverride,
  listOverrides,
  listOverridesForLot,
  overrideFromValue,
  setOverride,
} from "@/lib/data/overrides";
import { derive, DEFAULT_PARAMS } from "@/lib/engine/derive";

const db = getDb();
let orgA: string;
let orgB: string;
let slugA: string;
let slugB: string;
let eventA: string;
let catalogueA: string;
let lotIds: string[];
let actorA: string;

async function makeOrg(label: string): Promise<{ id: string; slug: string }> {
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const [row] = await db
    .insert(orgs)
    .values({ name: label, slug })
    .returning({ id: orgs.id });
  return { id: row!.id, slug };
}

beforeAll(async () => {
  const a = await makeOrg("corrections-a");
  const b = await makeOrg("corrections-b");
  orgA = a.id;
  slugA = a.slug;
  orgB = b.id;
  slugB = b.slug;

  const event = await createEvent(orgA, { name: "Correction Sale" });
  eventA = event.id;
  await insertLots(orgA, eventA, [
    { ref: "C01", fields: { ref: "C01", title: "青花梅瓶", maker: "佚名" }, sourceRow: 1 },
    { ref: "C02", fields: { ref: "C02", title: "山水四屏", maker: "張大千" }, sourceRow: 2 },
    { ref: "C03", fields: { ref: "C03", title: "白玉佩" }, sourceRow: 3 },
    { ref: "C04", fields: { ref: "C04", title: "墨荷", maker: "齊白石" }, sourceRow: 4 },
    { ref: "C05", fields: { ref: "C05", title: "秋山圖" }, sourceRow: 5 },
    { ref: "C06", fields: { ref: "C06", title: "紫砂壺" }, sourceRow: 6 },
  ]);
  lotIds = (await listLots(orgA, eventA)).map((l) => l.id);
  catalogueA = (await ensureCatalogue(orgA, eventA, "Correction Catalogue")).id;
  actorA = await currentActorId(orgA);
});

afterAll(async () => {
  await db.delete(orgs).where(eq(orgs.id, orgA));
  await db.delete(orgs).where(eq(orgs.id, orgB));
  // Users are global and do not cascade from an org; the gate identities this
  // run made are removed by hand so a thousand runs do not leave a thousand.
  await db.delete(users).where(eq(users.email, gateEmail(slugA)));
  await db.delete(users).where(eq(users.email, gateEmail(slugB)));
  await getPool().end();
});

// ── Who decided ─────────────────────────────────────────────────────────────

describe("the gate identity", () => {
  it("is one row per org, made once and found afterwards", async () => {
    const again = await currentActorId(orgA);
    expect(again).toBe(actorA);
    const rows = await db.select().from(users).where(eq(users.email, gateEmail(slugA)));
    expect(rows).toHaveLength(1);
    expect(isGateIdentity(rows[0]!.email)).toBe(true);
    // A real person's address must not read as the gate.
    expect(isGateIdentity("specialist@house.example")).toBe(false);
  });

  it("is a member of its org and of no other", async () => {
    const actorB = await currentActorId(orgB);
    expect(actorB).not.toBe(actorA);
    const mine = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, actorA), eq(memberships.orgId, orgA)));
    expect(mine).toHaveLength(1);
    const theirs = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.userId, actorA), eq(memberships.orgId, orgB)));
    expect(theirs).toHaveLength(0);
  });
});

// ── The record ──────────────────────────────────────────────────────────────

describe("updateLotFields — the edit that reaches every catalogue", () => {
  it("merges a patch and removes blank keys", async () => {
    const id = lotIds[2]!; // C03, no maker
    const row = await updateLotFields(orgA, id, {
      maker: "佚名",
      title: "  白玉雕螭龍紋佩  ",
      description: "",
    });
    expect(row?.fields).toEqual({ ref: "C03", title: "白玉雕螭龍紋佩", maker: "佚名" });
    expect(row?.fields).not.toHaveProperty("description");
  });

  it("removes a key that was there", async () => {
    const id = lotIds[3]!; // C04, maker 齊白石
    const row = await updateLotFields(orgA, id, { maker: null });
    expect(row?.fields).not.toHaveProperty("maker");
    expect(row?.fields.title).toBe("墨荷");
  });

  it("keeps the reference column and the reference field in step", async () => {
    // `lots.ref` is what the ledger and the pins read; `fields.ref` is what the
    // importer wrote. One without the other and the lot disagrees with itself.
    const id = lotIds[5]!;
    const row = await updateLotFields(orgA, id, { ref: "C06a" });
    expect(row?.ref).toBe("C06a");
    expect(row?.fields.ref).toBe("C06a");
    const back = await updateLotFields(orgA, id, { ref: "C06" });
    expect(back?.ref).toBe("C06");
  });

  it("adds a column of the house's own", async () => {
    const row = await updateLotFields(orgA, lotIds[4]!, { 品相: "A-" });
    expect(row?.fields["品相"]).toBe("A-");
  });

  it("refuses another org's lot by returning nothing", async () => {
    expect(await updateLotFields(orgB, lotIds[0]!, { title: "stolen" })).toBeNull();
    const [untouched] = await db
      .select({ fields: lotsTable.fields })
      .from(lotsTable)
      .where(eq(lotsTable.id, lotIds[0]!));
    expect(untouched!.fields.title).toBe("青花梅瓶");
  });

  it("bumps updated_at, which is what remounts the form and reloads the preview", async () => {
    const [before] = await db
      .select({ updatedAt: lotsTable.updatedAt })
      .from(lotsTable)
      .where(eq(lotsTable.id, lotIds[0]!));
    await new Promise((r) => setTimeout(r, 5));
    const row = await updateLotFields(orgA, lotIds[0]!, { date: "清乾隆" });
    expect(row!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });
});

// ── This catalogue ──────────────────────────────────────────────────────────

describe("overrides — per-catalogue judgement", () => {
  it("writes a decision with a decider, and the engine sees it", async () => {
    const id = lotIds[1]!; // C02
    expect(await setOverride(orgA, catalogueA, id, "maker", { hidden: true }, actorA)).toBe(true);
    expect(
      await setOverride(orgA, catalogueA, id, "price", { text: "估價待詢" }, actorA),
    ).toBe(true);

    const listed = await listOverridesForLot(orgA, catalogueA, id);
    expect(listed.map((o) => [o.field, o.hidden ?? false, o.text ?? null])).toEqual([
      ["maker", true, null],
      ["price", false, "估價待詢"],
    ]);

    const [stored] = await db
      .select({ decidedBy: overrides.decidedBy })
      .from(overrides)
      .where(and(eq(overrides.lotId, id), eq(overrides.field, "maker")));
    expect(stored!.decidedBy).toBe(actorA);
  });

  it("upserts rather than duplicating — one value per (catalogue, lot, field)", async () => {
    const id = lotIds[1]!;
    await setOverride(orgA, catalogueA, id, "price", { text: "價格另議" }, actorA);
    const rows = await db
      .select()
      .from(overrides)
      .where(and(eq(overrides.lotId, id), eq(overrides.field, "price")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).toEqual({ text: "價格另議" });
  });

  it("leaves a proposal — decided_by null — out of what the engine applies", async () => {
    // The corollary of principle 9. A machine's suggestion sits in the same
    // table with no decider; it must be visible to a person and invisible to
    // the renderer until somebody says yes.
    const id = lotIds[0]!;
    await db.insert(overrides).values({
      orgId: orgA,
      catalogueId: catalogueA,
      lotId: id,
      field: "title",
      value: { hidden: true },
      decidedBy: null,
    });
    const applied = await listOverrides(orgA, catalogueA);
    expect(applied.some((o) => o.lotId === id && o.field === "title")).toBe(false);

    // A human deciding the same (lot, field) replaces the proposal with a decision.
    await setOverride(orgA, catalogueA, id, "title", { text: "青花纏枝蓮紋梅瓶" }, actorA);
    const now = await listOverridesForLot(orgA, catalogueA, id);
    expect(now.find((o) => o.field === "title")?.text).toBe("青花纏枝蓮紋梅瓶");
    await clearOverride(orgA, catalogueA, id, "title");
  });

  it("reads only the shapes it understands, and skips the rest without failing", () => {
    expect(overrideFromValue({ hidden: true })).toEqual({ hidden: true });
    expect(overrideFromValue({ text: "x" })).toEqual({ text: "x" });
    expect(overrideFromValue({ hidden: true, text: "x" })).toEqual({ hidden: true, text: "x" });
    // The migration's proposal shape, and the editor's future frames.
    expect(overrideFromValue({ proposal: true, kind: "straighten", state: "rejected" })).toBeNull();
    expect(overrideFromValue({ straightenDeg: -1.37 })).toBeNull();
    expect(overrideFromValue({ hidden: false, text: "   " })).toBeNull();
    expect(overrideFromValue(null)).toBeNull();
    expect(overrideFromValue("nonsense")).toBeNull();
  });

  it("clears, and the record's own value prints again", async () => {
    const id = lotIds[1]!;
    expect(await clearOverride(orgA, catalogueA, id, "maker")).toBe(true);
    expect(await clearOverride(orgA, catalogueA, id, "maker")).toBe(false);
    const doc = derive(
      (await listLots(orgA, eventA)).map((l) => ({ ...l, images: [] })),
      DEFAULT_PARAMS,
      [],
      await listOverrides(orgA, catalogueA),
    );
    const slot = doc.pages.flatMap((p) => p.slots).find((s) => s.lotId === id)!;
    expect(slot.caption.find((l) => l.key === "maker")?.value).toBe("張大千");
    // The one still standing is applied.
    expect(slot.caption.find((l) => l.key === "price")?.value).toBe("價格另議");
  });

  it("treats an empty value as a clear, never as an override of nothing", async () => {
    // The price override from above is still standing. Saying nothing about
    // the price removes it — no row with `{}` in it is ever written.
    const id = lotIds[1]!;
    expect((await listOverridesForLot(orgA, catalogueA, id)).map((o) => o.field)).toEqual(["price"]);
    expect(
      await setOverride(orgA, catalogueA, id, "price", { hidden: false, text: "" }, actorA),
    ).toBe(true);
    expect(await listOverridesForLot(orgA, catalogueA, id)).toHaveLength(0);
    // And nothing to clear is reported as nothing done.
    expect(
      await setOverride(orgA, catalogueA, id, "price", { hidden: false, text: "" }, actorA),
    ).toBe(false);
    const rows = await db.select().from(overrides).where(eq(overrides.lotId, id));
    expect(rows).toHaveLength(0);
  });

  it("refuses a lot from another sale, and another org's catalogue", async () => {
    const other = await createEvent(orgA, { name: "Other Sale" });
    await insertLots(orgA, other.id, [{ ref: "X1", fields: {}, sourceRow: 1 }]);
    const stranger = (await listLots(orgA, other.id))[0]!.id;
    expect(
      await setOverride(orgA, catalogueA, stranger, "title", { hidden: true }, actorA),
    ).toBe(false);
    expect(
      await setOverride(orgB, catalogueA, lotIds[0]!, "title", { hidden: true }, actorA),
    ).toBe(false);
    expect(await listOverrides(orgB, catalogueA)).toHaveLength(0);
  });

  it("touches the catalogue, so the preview's key moves", async () => {
    const before = (await getCatalogue(orgA, eventA))!.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await setOverride(orgA, catalogueA, lotIds[2]!, "maker", { hidden: true }, actorA);
    const after = (await getCatalogue(orgA, eventA))!.updatedAt.getTime();
    expect(after).toBeGreaterThan(before);
    await clearOverride(orgA, catalogueA, lotIds[2]!, "maker");
  });
});

// ── Pins ────────────────────────────────────────────────────────────────────

describe("pins — an arrangement that must survive re-derivation", () => {
  it("is keyed by its members and comes back to the engine as lot ids", async () => {
    const result = await createPin(orgA, catalogueA, [lotIds[4]!, lotIds[3]!]);
    expect(result.ok).toBe(true);
    const pins = await listPins(orgA, catalogueA);
    expect(pins).toHaveLength(1);
    // In the sale's order, whichever order the person ticked them in.
    expect(pins[0]!.lotIds).toEqual([lotIds[3], lotIds[4]]);
    expect(pins[0]!.keepsTogether).toBe(true);

    // And the engine honours it at a density where they would have split.
    const doc = derive(
      (await listLots(orgA, eventA)).map((l) => ({ ...l, images: [] })),
      { ...DEFAULT_PARAMS, perPage: 4 },
      pins,
    );
    const pageOf = (id: string): number =>
      doc.pages.find((p) => p.slots.some((s) => s.lotId === id))!.number;
    expect(pageOf(lotIds[3]!)).toBe(pageOf(lotIds[4]!));
    expect(doc.pages[0]!.slots).toHaveLength(3);
  });

  it("refuses a lot that is already pinned, by name", async () => {
    const result = await createPin(orgA, catalogueA, [lotIds[4]!, lotIds[5]!]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/C05.*already pinned/);
  });

  it("refuses members that are not neighbours, and says why", async () => {
    // The engine keeps together runs of CONSECUTIVE lots. A pin of C01 and C03
    // would be accepted by the table and do nothing on the page.
    const result = await createPin(orgA, catalogueA, [lotIds[0]!, lotIds[2]!]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/neighbours/);
  });

  it("refuses fewer than two lots", async () => {
    const result = await createPin(orgA, catalogueA, [lotIds[0]!, lotIds[0]!]);
    expect(result.ok).toBe(false);
  });

  it("refuses another org's catalogue and a lot from another sale", async () => {
    expect((await createPin(orgB, catalogueA, [lotIds[0]!, lotIds[1]!])).ok).toBe(false);
    const other = await createEvent(orgA, { name: "Pin Other Sale" });
    await insertLots(orgA, other.id, [{ ref: "Y1", fields: {}, sourceRow: 1 }]);
    const stranger = (await listLots(orgA, other.id))[0]!.id;
    const result = await createPin(orgA, catalogueA, [lotIds[0]!, stranger]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not in this sale/);
  });

  it("unpins, and the members re-derive like any other lot", async () => {
    const [pin] = await listPins(orgA, catalogueA);
    expect(await deletePin(orgB, pin!.id)).toBe(false); // not theirs
    expect(await deletePin(orgA, pin!.id)).toBe(true);
    expect(await listPins(orgA, catalogueA)).toHaveLength(0);
    expect(await deletePin(orgA, pin!.id)).toBe(false); // already gone
  });
});

// ── The instrument ──────────────────────────────────────────────────────────

describe("recordActions — the action log's writer", () => {
  it("records a batch against the catalogue and orders it by sequence", async () => {
    const session = randomUUID();
    const n = await recordActions(orgA, session, actorA, [
      { seq: 2, action: "catalogue.pin", payload: { lots: 6 }, catalogueId: catalogueA },
      { seq: 1, action: "lot.fields.save", payload: { lotId: lotIds[0] }, catalogueId: catalogueA },
    ]);
    expect(n).toBe(2);
    const logged = await listActions(orgA, catalogueA);
    const mine = logged.filter((a) => a.sessionId === session);
    expect(mine.map((a) => a.action)).toEqual(["lot.fields.save", "catalogue.pin"]);
    expect(mine[0]!.userId).toBe(actorA);
  });

  it("does nothing on a retried (session, seq) rather than failing or double counting", async () => {
    const session = randomUUID();
    await recordActions(orgA, session, actorA, [{ seq: 1, action: "x", catalogueId: catalogueA }]);
    const again = await recordActions(orgA, session, actorA, [
      { seq: 1, action: "x", catalogueId: catalogueA },
    ]);
    expect(again).toBe(0);
  });

  it("does not attach a gesture to a catalogue the org does not own", async () => {
    const [theirs] = await db
      .insert(catalogues)
      .values({ orgId: orgB, eventId: (await createEvent(orgB, { name: "B" })).id, name: "B" })
      .returning({ id: catalogues.id });
    const session = randomUUID();
    const n = await recordActions(orgA, session, actorA, [
      { seq: 1, action: "catalogue.params", catalogueId: theirs!.id },
    ]);
    // Counted — the gesture happened — but as an org-level row with the claim
    // kept in the payload, not as a foreign key into another tenant.
    expect(n).toBe(1);
    expect(await listActions(orgB, theirs!.id)).toHaveLength(0);
  });
});
