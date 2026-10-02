"use client";

import { useState, useTransition } from "react";

// ./comment-value and NOT ./comments: this is a client component, and that
// module reaches the database. See the header of src/lib/data/comment-value.ts
// for the build error this exact import caused once.
import {
  MAX_COMMENT,
  type CommentAuthor,
  type CommentThread,
} from "@/lib/data/comment-value";
import type { MoveResult } from "@/lib/forms";
import { logAction } from "@/lib/log/client";

/**
 * The house's argument about this catalogue, beside the catalogue.
 *
 * ── THE SHAPE IS CLAUDE'S DRAWBOARD, WHICH THE OWNER NAMED ────────────────
 *
 * Three things taken from it, and each one is a decision rather than a style:
 *
 *   HOVER REVEALS, IT DOES NOT OCCUPY. A control that is always drawn on
 *   every part is a product that looks like a form; one that appears under
 *   the pointer is a product that looks like a document. The affordance
 *   lives on the plate (preview-canvas.tsx) and this panel is where the
 *   conversation lands.
 *
 *   A MODE, NOT A PANEL THAT IS ALWAYS OPEN. Commenting and placing are
 *   different jobs done at different moments, and a canvas that is always
 *   both is a canvas where a drag sometimes means "move this" and sometimes
 *   means "say something about this". The toggle makes which one it is a
 *   thing a person decided.
 *
 *   IT ASSUMES MORE THAN ONE PERSON IS IN HERE. Every remark is attributed,
 *   threads are settled rather than deleted, and nothing is a shared blob two
 *   people can overwrite — a reply is its own row, so two colleagues typing
 *   at once produce two replies instead of one of them losing their words.
 *
 * ── WHAT IS HONESTLY NOT HERE ─────────────────────────────────────────────
 *
 * LIVE PRESENCE. No cursors, no "somebody is typing", no push. A new remark
 * appears when the server next answers, because this deployment has no socket
 * server, no queue and no worker — the same reason the workflow engine is
 * waiting on infrastructure rather than on a decision. Saying so here is
 * better than a panel that looks live and is a minute stale.
 */

const TAP = "min-h-[var(--tap)]";

/**
 * What to credit a remark to.
 *
 * A GATE IDENTITY IS NOT A PERSON. Before sign-in was configured every human
 * decision was written against one `users` row per org, whose generated name
 * reads like somebody's — "Demonstration House - via the gate" — and crediting
 * a thread to it would be the screen claiming more than the record says. The
 * record's own claim is "a member of the house, before the system could say
 * which one", and that is what this prints.
 */
function who(author: CommentAuthor): string {
  return author.viaGate ? "Someone at the house, before sign-in" : author.name;
}

export function CommentPanel({
  threads,
  /** Which part the canvas has selected, so a new remark lands on it. */
  subject,
  add,
  resolve,
}: {
  threads: readonly CommentThread[];
  subject: { lotId: string; field: string | null; ref: string | null } | null;
  add: (lotId: string, field: string | null, body: string, parentId: string | null)
    => Promise<MoveResult>;
  resolve: (commentId: string, resolved: boolean) => Promise<MoveResult>;
}): React.ReactElement {
  const [showSettled, setShowSettled] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const open = threads.filter((t) => t.resolvedAt === null);
  const settled = threads.filter((t) => t.resolvedAt !== null);
  const shown = showSettled ? [...open, ...settled] : open;

  const send = (lotId: string, field: string | null, parentId: string | null): void => {
    const body = draft.trim();
    if (!body) return;
    logAction("comment.add", { lotId, reply: parentId !== null });
    startTransition(async () => {
      const result = await add(lotId, field, body, parentId);
      setMessage(result.ok ? null : result.message);
      if (result.ok) {
        setDraft("");
        setReplyTo(null);
      }
    });
  };

  const settle = (id: string, next: boolean): void => {
    startTransition(async () => {
      const result = await resolve(id, next);
      setMessage(result.ok ? null : result.message);
    });
  };

  return (
    <section className="flex min-h-0 flex-col" aria-label="Comments on this catalogue">
      <div className="flex items-center gap-2 border-b border-rule px-3 py-2">
        <h2 className="text-[13px] font-medium">
          Comments{" "}
          <span className="text-[10px] text-faint" data-numeric>
            {open.length}
          </span>
        </h2>
        {/* SETTLED THREADS ARE HIDDEN, NOT GONE. The argument is the record;
            what a reviewer wants on screen is what is still open. */}
        {settled.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSettled((v) => !v)}
            className={`${TAP} ml-auto inline-flex items-center px-2 text-[12px] text-muted hover:text-ink`}
          >
            {showSettled ? "Hide" : "Show"} {settled.length} settled
          </button>
        )}
      </div>

      {message && (
        <p role="alert" className="border-l-2 border-seal bg-sealSoft px-3 py-1.5 text-[12px] text-ink">
          {message}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-[12px] leading-relaxed text-muted">
            {/* SAYS WHAT TO DO, not that there is nothing. An empty panel that
                only says "no comments" is a screen a person leaves. */}
            Nothing yet. Point at a caption or a plate on the page and press
            the comment mark to start one.
          </p>
        ) : (
          <ol className="m-0 list-none p-0">
            {shown.map((thread) => (
              <li
                key={thread.id}
                data-thread={thread.id}
                className={`border-b border-rule px-3 py-2 ${
                  thread.resolvedAt ? "bg-field" : ""
                }`}
              >
                <p className="text-[10px] text-faint">
                  {/* WHAT IT IS ABOUT, which is the whole value of keying a
                      remark to (lot, field) rather than to a place on a page:
                      this line is still true at every density. */}
                  {thread.ref ?? "untitled lot"}
                  {thread.field ? ` · ${thread.field}` : " · the lot"}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed">{thread.body}</p>
                <p className="mt-0.5 text-[10px] text-faint">{who(thread.author)}</p>

                {thread.replies.map((reply) => (
                  <div key={reply.id} className="mt-1.5 border-l-2 border-rule pl-2">
                    <p className="text-[13px] leading-relaxed">{reply.body}</p>
                    <p className="text-[10px] text-faint">{who(reply.author)}</p>
                  </div>
                ))}

                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {thread.resolvedAt ? (
                    <>
                      <span className="text-[10px] text-go">
                        Settled{thread.resolvedBy ? ` by ${who(thread.resolvedBy)}` : ""}
                      </span>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => settle(thread.id, false)}
                        className={`${TAP} ml-auto inline-flex items-center px-2 text-[12px] text-muted hover:text-ink`}
                      >
                        Reopen
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setReplyTo(replyTo === thread.id ? null : thread.id);
                          setDraft("");
                        }}
                        className={`${TAP} inline-flex items-center px-2 text-[12px] text-muted hover:text-ink`}
                      >
                        Reply
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => settle(thread.id, true)}
                        className={`${TAP} ml-auto inline-flex items-center px-2 text-[12px] text-muted hover:text-ink`}
                      >
                        Settle
                      </button>
                    </>
                  )}
                </div>

                {replyTo === thread.id && (
                  <div className="mt-1.5">
                    <label className="sr-only" htmlFor={`reply-${thread.id}`}>
                      Reply to this comment
                    </label>
                    <textarea
                      id={`reply-${thread.id}`}
                      rows={2}
                      maxLength={MAX_COMMENT}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      // Two rows is already well over the floor; the rule is that a
                      // control CARRIES it, not that it happens to be tall today.
                      className={`${TAP} w-full border border-rule bg-paper p-2 text-[13px]`}
                    />
                    <button
                      type="button"
                      disabled={pending || draft.trim() === ""}
                      onClick={() => send(thread.lotId, null, thread.id)}
                      className={`${TAP} mt-1 inline-flex items-center bg-seal px-3 text-[12px] font-medium text-white hover:bg-sealPress disabled:opacity-60`}
                    >
                      {/* "Send reply" AND NOT "Reply", which is what the
                          control that OPENS this box says. Two buttons with
                          one name inside one thread is ambiguous to a screen
                          reader and to a person scanning for the one that
                          posts — and it was ambiguous to the driven test
                          first, which is how it was noticed. */}
                      Send reply
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── STARTING ONE, WHICH NEEDS A SUBJECT ────────────────────────────
          A remark about nothing is a remark nobody can act on, so the box is
          only offered once something on the page is selected — and the
          sentence says how to select one rather than leaving somebody to
          guess why the box is missing. */}
      <div className="border-t border-rule px-3 py-2">
        {subject ? (
          <>
            <label className="text-[10px] text-faint" htmlFor="new-comment">
              On {subject.ref ?? "this lot"}
              {subject.field ? ` · ${subject.field}` : " · the lot"}
            </label>
            <textarea
              id="new-comment"
              rows={2}
              maxLength={MAX_COMMENT}
              value={replyTo === null ? draft : ""}
              onFocus={() => setReplyTo(null)}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What is wrong with this?"
              className={`${TAP} mt-1 w-full border border-rule bg-paper p-2 text-[13px]`}
            />
            <button
              type="button"
              disabled={pending || draft.trim() === "" || replyTo !== null}
              onClick={() => send(subject.lotId, subject.field, null)}
              className={`${TAP} mt-1 inline-flex w-full items-center justify-center bg-seal px-3 text-[12px] font-medium text-white hover:bg-sealPress disabled:opacity-60`}
            >
              Comment
            </button>
          </>
        ) : (
          <p className="text-[12px] leading-relaxed text-muted">
            Point at a caption or a plate on the page to comment on it.
          </p>
        )}
      </div>
    </section>
  );
}
