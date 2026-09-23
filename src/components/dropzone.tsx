"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { UploadResult } from "@/app/api/assets/route";

/**
 * Photographs in, by dropping them anywhere.
 *
 * ── THE WHOLE WINDOW IS THE TARGET ──────────────────────────────────────────
 *
 * Not a dotted rectangle someone has to aim at. A cataloguer coming from a
 * shared drive drags a folder at the screen, and making them find a box first
 * is the step that sends them back to the shared drive. The listeners are on the
 * window; the overlay only appears once something is actually being dragged, so
 * it costs nothing the rest of the time.
 *
 * ── A DROPPED FOLDER IS A FOLDER ────────────────────────────────────────────
 *
 * `DataTransfer.files` is empty for a directory drop, which is why so many
 * uploaders silently do nothing when you drop one — the worst possible response,
 * because it looks like the page is broken rather than like the feature is
 * missing. The entries API is walked instead, so a shoot folder works.
 *
 * ── IT UPLOADS IN BATCHES ───────────────────────────────────────────────────
 *
 * Four hundred files in one request is one timeout away from losing all four
 * hundred, and gives no progress while it runs. Batches land as they complete,
 * so an interrupted upload keeps what it already stored — the content-addressed
 * store means resuming costs nothing but re-sending the bytes.
 */

const BATCH_FILES = 12;
const BATCH_BYTES = 40 * 1024 * 1024;

interface Progress {
  done: number;
  total: number;
  results: UploadResult[];
}

async function filesFromDataTransfer(data: DataTransfer): Promise<File[]> {
  const items = Array.from(data.items ?? []);
  const entries = items
    .map((item) =>
      "webkitGetAsEntry" in item
        ? (item as DataTransferItem & {
            webkitGetAsEntry(): FileSystemEntry | null;
          }).webkitGetAsEntry()
        : null,
    )
    .filter((e): e is FileSystemEntry => e !== null);

  if (entries.length === 0) return Array.from(data.files ?? []);

  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) =>
        (entry as FileSystemFileEntry).file(resolve, () => resolve(null)),
      );
      if (file) files.push(file);
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most 100 at a time and must be called until it
    // returns none — reading once silently truncates a big shoot folder to its
    // first hundred files, which is the kind of loss nobody notices for weeks.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve) =>
        reader.readEntries(resolve, () => resolve([])),
      );
      if (batch.length === 0) break;
      for (const child of batch) await walk(child);
    }
  };

  for (const entry of entries) await walk(entry);
  return files;
}

export function Dropzone({
  lotId,
  children,
  label,
}: {
  /** When present, everything dropped attaches to this lot as well as landing in the library. */
  lotId?: string;
  children?: React.ReactNode;
  label?: string;
}): React.ReactElement {
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const depth = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      setProgress({ done: 0, total: files.length, results: [] });

      const batches: File[][] = [];
      let current: File[] = [];
      let bytes = 0;
      for (const file of files) {
        if (
          current.length >= BATCH_FILES ||
          (bytes > 0 && bytes + file.size > BATCH_BYTES)
        ) {
          batches.push(current);
          current = [];
          bytes = 0;
        }
        current.push(file);
        bytes += file.size;
      }
      if (current.length > 0) batches.push(current);

      const all: UploadResult[] = [];
      let done = 0;
      for (const batch of batches) {
        const body = new FormData();
        for (const file of batch) body.append("files", file);
        if (lotId) body.append("lotId", lotId);
        try {
          const response = await fetch("/api/assets", { method: "POST", body });
          const json = (await response.json()) as { results?: UploadResult[]; error?: string };
          if (json.results) all.push(...json.results);
          else
            all.push(
              ...batch.map((f) => ({
                filename: f.name,
                ok: false,
                reason: json.error ?? "The server refused the batch.",
              })),
            );
        } catch {
          all.push(
            ...batch.map((f) => ({
              filename: f.name,
              ok: false,
              reason: "The upload did not reach the server.",
            })),
          );
        }
        done += batch.length;
        setProgress({ done, total: files.length, results: [...all] });
      }

      router.refresh();
      // The summary stays until dismissed when anything failed; a clean run
      // clears itself, because a person who saw twelve thumbnails appear does
      // not need to be told twelve files arrived.
      if (all.every((r) => r.ok)) {
        setTimeout(() => setProgress(null), 2500);
      }
    },
    [lotId, router],
  );

  useEffect(() => {
    const onEnter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (): void => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onDrop = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      // Without this the browser NAVIGATES to the dropped file and the page the
      // person was working on is gone.
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      void filesFromDataTransfer(e.dataTransfer).then(upload);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [upload]);

  const failures = progress?.results.filter((r) => !r.ok) ?? [];
  const stored = progress?.results.filter((r) => r.ok).length ?? 0;
  const duplicates = progress?.results.filter((r) => r.ok && r.duplicate).length ?? 0;

  return (
    <>
      {/* The button sits ABOVE the contents, where a person looks for the action
          before they have anything to look at. Below a grid of four hundred
          thumbnails it is not an action, it is a footnote. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex min-h-[var(--tap)] items-center border border-ruleStrong bg-paper px-3 text-[13px] font-medium hover:bg-sunk"
        >
          {label ?? "Add photographs"}
        </button>
        <p className="text-[12px] text-muted">
          or drop files — or a whole folder — anywhere on this page
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,.tif,.tiff"
          className="hidden"
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      {children}

      {progress && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 w-80 border border-rule bg-paper p-3 shadow-lg"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-medium">
              {progress.done < progress.total
                ? `Uploading ${progress.done} of ${progress.total}`
                : `${stored} of ${progress.total} stored`}
            </p>
            <button
              type="button"
              onClick={() => setProgress(null)}
              className="text-[12px] text-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
          <div className="mt-2 h-1 w-full bg-sunk">
            <div
              className="h-1 bg-seal transition-[width]"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          {duplicates > 0 && (
            <p className="mt-2 text-[12px] text-muted">
              {duplicates} were already held — the same file twice is one
              photograph.
            </p>
          )}
          {failures.length > 0 && (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
              {failures.map((f) => (
                <li key={f.filename} className="text-[12px] text-seal">
                  <span className="font-medium">{f.filename}</span> — {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink/10">
          <div className="border-2 border-dashed border-seal bg-paper px-8 py-6 text-center shadow-lg">
            <p className="text-[15px] font-medium">Drop to add photographs</p>
            <p className="mt-1 text-[13px] text-muted">
              {lotId
                ? "They attach to this lot and stay in the library."
                : "They land in the library. Assign them to lots whenever you like."}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
