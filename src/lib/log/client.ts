// Counting a gesture, from the browser.
//
// The session is one TAB for as long as it is open — `sessionStorage`, not
// `localStorage` — because that is what "one sitting" means to the measurement
// ROADMAP D9 will run: a specialist opens a catalogue, works it, closes it. Two
// tabs are two sittings; a reload is the same one. The sequence number is
// monotonic within the session and allocated here, because the server sees
// gestures arrive out of order the moment two are in flight at once.
//
// FIRE AND FORGET. Nothing waits on this and nothing shows an error from it: the
// instrument must never become a reason the product feels slow, and a gesture
// that was not counted is a hole in a graph, not a failure of the work. Storage
// can throw (a private window, a locked-down browser); then the session lives
// for one page and the count still lands.

const SESSION_KEY = "taptap3d.session";
const SEQ_KEY = "taptap3d.seq";

let volatileSession: string | null = null;
let volatileSeq = 0;

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Said above: a browser that refuses storage still gets a count for the
    // life of this page.
  }
}

function sessionId(): string {
  const stored = read(SESSION_KEY);
  if (stored) return stored;
  volatileSession ??= crypto.randomUUID();
  write(SESSION_KEY, volatileSession);
  return volatileSession;
}

function nextSeq(): number {
  const stored = Number(read(SEQ_KEY));
  const next = (Number.isFinite(stored) && stored > volatileSeq ? stored : volatileSeq) + 1;
  volatileSeq = next;
  write(SEQ_KEY, String(next));
  return next;
}

/**
 * Count one gesture. Names are dotted — `lot.fields.save`, `catalogue.pin` — so
 * the analysis can group by prefix.
 */
export function logAction(
  action: string,
  payload: Record<string, unknown> = {},
  catalogueId: string | null = null,
): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({
    sessionId: sessionId(),
    actions: [
      {
        seq: nextSeq(),
        action,
        payload,
        catalogueId,
        occurredAt: new Date().toISOString(),
      },
    ],
  });
  try {
    void fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // The gesture that leaves the page — a save that navigates — is the one a
      // plain fetch drops.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nothing to do; see the header.
  }
}
