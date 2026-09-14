"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { pinTogetherAction, unpinAction } from "@/app/events/[id]/catalogue/actions";
import { NO_PIN_MESSAGE, type PinFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

export interface PinPanelLot {
  id: string;
  ref: string | null;
  title: string;
  /** Where the engine put it THIS time. Shown to a person; nothing is keyed to it. */
  page: number | null;
  /** Decided overrides on this lot in this catalogue. */
  overrides: number;
  pinned: boolean;
}

export interface PinPanelPin {
  id: string;
  refs: string[];
}

/**
 * The lots of the catalogue, beside the preview: where a specialist picks the
 * ones that must stay together, and where they open a lot to correct it.
 *
 * ── A PIN IS ITS MEMBERS ─────────────────────────────────────────────────────
 *
 * The obvious build is a rubber band over the preview — but the preview is an
 * inert document, and what a rubber band selects is SLOTS, whose identity is
 * where they landed. The list selects LOTS. The form posts lot ids and nothing
 * about pages; the page number in the right-hand column is information, drawn
 * from this derivation, and will read differently at the next density without
 * anything having gone wrong.
 *
 * THE PAGE KEYS THIS WHOLE PANEL ON THE CATALOGUE'S VERSION. A pin that lands
 * touches the catalogue, so the panel is new: no ticks, no message. A pin that
 * is refused changes nothing, so the ticks and the refusal both stay and the
 * person fixes the selection rather than the whole thing again. The first
 * version keyed only the list, and a refusal's message then outlived two
 * density changes in the footer — seen in a screenshot, not in a test.
 */
export function PinPanel({
  eventId,
  catalogueId,
  lots,
  pins,
}: {
  eventId: string;
  catalogueId: string;
  lots: PinPanelLot[];
  pins: PinPanelPin[];
}): React.ReactElement {
  const [state, pinAction, pending] = useActionState<PinFormState, FormData>(
    pinTogetherAction.bind(null, eventId),
    NO_PIN_MESSAGE,
  );

  return (
    <aside
      aria-label="Lots in this catalogue"
      className="flex min-h-0 flex-col border border-rule bg-paper"
    >
      <div className="shrink-0 border-b border-rule px-4 py-2.5">
        <h2 className="text-[13px] font-medium">Lots</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
          Tick neighbours and pin them to stay on one page. Open a lot to correct it.
        </p>
      </div>

      {pins.length > 0 && (
        <div className="shrink-0 border-b border-rule px-4 py-2">
          <p className="text-[11px] tracking-wide text-muted">Pinned together</p>
          <ul className="mt-1">
            {pins.map((pin) => (
              <li
                key={pin.id}
                className="flex items-center justify-between gap-3 py-1 text-[12px]"
              >
                <span className="min-w-0 truncate" data-numeric>
                  {pin.refs.join(" · ")}
                </span>
                <form
                  action={unpinAction.bind(null, eventId, pin.id)}
                  onSubmit={() => logAction("catalogue.unpin", { pinId: pin.id }, catalogueId)}
                >
                  <button
                    type="submit"
                    className="shrink-0 text-[11px] text-muted underline hover:text-seal"
                  >
                    Unpin
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        action={pinAction}
        onSubmit={() => logAction("catalogue.pin", { lots: lots.length }, catalogueId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <PinBody
          eventId={eventId}
          lots={lots}
          message={state.message}
          pending={pending}
        />
      </form>
    </aside>
  );
}

function PinBody({
  eventId,
  lots,
  message,
  pending,
}: {
  eventId: string;
  lots: PinPanelLot[];
  message: string | null;
  pending: boolean;
}): React.ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string): void =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {lots.map((lot) => (
          <li
            key={lot.id}
            className="flex items-center gap-2 border-b border-rule px-3 py-1.5 text-[12px] last:border-b-0 hover:bg-field"
          >
            <input
              type="checkbox"
              name="lotId"
              value={lot.id}
              checked={selected.has(lot.id)}
              onChange={() => toggle(lot.id)}
              // Already in a pin: the server would refuse, so the box says so first.
              disabled={lot.pinned}
              aria-label={`Select ${lot.ref ?? lot.title}`}
              className="shrink-0 accent-[#a32a24]"
            />
            <Link
              href={`/events/${eventId}/lots/${lot.id}`}
              className="min-w-0 flex-1 truncate hover:text-seal hover:underline"
              title={lot.title}
            >
              <span className="font-medium" data-numeric>
                {lot.ref ?? "—"}
              </span>{" "}
              <span className="text-muted">{lot.title || "untitled"}</span>
            </Link>
            {lot.overrides > 0 && (
              <span
                className="shrink-0 bg-sealSoft px-1 py-px text-[10px] font-medium text-seal"
                title="Fields this catalogue prints differently"
              >
                {lot.overrides} overridden
              </span>
            )}
            {lot.pinned && (
              <span className="shrink-0 border border-ruleStrong px-1 py-px text-[10px] text-muted">
                pinned
              </span>
            )}
            <span className="w-8 shrink-0 text-right text-[11px] text-faint" data-numeric>
              {lot.page ? `p.${lot.page}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-rule bg-field px-3 py-2">
        <p role="status" aria-live="polite" className="min-w-0 text-[12px] leading-snug">
          {message ? (
            <span className="text-seal">{message}</span>
          ) : (
            <span className="text-muted" data-numeric>
              {selected.size} selected
            </span>
          )}
        </p>
        <button
          type="submit"
          disabled={pending || selected.size < 2}
          className="shrink-0 border border-ruleStrong bg-paper px-2.5 py-1 text-[12px] font-medium hover:bg-field disabled:opacity-50"
        >
          Pin together
        </button>
      </div>
    </>
  );
}
