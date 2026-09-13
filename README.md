# taptap3d

A physical business's inventory record produces **both** the printed catalogue
page and the online listing, from one source of truth. Auction houses first.

The three documents below were settled before the first line was written, and
they are the spine everything else is held to.

| Document | Question it answers |
|---|---|
| [`DFD.md`](DFD.md) | What the system is for — the operational cycle, which boxes we own, what data crosses which boundary |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | How it may be built — the rules, their rejected alternatives, and the lessons carried from the predecessor |
| [`ROADMAP.md`](ROADMAP.md) | What ships, what waits and why, and what never comes |

## Relationship to `tap3d`

`tap3d` is the predecessor: a working auction-catalogue layout and print engine.
It is archived and private. It is not a dependency, it is not imported, and its
history was deliberately not carried here — this repository starts clean.

It remains the reference implementation while this one is built. To read it
alongside, without it entering this history:

```sh
git -C ../tap3d worktree add ../tap3d-ref
```

What travels from it is knowledge, not code: the renderer's approach, the editor's
interaction layer, and the lessons distilled in `ARCHITECTURE.md`. What does not
travel is roughly half of its source tree — two renderers, two ingestion stacks,
and an orphaned research surface that no route reached.

## Deployment

`main` deploys to <https://taptap3d.fly.dev> when CI is green — migrations run at
boot, before the server accepts a request (`docker/entrypoint.sh`).

The whole application sits behind a shared Basic-auth secret (`src/proxy.ts`,
`GATE_USER`/`GATE_PASSWORD`). That is the M0 access gate, not authentication: it
exists so a public URL is not a public database until the identity system lands
(ROADMAP D14). `/api/health` is exempt on purpose, so the platform can tell
whether the app is alive without holding a credential.

Leave `GATE_PASSWORD` empty locally and the gate disappears.

## Status

M0 complete. M1 — the pitch — is next; see [`ROADMAP.md`](ROADMAP.md).
