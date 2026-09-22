// What a form hears back from its server action, and the state it starts in.
//
// A SEPARATE MODULE, and not for tidiness. A `"use server"` file may export
// only async functions — a constant exported beside the actions fails at module
// evaluation, in production, with "found object". `tsc` and `next build` both
// passed with that constant in place; the first request to the page did not.
// So the initial states live here, in a file with no directive, and both the
// actions and the components import them from it.

/** A lot-page form's answer. `at` changes every time so a repeated message is re-announced. */
export interface LotFormState {
  ok: boolean;
  message: string | null;
  at: number;
}

export const IDLE_LOT_FORM: LotFormState = { ok: true, message: null, at: 0 };

/** The pin panel's answer: a refusal to show, or nothing. */
export interface PinFormState {
  message: string | null;
  at: number;
}

export const NO_PIN_MESSAGE: PinFormState = { message: null, at: 0 };

/**
 * What a drag hears back.
 *
 * NOT `LotFormState`, although it is the same three fields minus one. A form
 * says something on success — "Saved. Every catalogue of this sale prints it
 * this way now." — because the person pressed a button and is owed an
 * acknowledgement. A drag acknowledges itself: the part is where they let go
 * of it. So the only message here is a refusal, and `ok` with a message is a
 * shape this one cannot express.
 */
export type PlaceResult = { ok: true } | { ok: false; message: string };
