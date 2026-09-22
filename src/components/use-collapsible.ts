"use client";

import { useCallback, useState } from "react";

import { type Collapsible, isOpen, readChoice, writeChoice } from "@/lib/chrome";
import { logAction } from "@/lib/log/client";

/**
 * One part of the chrome, open or shut, remembered per viewer.
 *
 * Four parts now use this — the top bar, the rail, each of the rail's two
 * groups and the palette — and the first three were written out longhand in
 * the shell before there were four. The shape is the one src/lib/chrome.ts
 * documents and it is load-bearing: the stored value is read in a LAZY
 * initialiser so React's first client render agrees with the DOM the
 * before-paint script has already corrected, and hydration has nothing to
 * repair. An effect here would run after paint, which is the flash.
 *
 * Counted (ARCHITECTURE.md principle 5): how often a viewer wants a piece of
 * chrome back is the only evidence there is about whether its default is
 * right, and it cannot be asked retrospectively. The gesture's NAME is the
 * caller's rather than derived from the key, so the rail's series — logged as
 * `shell.rail` since the rail could first be put away — is not silently
 * restarted under a new name by this refactor.
 */
export function useCollapsible(
  part: Collapsible,
  fallback: boolean,
  action: string,
): [boolean, (next: boolean) => void] {
  const [stored, setStored] = useState<string | null>(() => readChoice(part.key));
  const open = isOpen(stored, fallback);

  const set = useCallback(
    (next: boolean): void => {
      const choice = next ? "open" : "closed";
      setStored(choice);
      writeChoice(part.key, choice);
      logAction(action, { open: next });
    },
    [action, part.key],
  );

  return [open, set];
}
