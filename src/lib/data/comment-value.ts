// What a remark IS — its shape and its one limit. No database, and that is the
// point.
//
// ── WHY THIS IS NOT IN ./comments.ts, WHERE IT WAS WRITTEN ─────────────────
//
// The comment panel is a client component. It draws threads, so it needs the
// types; it has a textarea, so it needs the limit. ./comments.ts opens a
// connection at module scope's reach — `getDb`, drizzle, the schema — and
// importing it from a client component drags a Postgres driver into the
// browser bundle.
//
// That is not a hypothetical: it is exactly what happened on the first build
// of this feature, and the error named pg/lib/utils.js → src/db/index.ts →
// comments.ts → comment-panel.tsx. src/lib/data/override-value.ts exists for
// the identical reason one feature earlier, and its header is the longer
// version of this one.
//
// NOTHING HERE IS DUPLICATED. ./comments.ts re-exports every name below, so a
// server caller imports one module and a client caller imports the half that
// cannot reach a socket. Two declarations of `MAX_COMMENT` would be two
// answers to how long a remark may be, and the shorter one would win silently
// in whichever place somebody forgot.

/**
 * How long a remark may be.
 *
 * A COMMENT IS A SENTENCE, NOT A DOCUMENT. Two thousand characters is
 * generous for "the maker on this lot is wrong, it should be 佚名" and short
 * enough that a panel of threads stays scannable — which is the whole job of
 * the panel. Somebody with more to say than this has a condition report or a
 * field to correct, and both are elsewhere in the product.
 *
 * Enforced in two places on purpose: the textarea's `maxLength` so a person
 * is told while typing, and `addComment`'s slice so a client that ignores it
 * cannot write a megabyte into a jsonb-free text column.
 */
export const MAX_COMMENT = 2000;

export interface CommentAuthor {
  id: string;
  /** What to print. The address when nobody has a name yet. */
  name: string;
  email: string;
  /**
   * Whether this is the house's GATE IDENTITY rather than a person.
   *
   * Before sign-in was configured, every human decision was written against
   * one `users` row per org — "a member of the house, before the system could
   * say which one" (src/lib/data/actor.ts). Those rows are honest and they are
   * not people, and a thread that credits one by its generated name reads as
   * though somebody called "Demonstration House - via the gate" said it.
   *
   * Computed on the server by `isGateIdentity`, which is where the rule about
   * what a gate address looks like already lives — a client that matched the
   * domain itself would be a second copy of it.
   */
  viaGate: boolean;
}

export interface Comment {
  id: string;
  body: string;
  author: CommentAuthor;
  createdAt: Date;
}

export interface CommentThread extends Comment {
  lotId: string;
  /** Which part of the lot, or null for the lot itself. */
  field: string | null;
  /** The lot's reference, so a panel can name it without a second query. */
  ref: string | null;
  resolvedAt: Date | null;
  resolvedBy: CommentAuthor | null;
  replies: Comment[];
}
