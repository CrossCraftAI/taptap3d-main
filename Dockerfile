# Multi-stage, producing an image that carries the application and nothing that
# built it.
#
# NO CHROMIUM AND NO FONTS YET. The predecessor's image carried both because its
# deliverable was a PDF rendered by a headless browser. Nothing here renders yet,
# so nothing here needs them — they arrive with the renderer, in the commit that
# needs them, rather than being carried speculatively at ~400 MB.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `install`: the lockfile is the build's input, and a build
# that can silently resolve a different tree is not reproducible.
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# `::`, NOT 0.0.0.0. Fly's private network is IPv6 only, so an IPv4 bind is
# reachable through the public proxy and by nothing inside the organisation —
# which is exactly why the predecessor could not be read app-to-app during the
# migration and needed a temporary server standing in for it. Node's dual-stack
# `::` accepts IPv4 as well, so this costs nothing and prevents a repeat.
ENV HOSTNAME=::

# Not root — but the drop happens in the ENTRYPOINT, not here.
#
# The application never needs to write to its own image, and a container that
# could is one exploit away from rewriting itself. `USER nextjs` was how this
# said so, and it was not enough: Fly mounts the volume over /data at boot, so
# whatever ownership the image gave that path is replaced by the volume's own,
# and an unprivileged process cannot fix it. The entrypoint starts as root,
# corrects the mount, and drops before serving a single request.
#
# `-G nodejs` matters and was missing: without it the user's primary group is
# `nogroup`, so a chown to nextjs:nodejs leaves the process outside the group it
# was given.
RUN apk add --no-cache su-exec  && addgroup -g 1001 -S nodejs  && adduser -S nextjs -u 1001 -G nodejs

# `output: "standalone"` in next.config.ts traces exactly the dependencies the
# server imports, so node_modules is not copied wholesale.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The migrations and the runner that applies them. drizzle-kit is a DEV
# dependency and is deliberately not in this image; the migrator used here lives
# in drizzle-orm, which the application already depends on at runtime, so the
# standalone trace has it.
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate.mjs ./migrate.mjs
# The one-off that brings the predecessor across. It ships in the image rather
# than being run from a laptop: it needs both production databases and 71 MB of
# photographs, and a laptop run means materialising both credentials locally and
# pulling every plate down and back up again. See docker/migrate-from-tap3d.mjs.
COPY --from=builder --chown=nextjs:nodejs /app/docker/migrate-from-tap3d.mjs ./migrate-from-tap3d.mjs
# Creating the first organisation of a deployment. Not signup (ROADMAP D15) — the
# one-off an operator runs once, because currentOrgId() refuses to invent a
# tenant and is right to.
COPY --from=builder --chown=nextjs:nodejs /app/docker/seed-org.mjs ./seed-org.mjs
COPY --from=builder --chown=nextjs:nodejs /app/docker/entrypoint.sh ./entrypoint.sh
# Set here rather than relied upon from git: the repository is developed on
# Windows, which does not carry the executable bit, so an entrypoint that works
# locally would fail to start in the image with "permission denied".
RUN chmod +x /app/entrypoint.sh

# Created so a container run WITHOUT a volume still has somewhere to put an
# upload. With a volume this is shadowed at boot, which is what the entrypoint
# exists to deal with.
RUN mkdir -p /data/assets && chown -R nextjs:nodejs /data

# NO `USER` HERE. See the entrypoint: it drops to nextjs after fixing the mount,
# and the server process is unprivileged from its first instruction.
EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
