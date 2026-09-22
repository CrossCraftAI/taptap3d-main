// The two-frame swap, and the one invariant five driven specs depend on.
//
// Three functions over a two-field object, which is exactly why they are worth
// testing: the failure they prevent — a commit throwing the reader back to
// page 1 of a 43-page flow — is invisible to a unit test of any component, and
// the failure they can CAUSE is worse. Two elements titled "Catalogue preview"
// makes `page.frameLocator('iframe[title="Catalogue preview"]')` strict-mode
// fail in corrections, editor, pdf, pitch and templates at once, which reads
// as a Playwright fault rather than as this.

import { describe, expect, it } from "vitest";

import {
  back,
  BACK_TITLE,
  BLANK,
  FRONT_TITLE,
  openBuffers,
  readyToShow,
  show,
  srcFor,
  titleOf,
  type BufferState,
} from "@/lib/editor/preview-buffer";

const A = "/events/e/catalogue/preview?v=cat-4-above-ref-page-10-1-100";
const B = "/events/e/catalogue/preview?v=cat-4-above-ref-page-10-1-200";
const C = "/events/e/catalogue/preview?v=cat-9-above-ref-page-10-1-300";
const href = (src: string): string => `https://house.example${src}`;

/** Drive the machine the way the component does: render, load, swap. */
function commit(state: BufferState, wanted: string): BufferState {
  const slot = back(state);
  const src = srcFor(state, slot, wanted);
  expect(src).toBe(wanted);
  expect(readyToShow(state, slot, src, href(src), href(src))).toBe(true);
  return show(state, slot, src);
}

describe("exactly one frame answers to the preview's name", () => {
  it("holds through any number of swaps", () => {
    let state = openBuffers(A);
    for (const wanted of [B, C, A, B]) {
      const titles = [titleOf(state, 0), titleOf(state, 1)];
      expect(titles.filter((t) => t === FRONT_TITLE)).toHaveLength(1);
      expect(titles.filter((t) => t === BACK_TITLE)).toHaveLength(1);
      state = commit(state, wanted);
    }
    expect(state.shown).toBe(B);
  });

  it("names the role and not the slot", () => {
    const open = openBuffers(A);
    expect(titleOf(open, 0)).toBe(FRONT_TITLE);
    expect(titleOf(show(open, 1, B), 0)).toBe(BACK_TITLE);
    expect(titleOf(show(open, 1, B), 1)).toBe(FRONT_TITLE);
  });
});

describe("srcFor", () => {
  const open = openBuffers(A);

  it("never navigates the frame the reader is looking at", () => {
    // Obeying a request to load into the front would reintroduce the
    // single-frame defect silently: the document would go blank and come back
    // at scroll zero.
    expect(srcFor(open, open.front, B)).toBe(A);
    expect(srcFor(open, open.front, C)).toBe(A);
  });

  it("puts the wanted document in the other frame", () => {
    expect(srcFor(open, back(open), B)).toBe(B);
  });

  it("parks the other frame when there is nothing to prepare", () => {
    // Not an absent attribute — removing `src` leaves the document that is
    // already there — and not "", which would navigate to the editor itself.
    expect(srcFor(open, back(open), A)).toBe(BLANK);
    expect(BLANK).toBe("about:blank");
  });

  it("re-fetches a document the outgoing frame was holding a moment ago", () => {
    // Keeping it to save the fetch is the tempting version and it deadlocks:
    // the attribute would already be the wanted URL, React would change
    // nothing, and no load event would arrive to trigger the swap.
    const after = commit(open, B);
    expect(srcFor(after, after.front, A)).toBe(B);
    expect(srcFor(after, back(after), A)).toBe(A);
  });
});

describe("readyToShow", () => {
  const open = openBuffers(A);
  const slot = back(open);

  it("swaps when the frame that loaded is the one holding what was asked for", () => {
    expect(readyToShow(open, slot, B, href(B), href(B))).toBe(true);
  });

  it("ignores a load that belongs to a navigation already replaced", () => {
    // Two commits close together: the frame was told to fetch B, then C, and
    // B's load event arrives late. Swapping on it would put a stale page in
    // front of the reader.
    expect(readyToShow(open, slot, C, href(C), href(B))).toBe(false);
    expect(readyToShow(open, slot, C, href(C), null)).toBe(false);
  });

  it("ignores the blank frame settling", () => {
    expect(readyToShow(open, slot, BLANK, href(BLANK), href(BLANK))).toBe(false);
  });

  it("ignores the front frame's own load", () => {
    // The front reloads for reasons of its own — a person pressing refresh —
    // and that is not a swap.
    expect(readyToShow(open, open.front, A, href(A), href(A))).toBe(false);
  });

  it("does nothing when the reader is already looking at what was asked for", () => {
    expect(readyToShow(open, slot, A, href(A), href(A))).toBe(false);
  });
});

describe("show", () => {
  it("moves the reader to the prepared frame and remembers what it holds", () => {
    const after = show(openBuffers(A), 1, B);
    expect(after).toEqual({ front: 1, shown: B });
  });

  it("leaves the state it was given alone", () => {
    const open = openBuffers(A);
    show(open, 1, B);
    expect(open).toEqual({ front: 0, shown: A });
  });
});
