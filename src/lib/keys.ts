// Keyboard shortcuts — the one guard all of them need.
//
// There are two now: Ctrl+\ puts the rail away (src/components/shell.tsx) and
// ← / → step between the lots of a sale (src/components/lot-steps.tsx). Both
// listen on `window`, because a shortcut that fires only while its own button
// has focus is not a shortcut — and that means both of them see every
// keystroke a person types into a field.
//
// SO THE GUARD LIVES HERE, NOT TWICE. It was written once, private inside the
// shell, and a second shortcut is exactly how a copy of it drifts: the copy
// that forgets `isContentEditable`, or forgets SELECT, turns a title somebody
// is part-way through typing into a navigation away from the page. That is
// data a specialist loses without ever being told why.
//
// Duck-typed rather than `instanceof`: ARCHITECTURE.md, "instanceof lies
// across realms" — this product renders the catalogue into an iframe, and a
// node from that document is not an instance of the parent document's
// constructors, so the check would quietly answer false there.

/** Whether a key event came from something a person types into. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName;
  if (!tag) return false;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable === true
  );
}
