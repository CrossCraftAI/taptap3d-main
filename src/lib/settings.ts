// The house's settings screen, as a function of what the house holds.
//
// ── WHY THIS IS A MODULE AND NOT THE PAGE ───────────────────────────────────
//
// The same reason src/lib/ledger.ts is: it is pure — a policy and a set of
// discovered keys in, a list of rows out — so the things that go wrong with it
// are a table of cases in test/settings.test.ts rather than something only a
// browser can find out. And the things that go wrong here are worth a table.
// The one below can publish a reserve.
//
// ── THE FIELD SET IS THE CUSTOMER'S, SO THE SCREEN HAS THREE SOURCES ────────
//
// `lots.fields` is open jsonb and a house's columns arrive at import, so there
// is no list of fields anywhere in this system to render. What there is:
//
//   CORE_FIELDS     the nine this system named, from a real corpus. Always
//                   drawn, even at nought lots, so a house can mark a field
//                   BEFORE the import that fills it.
//   discovered      what the org's own lots actually carry (`listFieldKeys`).
//                   This is where 保留價 comes from, and it is the reason the
//                   screen cannot be a fixed list.
//   the policy      keys the house has already spoken about. Drawn even when
//                   nothing carries them any more — a marked field that
//                   vanished from the records can otherwise be neither seen
//                   nor un-marked, which is the same trap the lot record
//                   avoids by still listing an override on a missing field.
//
// A FOURTH SOURCE IS THE PERSON, and it is not a convenience. A house that
// knows its next spreadsheet has a 保留價 column can mark it here before the
// import runs; without that, the only order of events available is "import the
// reserves, then hide them", and between those two moments every derivation
// prints them. `orgs.field_policy` is the one thing in this product whose
// failure is not recoverable at any price (src/lib/engine/visibility.ts), so
// the screen offers the direction that cannot fail that way.
//
// ── ABSENCE IS THE DEFAULT AND IT IS WRITTEN AS ABSENCE ─────────────────────
//
// `policyOf` below drops `public`. A field nobody has marked has no key in the
// map, which is what every org in every database has today, and what makes
// "the default is that nothing changes" true of the stored row and not only of
// the rendered page.

import {
  AUDIENCES,
  levelOf,
  type Audience,
  type FieldPolicy,
} from "@/lib/engine/visibility";
import { CORE_FIELDS } from "@/lib/import/fields";

/**
 * The longest key that can name a field.
 *
 * The same eighty as every other writer of a field key — the lot form's
 * `MAX_KEY` (src/app/events/[id]/lots/[lotId]/actions.ts), `fieldSchema.key`
 * (src/lib/engine/templates.ts) and `policyFor`'s own bound
 * (src/lib/engine/visibility.ts). Four copies of one number is three too many
 * and none of them can import the others; what makes it safe is that the
 * reader is the strictest of them, so a key this screen accepted and that one
 * dropped could only ever hold back LESS than was asked for. Stated here so
 * the next person moving it knows where the other three are.
 */
export const MAX_KEY = 80;

/**
 * Keys in this namespace are never offered.
 *
 * `_`-prefixed keys are carried data the caption never prints — the lot record
 * hides them from the record for that reason and the lot form refuses to
 * create one. A visibility level on a value that reaches no output at any
 * audience is a control with no effect, which is the one thing this screen
 * must not contain.
 */
const CARRIED = "_";

export interface PolicyRow {
  key: string;
  /** What to call it: a core field's own label, or the house's own header. */
  label: string;
  /** Under the label — the English name, or where the column came from. */
  hint: string;
  /** What the house has said, or `public` because it has said nothing. */
  level: Audience;
  /** How many of the org's lots carry this key. Nought is a real answer. */
  lots: number;
}

export interface PolicyView {
  /** The nine this system named, in their canonical order. */
  core: PolicyRow[];
  /** The house's own columns, most used first. */
  house: PolicyRow[];
  /** How many fields carry a level that is not `public`. */
  marked: number;
  /** Every row, in the order the screen draws them. */
  all: PolicyRow[];
}

/**
 * What the screen draws.
 *
 * ORDER IS NOT ALPHABETICAL and that is deliberate. The core fields come first
 * in the order the importer and the lot record already use them, so a person
 * moving between the three screens reads one list; the house's own columns
 * follow, most-used first, because "how many lots does this touch" is the
 * question somebody deciding whether to hide a column actually asks.
 *
 * A key is drawn ONCE. `discovered` and the policy both know about 保留價 the
 * moment anybody has marked it, and a screen with two rows for one field has
 * two controls whose last press wins.
 */
export function policyRows(
  policy: FieldPolicy,
  discovered: readonly { key: string; lots: number }[],
): PolicyView {
  const counted = new Map(discovered.map((d) => [d.key, d.lots]));

  const core: PolicyRow[] = CORE_FIELDS.map((field) => ({
    key: field.key,
    label: field.label.zh,
    hint: field.label.en,
    level: levelOf(policy, field.key),
    lots: counted.get(field.key) ?? 0,
  }));

  const seen = new Set(core.map((row) => row.key));
  const house: PolicyRow[] = [];

  for (const { key, lots } of discovered) {
    if (seen.has(key) || !usable(key)) continue;
    seen.add(key);
    house.push({
      key,
      label: key,
      hint: "the house's column",
      level: levelOf(policy, key),
      lots,
    });
  }

  // A field the house marked and no lot carries any more. It is last because
  // it is the rarest row on the screen, and it is HERE because a marked field
  // that cannot be found is a field that cannot be un-marked.
  for (const key of Object.keys(policy)) {
    if (seen.has(key) || !usable(key)) continue;
    seen.add(key);
    house.push({
      key,
      label: key,
      hint: "no lot carries this now",
      level: levelOf(policy, key),
      lots: 0,
    });
  }

  const all = [...core, ...house];
  return { core, house, marked: all.filter((r) => r.level !== "public").length, all };
}

function usable(key: string): boolean {
  return key.length > 0 && key.length <= MAX_KEY && !key.startsWith(CARRIED);
}

/** Whether a string is one of the three levels. */
export function isAudience(value: unknown): value is Audience {
  return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);
}

/**
 * The map to store, from what the form said.
 *
 * ── `public` IS DROPPED, WHICH IS THE WHOLE FUNCTION ────────────────────────
 *
 * The screen draws a control for every field it knows about, and almost all of
 * them will be at the default. Storing what they say would turn "the house has
 * said nothing", which is every org in every database today, into a map of
 * forty explicit `public`s — behaviourally identical right now, and a
 * different sentence to anything that ever counts the policy or asks whether
 * the house has one. So the stored map holds only what was actually decided.
 *
 * ── AND IT REFUSES RATHER THAN GUESSES ──────────────────────────────────────
 *
 * A level this function does not recognise is DROPPED, not stored, and the
 * asymmetry with `policyFor` is on purpose. `policyFor` reads a value that is
 * already in the column and cannot know whether a later version of the schema
 * wrote it, so an unparseable level there is read as `house` — the safe end.
 * Here the value has just come off a `<select>` this screen rendered, so
 * anything unrecognised is a hand-made request rather than a newer schema, and
 * the safe answer to a request nobody can read is not to act on it. Storing
 * `house` for it would let a crafted form hide a field the person never chose.
 *
 * Last write wins on a repeated key, which is what a `FormData` with two of
 * the same name means; a key this screen would not draw is dropped, so the
 * `_` namespace cannot be reached through the form either.
 */
export function policyOf(
  decisions: Iterable<readonly [string, string]>,
): Record<string, Audience> {
  const out: Record<string, Audience> = {};
  for (const [key, level] of decisions) {
    if (!usable(key)) continue;
    if (!isAudience(level) || level === "public") {
      delete out[key];
      continue;
    }
    out[key] = level;
  }
  return out;
}

/** What the settings form hears back. Its own shape, for its own screen. */
export interface PolicyFormState {
  ok: boolean;
  message: string | null;
  /** Changes every time, so a repeated message is announced again. */
  at: number;
}

export const IDLE_POLICY_FORM: PolicyFormState = { ok: true, message: null, at: 0 };
