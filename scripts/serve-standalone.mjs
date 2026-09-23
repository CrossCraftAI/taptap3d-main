// Run the server the image runs, not the one `next start` runs.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
// next.config.ts sets `output: "standalone"` because the deployment target is a
// container. Next then prints, on every `next start`:
//
//   ⚠ "next start" does not work with "output: standalone" configuration.
//     Use "node .next/standalone/server.js" instead.
//
// The e2e suite started the app with `next start` anyway, and the warning
// scrolled past on every run. It worked — which is the problem. What was being
// measured was not what deploys: a different server, a different module
// resolution (the standalone trace has its own node_modules), and a different
// answer the day the two diverge. A suite that tests a near-neighbour of the
// artefact is a suite that can be green while the artefact is broken, and this
// repository has already paid once for measuring the wrong tree — see the note
// on `webServer` in playwright.config.ts.
//
// So this reproduces what docker/entrypoint.sh does, minus the parts that are
// about being root in a container:
//
//   Dockerfile:72   COPY .next/standalone            ./
//   Dockerfile:73   COPY .next/static                ./.next/static
//   entrypoint.sh   exec node /app/server.js
//
// ── THE STATIC COPY IS NOT OPTIONAL ──────────────────────────────────────────
//
// `.next/standalone` deliberately omits `.next/static`; Next documents that the
// caller copies it, and the Dockerfile does. Without it the server boots, the
// HTML renders, every stylesheet and client chunk 404s, and the page is naked
// markup — which is exactly the failure the inspection loop's own notes warn is
// invisible to every assertion and visible only in a screenshot. Copying it
// here means a local run cannot differ from the image in the one way that would
// be hardest to notice.
//
// Rejected: a symlink instead of a copy. It needs a privilege on Windows that
// an ordinary developer account does not have, and this has to work on the
// machine the suite is actually run from.
//
// Rejected: doing this in a shell one-liner in package.json. `cp -r` is not a
// command on Windows and `robocopy` is not one anywhere else; the copy is four
// lines of node and node is already a dependency.

import { cpSync, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const STANDALONE = join(ROOT, ".next", "standalone");
const SERVER = join(STANDALONE, "server.js");

if (!existsSync(SERVER)) {
  console.error(
    "serve-standalone: .next/standalone/server.js is missing — run `npm run build` first.",
  );
  process.exit(1);
}

// Replaced rather than merged: a stale chunk from an earlier build served
// beside a fresh one is the same class of fault as a stale build, and harder
// to see because most of the page is right.
const staticSrc = join(ROOT, ".next", "static");
const staticDst = join(STANDALONE, ".next", "static");
rmSync(staticDst, { recursive: true, force: true });
cpSync(staticSrc, staticDst, { recursive: true });

// `public/` does not exist in this repository today. Copied when it does,
// because the Dockerfile will have to, and a script that silently stops being
// equivalent to the image is worse than one that never was.
const publicSrc = join(ROOT, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(STANDALONE, "public"), { recursive: true });
}

// 127.0.0.1 by default, NOT the image's `::`. Fly's private network is IPv6
// only and the Dockerfile sets HOSTNAME=:: for that reason; a test harness
// connects to 127.0.0.1, and on a machine where the two do not resolve to the
// same socket the run fails with a connection refused that says nothing about
// why. The environment still wins, so a container can set its own.
const env = {
  ...process.env,
  HOSTNAME: process.env.HOSTNAME ?? "127.0.0.1",
  PORT: process.env.PORT ?? "3000",
};

const child = spawn(process.execPath, [SERVER], { env, stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
