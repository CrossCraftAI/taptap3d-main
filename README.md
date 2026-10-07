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

With Google OAuth configured, the application uses database-backed sessions
and organisation memberships. Users with several memberships choose their
house; every request checks the selection against their memberships again.
`TAPTAP3D_ORG_SLUG`, when set, restricts the deployment to one house and never
bypasses authentication or membership checks.

Without Google OAuth, the shared Basic-auth secret (`src/proxy.ts`,
`GATE_USER`/`GATE_PASSWORD`) remains the local/demo access gate. `/api/health`
is exempt so the platform can check whether the app is alive.

Leave `GATE_PASSWORD` empty locally and the gate disappears.

## Status

The catalogue workflow, Google sign-in and house selection are implemented.
Assets use a local filesystem by default, or a private Cloud Storage bucket
when `TAPTAP3D_GCS_BUCKET` is set. GCP provisioning and data cutover are still
pending; see [`deploy/gcp/README.md`](deploy/gcp/README.md). The optional Fly beta
domain is tracked in [`deploy/fly-beta-domain.md`](deploy/fly-beta-domain.md).
