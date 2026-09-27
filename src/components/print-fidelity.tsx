"use client";

import { useEffect, useState } from "react";

import { CJK_PROBE_GLYPH } from "@/lib/render/html";
import { CJK_FACES, serifVerdict, type SerifVerdict } from "@/lib/polish/serif-check";

/**
 * Whether this machine can show the specialist the page the printer will make.
 *
 * ── WHY IT IS IN THE POLISH PANEL ───────────────────────────────────────────
 *
 * Because that is where a person is judging how a plate will PRINT, and the
 * type around the plate is half of that judgement. It is not a banner: a
 * warning across the top of the application is read once and dismissed
 * forever, and the thing it is warning about only matters at the moment
 * somebody is deciding whether a spread looks right.
 *
 * Any owner can mount it elsewhere — it takes no props and reads no state but
 * the browser's own font list. Beside the preview frame would be the other
 * good home, and that file belongs to another agent this cycle.
 *
 * ── AFTER PAINT, AND NEVER ON THE SERVER ────────────────────────────────────
 *
 * `document.fonts` is a property of the machine looking at the page, so there
 * is no answer to render on the server and a hydration that guessed one would
 * be wrong on exactly the machines this exists for. It renders nothing until
 * it has asked, which is also why there is no "checking…" state: a line that
 * flashes and then says everything is fine is noise on the ninety percent of
 * machines that are fine.
 */
export function PrintFidelity(): React.ReactElement | null {
  const [verdict, setVerdict] = useState<SerifVerdict | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ask = (): void => {
      const available = CJK_FACES.filter((face) => {
        // `check` throws on a font shorthand it cannot parse, and a family
        // name with a quote in it would be exactly that. These six are
        // constants in this repository, so it cannot happen — and a probe that
        // took the whole panel down with it if it ever did would be a worse
        // failure than the one being probed for.
        try {
          return document.fonts.check(`16px "${face}"`, CJK_PROBE_GLYPH);
        } catch {
          return false;
        }
      });
      if (!cancelled) setVerdict(serifVerdict(available));
    };
    // AFTER THE DOCUMENT'S OWN FONTS HAVE SETTLED. `check` answers about what
    // is available NOW, and asking during load reports a machine as bare that
    // is merely still loading.
    document.fonts.ready.then(ask, ask);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!verdict || verdict.fidelity === "serif") return null;

  return (
    <p
      // The seal means a person is needed here, which is what this is: nobody
      // can fix it but them, and the fix is off the screen.
      className="border-l-2 border-seal bg-sealSoft px-2 py-1.5 text-[12px] text-muted"
      role="status"
    >
      {verdict.message}
    </p>
  );
}
