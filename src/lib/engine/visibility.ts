// Field visibility: who an output is FOR, and which of a lot's values reach them.
//
// A house's record carries things the catalogue must not: the reserve, what the
// consignor is owed, what the lot cost to buy in. Today every one of them prints
// wherever a template names it, and the only defence is that nobody has typed
// them into a field the template names — which is not a defence, it is luck.
//
// ── THREE LEVELS, NAMED ─────────────────────────────────────────────────────
//
//   public    Anyone may read it. The printed catalogue, the listing, the wall
//             label, the tearsheet a client is handed.
//   internal  An output made for the house's own people and the people it is
//             doing this lot's business with — a valuation schedule, the
//             auctioneer's book, a condition list.
//   house     The house alone. Never leaves the building.
//
// NAMED, NOT NUMBERED, and that is not a style preference. A person reading
// `internal` in a jsonb column knows what it means; a person reading `2` has to
// find the table that says which way the ladder runs, and the first thing that
// happens to a numeric scale is that somebody inserts a level in the middle and
// every stored row means something else. The names are also what a screen can
// print without a lookup table of its own.
//
// WHERE A HOUSE DRAWS THE LINE between the last two is the house's own answer —
// one auction house's consignor schedule is another's internal paperwork — which
// is why the policy is per-org and why this file decides nothing about which
// field belongs where. ARCHITECTURE.md principle 4: correctness is universal,
// taste is per-tenant. What this file guarantees is that the three are ORDERED
// and that the order is enforced in one place.
//
// ── AN AUDIENCE IS A PROPERTY OF THE OUTPUT, NOT OF THE HOUSE ───────────────
//
// One sale has a public catalogue and an internal valuation schedule on the same
// day, from the same records. So the audience lives in `catalogues.params`
// beside the template and the density (src/lib/engine/derive.ts), and the policy
// — which field is at which level — lives on the org. Two catalogues of one sale
// differ only in the audience they were made for, and the same policy answers
// for both.
//
// Rejected: an `internal` boolean per field. Two states cannot express "the
// consignor may see it and the buyer may not", which is the case a valuation
// schedule exists for, and widening a boolean later means migrating every row
// that has one.
// Rejected: the audience on the ORG. It would make "the house is internal today"
// a setting somebody flips before printing, which is the same shape as the
// predecessor's global "draft mode" and has the same failure: the state that
// decides what leaves the building is not attached to the thing that leaves.
// Rejected: a level per (lot, field), like an override. A reserve is a reserve on
// every lot; keying the policy per lot would make a new lot's reserve public
// until somebody remembered, which is the one direction this must never fail in.

/**
 * The three levels, in order of reach: `public` goes everywhere, `house` goes
 * nowhere but the house. The array order IS the ladder, and `RANK` below is
 * derived from it so the two cannot disagree.
 */
export const AUDIENCES = ["public", "internal", "house"] as const;

export type Audience = (typeof AUDIENCES)[number];

const RANK: Record<Audience, number> = Object.fromEntries(
  AUDIENCES.map((a, i) => [a, i]),
) as Record<Audience, number>;

const isAudience = (value: unknown): value is Audience =>
  typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);

/**
 * The audience a stored value names, or `public`.
 *
 * TOTAL over anything `catalogues.params` can hold, the way `templateFor` and
 * `workflowFor` are (src/lib/engine/templates.ts, src/lib/workflow.ts). Every
 * catalogue row in every database predates this key, and `public` is what those
 * rows have always been: the default is that nothing changes.
 *
 * FALLS OPEN, and the asymmetry with `levelOf` below is deliberate. An
 * unreadable AUDIENCE means an output whose readership nobody stated, and the
 * safe reading of that is the narrowest one — which is `public`, because a
 * public output is the one that carries the least. An unreadable LEVEL means a
 * field somebody deliberately marked, and the safe reading of that is the
 * most restrictive. Both fail towards printing less.
 */
export function audienceFor(raw: unknown): Audience {
  return isAudience(raw) ? raw : "public";
}

/**
 * The house's answer for each field it has one for, keyed by field key.
 *
 * A PARTIAL MAP, and the partiality is the whole default. A key nobody has
 * mentioned is `public` — which is what every field in every existing database
 * already is — so an org with no policy prints exactly what it printed
 * yesterday, with no migration and no backfill.
 */
export type FieldPolicy = Readonly<Record<string, Audience>>;

/** An org that has said nothing. The default, and the state of every org today. */
export const EMPTY_POLICY: FieldPolicy = Object.freeze(Object.create(null) as Record<string, Audience>);

/**
 * The longest key that can name a field.
 *
 * The same eighty every other writer of a field key is bounded by — the lot
 * form's `MAX_KEY` (src/app/events/[id]/lots/[lotId]/actions.ts) and
 * `fieldSchema.key` (src/lib/engine/templates.ts). A key longer than that could
 * never have been written by anything in this system, so it cannot name a field
 * any lot holds, and carrying it would only make the policy a place to store
 * arbitrary text.
 */
const MAX_KEY = 80;

/**
 * Make sense of whatever `orgs.field_policy` holds.
 *
 * TOTAL, and in the shape of `templateFor` and `workflowFor` for the same
 * reason: the column is nullable jsonb and every row that exists was written
 * before it did. A row written before the column existed needs no migration
 * because `null` reads as "the house has said nothing", which is the default.
 *
 * ── A LEVEL THIS READER CANNOT PARSE IS `house`, NOT `public` ───────────────
 *
 * Absence and nonsense are NOT the same answer here, and the difference is the
 * only thing in this file that can cost a customer money.
 *
 * ABSENCE is the default: nobody has said, so it prints as it always has.
 * PRESENCE is an assertion the house made about that field, and an assertion
 * this reader cannot parse is not permission. `{"reserve": "hosue"}` — one
 * transposed pair of letters — must not publish the reserve. Neither must
 * `{"reserve": "consignor"}`, which is what a row written by a LATER version of
 * this file looks like to this one: if a fourth level is ever added between
 * `internal` and `house`, every deployment still running today's code reads it
 * as the most restrictive thing it knows rather than as nothing at all.
 *
 * The cost of the other choice is asymmetric and that is what settles it. Fail
 * closed and a field mysteriously does not print — visible on the lot record,
 * which lists what is held back and why, and fixed by correcting one word. Fail
 * open and the reserve is in the printed catalogue, which is not recoverable at
 * any price.
 *
 * `null` is the exception and reads as absence, because `null` is how a jsonb
 * write CLEARS a key (src/lib/data/overrides.ts says the same of an override's
 * keys). A cleared key is not a corrupt one.
 *
 * ── THE MAP IS BUILT ON A NULL PROTOTYPE ────────────────────────────────────
 *
 * `JSON.parse('{"__proto__": "house"}')` makes `__proto__` an OWN property, so
 * it survives into the column and out of it, and `out[key] = level` on a plain
 * object would then reach `Object.prototype`'s setter instead of storing a
 * field's level. overrides.ts refuses the same class of key by listing the keys
 * a patch may touch; a policy's keys are the HOUSE's own field names and cannot
 * be listed, so the container is the defence instead.
 */
export function policyFor(raw: unknown): FieldPolicy {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return EMPTY_POLICY;
  const out = Object.create(null) as Record<string, Audience>;
  let any = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.length > MAX_KEY) continue;
    // A cleared key is silence. Anything else is a statement, and a statement
    // this reader cannot parse is the most restrictive one it knows.
    if (value === null || value === undefined) continue;
    out[key] = isAudience(value) ? value : "house";
    any = true;
  }
  return any ? Object.freeze(out) : EMPTY_POLICY;
}

/** What the house said about this field, or `public` because it said nothing. */
export function levelOf(policy: FieldPolicy, key: string): Audience {
  return Object.prototype.hasOwnProperty.call(policy, key) ? policy[key]! : "public";
}

/** Whether a field at `level` may appear in an output made for `audience`. */
export function reaches(level: Audience, audience: Audience): boolean {
  return RANK[level] <= RANK[audience];
}

/**
 * The field keys an output for this audience may NOT carry.
 *
 * A SET FOR THE WHOLE DOCUMENT, computed once, because the policy and the
 * audience are both properties of the output and neither varies by lot. It is
 * empty for an org with no policy and empty at `house`, and `derive` short-
 * circuits on that — which is what makes "the default is that nothing changes"
 * true of the code path and not only of the result.
 *
 * Small by construction: it holds only the keys the house has actually spoken
 * about, never the union of every field every lot carries.
 */
export function withheldAt(policy: FieldPolicy, audience: Audience): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [key, level] of Object.entries(policy)) {
    if (!reaches(level, audience)) out.add(key);
  }
  return out;
}

/** What one audience gets of a given set of field keys, and what it does not. */
export interface AudienceReading {
  audience: Audience;
  /** The keys an output for this audience carries, in the order given. */
  carried: string[];
  /** The keys held back from it, in the order given, each with its level. */
  withheld: { key: string; level: Audience }[];
}

/**
 * Where a lot's values go: one reading per audience, over the keys it holds.
 *
 * PURE, and it exists so the lot record's "Where this prints" box cannot have
 * an opinion of its own. The screen counts nothing and decides nothing — it
 * prints these readings, and they come from `levelOf` and `reaches`, which is
 * what the engine drops fields with. A second count on the screen is how a page
 * ends up reporting that six fields print while seven do.
 *
 * `keys` is the caller's: the lot's own fields, in the order that screen shows
 * them. Nothing here knows which keys a template names, because the question
 * "where does this value go" is answered before any output is chosen.
 */
export function readAudiences(policy: FieldPolicy, keys: readonly string[]): AudienceReading[] {
  return AUDIENCES.map((audience) => {
    const carried: string[] = [];
    const withheld: { key: string; level: Audience }[] = [];
    for (const key of keys) {
      const level = levelOf(policy, key);
      if (reaches(level, audience)) carried.push(key);
      else withheld.push({ key, level });
    }
    return { audience, carried, withheld };
  });
}
