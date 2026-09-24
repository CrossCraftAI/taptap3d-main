"use client";

import { useActionState, useState, useTransition } from "react";

import {
  addMarkAction,
  deleteMarkAction,
  saveExaminationAction,
  setMarkNoteAction,
  setReferenceViewAction,
} from "@/app/events/[id]/lots/[lotId]/condition/actions";
import { ConditionViewer, type ViewerMark } from "@/components/condition-viewer";
import { IDLE_LOT_FORM, type LotFormState } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

/**
 * The condition screen: a reference view on the left, the report on the right.
 *
 * ── TWO READINGS OF THE SAME MARKS, AND BOTH WERE DECIDED ───────────────────
 *
 * THIS EXAMINATION is a dated document attached to a handoff — it is what
 * travels with the crate and what a claim is argued from, and it is editable
 * because the person writing it is standing over the object.
 *
 * LIFETIME rolls every examination into one history per fault, which is only
 * possible because a mark's coordinates are fractions of a stable space (see
 * src/lib/data/examinations.ts, `lifetimeOf`). It is READ-ONLY, and that is not
 * a missing feature: a mark added there would have no examination to belong to,
 * and a note edited there would silently rewrite what somebody recorded on a
 * date that has passed.
 *
 * ── THREE VIEWS, THREE COORDINATE SPACES ────────────────────────────────────
 *
 * The switcher above the object changes the space, not a layer. A footrim mark
 * cannot be expressed in the front view's coordinates at all, so switching
 * views changes which marks exist — and the numbering restarts, because "mark
 * 2" said while the front is showing has to mean the second mark on the front.
 */

/** A view's slug and the word on its button. Mirrors REFERENCE_VIEWS server-side. */
export interface ViewChoice {
  view: string;
  label: string;
  /** `/api/assets/<hash>` for the photograph standing for this view, or null. */
  src: string | null;
  /** What was photographed and when, or what is missing. One line under the box. */
  caption: string;
}

export interface WorkbenchMark {
  id: string;
  view: string;
  number: number;
  x: number;
  y: number;
  note: string;
}

export interface WorkbenchSighting {
  at: string;
  examiner: string | null;
  note: string;
  first: boolean;
}

export interface WorkbenchFault {
  view: string;
  number: number;
  x: number;
  y: number;
  sightings: WorkbenchSighting[];
}

export interface WorkbenchExamination {
  id: string;
  /** Formatted on the server: a client that formats a date rehydrates a different one. */
  at: string;
  examiner: string | null;
  light: string | null;
  summary: string | null;
  /** The handoff this was filed on, described, or null for a standing check. */
  occasion: string | null;
}

export interface PhotographChoice {
  id: string;
  label: string;
}

export function ConditionWorkbench({
  eventId,
  lotId,
  views,
  examination,
  examinationCount,
  marks,
  lifetime,
  photographs,
}: {
  eventId: string;
  lotId: string;
  views: readonly ViewChoice[];
  /** The newest examination — the one being written. */
  examination: WorkbenchExamination;
  examinationCount: number;
  marks: readonly WorkbenchMark[];
  lifetime: readonly WorkbenchFault[];
  photographs: readonly PhotographChoice[];
}): React.ReactElement {
  const [view, setView] = useState(views[0]?.view ?? "front");
  const [showLifetime, setShowLifetime] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = views.find((v) => v.view === view) ?? views[0]!;
  const ownMarks = marks.filter((m) => m.view === view);
  const faults = lifetime.filter((f) => f.view === view);

  const viewerMarks: ViewerMark[] = showLifetime
    ? faults.map((fault) => ({
        // A fault has no row of its own — it is a grouping — so its key is the
        // view and its number, which is stable for as long as the grouping is.
        id: `${fault.view}-${fault.number}`,
        number: fault.number,
        x: fault.x,
        y: fault.y,
        sightings: fault.sightings.length,
      }))
    : ownMarks.map((mark) => ({
        id: mark.id,
        number: mark.number,
        x: mark.x,
        y: mark.y,
        sightings: 1,
      }));

  const place = (x: number, y: number): void => {
    setRefusal(null);
    logAction("condition.mark.add", { lotId, view });
    start(async () => {
      const result = await addMarkAction(eventId, lotId, examination.id, view, x, y);
      if (!result.ok) setRefusal(result.message);
    });
  };

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <section>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Reference view" className="flex">
            {views.map((choice) => (
              <button
                key={choice.view}
                type="button"
                aria-pressed={choice.view === view}
                onClick={() => {
                  setView(choice.view);
                  setSelected(null);
                }}
                className={`min-h-[var(--tap)] border border-rule px-3 text-[12px] ${
                  choice.view === view
                    ? "bg-ink text-paper"
                    : "bg-paper text-muted hover:bg-sunk"
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-faint">
            Each view is its own coordinate space — a footrim mark cannot be put
            on the front.
          </p>
        </div>

        <div className="mt-3">
          <ConditionViewer
            view={current.view}
            label={current.label}
            src={current.src}
            caption={current.caption}
            marks={viewerMarks}
            selectedId={selected}
            onSelect={setSelected}
            onAdd={showLifetime ? null : place}
          />
        </div>

        {refusal && (
          <p role="status" aria-live="polite" className="mt-2 text-[12px] text-seal">
            {refusal}
          </p>
        )}

        <ViewPhotograph
          eventId={eventId}
          lotId={lotId}
          examinationId={examination.id}
          view={current}
          photographs={photographs}
        />
      </section>

      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium">Condition</h2>
          <div role="group" aria-label="Report" className="flex">
            <button
              type="button"
              aria-pressed={!showLifetime}
              onClick={() => setShowLifetime(false)}
              className={`min-h-[var(--tap)] border border-rule px-3 text-[12px] ${
                showLifetime ? "bg-paper text-muted hover:bg-sunk" : "bg-ink text-paper"
              }`}
            >
              This examination
            </button>
            <button
              type="button"
              aria-pressed={showLifetime}
              onClick={() => {
                setShowLifetime(true);
                setSelected(null);
              }}
              className={`min-h-[var(--tap)] border border-rule px-3 text-[12px] ${
                showLifetime ? "bg-ink text-paper" : "bg-paper text-muted hover:bg-sunk"
              }`}
            >
              Lifetime
            </button>
          </div>
        </div>

        {showLifetime ? (
          <LifetimeReport
            faults={faults}
            count={examinationCount}
            label={current.label}
            href={`/events/${eventId}/lots/${lotId}/condition/report?of=lifetime`}
          />
        ) : (
          <ThisExamination
            eventId={eventId}
            lotId={lotId}
            examination={examination}
            marks={ownMarks}
            label={current.label}
            selected={selected}
            onSelect={setSelected}
            pending={pending}
            onRefuse={setRefusal}
            onAddCentre={() => place(0.5, 0.5)}
          />
        )}
      </section>
    </div>
  );
}

/**
 * Which photograph stands for this view.
 *
 * ── THE ONE WRITER `examination_assets` HAS, AND WHY IT IS HERE ─────────────
 *
 * A reference view is a coordinate space; this says which picture illustrates
 * it. It is a `<select>` over the lot's own photographs rather than an upload,
 * because the photographs are already in the library and a second way to get
 * one in would be a second ingestion path (ARCHITECTURE.md's closing list).
 *
 * "None" is an option, so a wrong choice is reversible in the control that
 * made it. Clearing it moves nothing: the marks are fractions of the view.
 */
function ViewPhotograph({
  eventId,
  lotId,
  examinationId,
  view,
  photographs,
}: {
  eventId: string;
  lotId: string;
  examinationId: string;
  view: ViewChoice;
  photographs: readonly PhotographChoice[];
}): React.ReactElement {
  const [state, action] = useActionState<LotFormState, FormData>(
    setReferenceViewAction.bind(null, eventId, lotId, examinationId),
    IDLE_LOT_FORM,
  );

  if (photographs.length === 0) {
    return (
      <p className="mt-4 text-[12px] leading-relaxed text-faint">
        This lot has no photographs yet, so no picture can stand for a view. Add
        one on the lot&rsquo;s own screen; the marks already placed stay where
        they are.
      </p>
    );
  }

  return (
    <form action={action} className="mt-4 flex flex-wrap items-center gap-2">
      <label htmlFor={`ref-${view.view}`} className="text-[12px] text-muted">
        {view.label} view shows
      </label>
      <input type="hidden" name="view" value={view.view} />
      <select
        id={`ref-${view.view}`}
        name="assetId"
        defaultValue=""
        key={view.view}
        className="min-h-[var(--tap)] min-w-0 flex-1 border border-rule bg-paper px-2 text-[13px]"
      >
        <option value="">— no photograph —</option>
        {photographs.map((photograph) => (
          <option key={photograph.id} value={photograph.id}>
            {photograph.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-3 text-[12px] font-medium hover:bg-sunk"
      >
        Use it
      </button>
      {state.message && (
        <p
          key={state.at}
          role="status"
          aria-live="polite"
          className={`basis-full text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

function ThisExamination({
  eventId,
  lotId,
  examination,
  marks,
  label,
  selected,
  onSelect,
  pending,
  onRefuse,
  onAddCentre,
}: {
  eventId: string;
  lotId: string;
  examination: WorkbenchExamination;
  marks: readonly WorkbenchMark[];
  label: string;
  selected: string | null;
  onSelect: (id: string) => void;
  pending: boolean;
  onRefuse: (message: string | null) => void;
  onAddCentre: () => void;
}): React.ReactElement {
  const [state, action, saving] = useActionState<LotFormState, FormData>(
    saveExaminationAction.bind(null, eventId, lotId, examination.id),
    IDLE_LOT_FORM,
  );

  return (
    <div className="mt-3 border border-rule bg-paper">
      <form action={action} onSubmit={() => logAction("condition.save", { lotId })}>
        <dl className="border-b border-rule px-4 py-2 text-[12px]">
          <div className="flex gap-3 py-0.5">
            <dt className="w-20 shrink-0 text-faint">Examined</dt>
            <dd data-numeric>{examination.at}</dd>
          </div>
          {examination.occasion && (
            <div className="flex gap-3 py-0.5">
              <dt className="w-20 shrink-0 text-faint">Occasion</dt>
              <dd className="min-w-0">{examination.occasion}</dd>
            </div>
          )}
        </dl>
        <Row id="examiner" label="By" value={examination.examiner} placeholder="who looked" />
        <Row
          id="light"
          label="Light"
          value={examination.light}
          placeholder="daylight · raking · UV"
        />
        <div className="border-b border-rule px-4 py-2">
          <label htmlFor="summary" className="block text-[12px] text-muted">
            Overall
          </label>
          <textarea
            id="summary"
            name="summary"
            defaultValue={examination.summary ?? ""}
            rows={3}
            placeholder="What a bidder needs to know before the marks."
            className="mt-1 min-h-[var(--tap)] w-full resize-y border border-rule bg-paper px-2 py-1 text-[13px] leading-relaxed"
          />
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-rule bg-field px-4 py-2">
          <p
            key={state.at}
            role="status"
            aria-live="polite"
            className={`min-w-0 text-[12px] ${state.ok ? "text-muted" : "text-seal"}`}
          >
            {state.message}
          </p>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[var(--tap)] shrink-0 bg-seal px-3 text-[12px] font-medium text-paper hover:bg-sealPress disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </form>

      {marks.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] leading-relaxed text-muted">
          Nothing marked on the {label.toLowerCase()} yet. Tap the object where a
          fault is — or add one in the middle and move on.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {marks.map((mark) => (
            <MarkRow
              key={mark.id}
              eventId={eventId}
              lotId={lotId}
              mark={mark}
              on={mark.id === selected}
              onSelect={onSelect}
              onRefuse={onRefuse}
            />
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-field px-4 py-2">
        <p className="text-[12px] text-faint" data-numeric>
          {pending ? "Placing…" : `${marks.length} on the ${label.toLowerCase()}.`}
        </p>
        {/* THE KEYBOARD PATH TO A NEW MARK, and the mockup's "add a mark with
            no location" answered honestly. A two-dimensional gesture has no
            keyboard equivalent, so this places one in the MIDDLE of the view
            rather than nowhere — a mark with no coordinates would be a row the
            viewer could not draw and the report could not number. Moving a
            mark afterwards is NOT shipped — remove it and tap where the fault
            is — which is why this says "in the middle" rather than implying it
            can be nudged into place later. */}
        <button
          type="button"
          onClick={onAddCentre}
          className="min-h-[var(--tap)] border border-ruleStrong bg-paper px-3 text-[12px] font-medium hover:bg-sunk"
        >
          Add a mark in the middle
        </button>
      </div>
    </div>
  );
}

function Row({
  id,
  label,
  value,
  placeholder,
}: {
  id: string;
  label: string;
  value: string | null;
  placeholder: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-4 border-b border-rule px-4 py-2">
      <label htmlFor={id} className="w-20 shrink-0 text-[12px] text-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="min-h-[var(--tap)] min-w-0 flex-1 border border-rule bg-paper px-2 text-[13px]"
      />
    </div>
  );
}

/**
 * One numbered mark.
 *
 * ── SAVED ON BLUR, NOT ON EVERY KEYSTROKE AND NOT BY A BUTTON ───────────────
 *
 * A registrar marks a fault, types a sentence, and taps the next fault. A Save
 * button per mark is forty buttons on a forty-mark report; a save per keystroke
 * is a round trip per character over warehouse wifi. Blur is the moment the
 * sentence is finished, and it is the moment the next tap produces anyway.
 *
 * The field does NOT disable itself while saving. A disabled input is blurred
 * by the browser and eats the keystrokes typed into it — the predecessor lost
 * `-1.37` to exactly that.
 */
function MarkRow({
  eventId,
  lotId,
  mark,
  on,
  onSelect,
  onRefuse,
}: {
  eventId: string;
  lotId: string;
  mark: WorkbenchMark;
  on: boolean;
  onSelect: (id: string) => void;
  onRefuse: (message: string | null) => void;
}): React.ReactElement {
  const [, start] = useTransition();

  return (
    <li
      className={`flex gap-3 border-b border-rule px-4 py-2 last:border-b-0 ${
        on ? "bg-sealSoft" : ""
      }`}
    >
      <span
        data-numeric
        aria-hidden="true"
        className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center border text-[10px] font-semibold ${
          on ? "border-seal text-seal" : "border-ruleStrong text-muted"
        }`}
      >
        {mark.number}
      </span>
      <div className="min-w-0 flex-1">
        <textarea
          aria-label={`Note for mark ${mark.number}`}
          defaultValue={mark.note}
          rows={2}
          placeholder="Describe what you can see."
          onFocus={() => onSelect(mark.id)}
          onBlur={(event) => {
            const note = event.currentTarget.value;
            if (note === mark.note) return;
            start(async () => {
              const result = await setMarkNoteAction(eventId, lotId, mark.id, note);
              if (!result.ok) onRefuse(result.message);
            });
          }}
          className="min-h-[var(--tap)] w-full resize-y border border-rule bg-paper px-2 py-1 text-[13px] leading-relaxed"
        />
        <button
          type="button"
          onClick={() =>
            start(async () => {
              const result = await deleteMarkAction(eventId, lotId, mark.id);
              if (!result.ok) onRefuse(result.message);
            })
          }
          className="mt-1 inline-flex min-h-[var(--tap)] items-center text-[12px] text-muted hover:text-seal hover:underline"
        >
          Remove mark {mark.number}
        </button>
      </div>
    </li>
  );
}

/**
 * The lifetime report: one entry per fault, with every time it was seen.
 *
 * READ-ONLY, and it says so rather than offering controls that refuse. The
 * grouping is derived by proximity in the view's coordinate space
 * (src/lib/data/examinations.ts, `lifetimeOf`), which is the return on storing
 * fractions of a stable box rather than pixels of a file.
 */
function LifetimeReport({
  faults,
  count,
  label,
  href,
}: {
  faults: readonly WorkbenchFault[];
  count: number;
  label: string;
  href: string;
}): React.ReactElement {
  return (
    <div className="mt-3 border border-rule bg-paper">
      <p className="border-b border-rule bg-field px-4 py-2 text-[12px] text-muted">
        <span data-numeric>{count}</span>{" "}
        {count === 1 ? "examination" : "examinations"} of this lot, rolled into
        one history per fault. Nothing here is editable — each line was recorded
        on a date that has passed.{" "}
        {/* A plain anchor: the report is a document with its own content type,
            and a client-side navigation has nowhere to put it. */}
        <a
          href={href}
          className="inline-flex min-h-[var(--tap)] items-center text-muted underline hover:text-seal"
        >
          Print the lifetime report
        </a>
      </p>
      {faults.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12px] text-muted">
          Nothing has ever been marked on the {label.toLowerCase()}.
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {faults.map((fault) => (
            <li
              key={`${fault.view}-${fault.number}`}
              className="flex gap-3 border-b border-rule px-4 py-2 last:border-b-0"
            >
              <span
                data-numeric
                aria-hidden="true"
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border border-ruleStrong text-[10px] font-semibold text-muted"
              >
                {fault.number}
              </span>
              <ul className="m-0 min-w-0 flex-1 list-none p-0">
                {fault.sightings.map((sighting, index) => (
                  <li key={`${sighting.at}-${index}`} className="py-0.5 text-[12px]">
                    <b data-numeric className="mr-2 font-medium text-faint">
                      {sighting.at}
                    </b>
                    <span className={sighting.first ? "text-ink" : "text-muted"}>
                      {sighting.note || "Noted, no description."}
                    </span>
                    {sighting.first && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-seal">
                        first seen
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
