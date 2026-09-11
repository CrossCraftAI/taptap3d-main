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
ENV HOSTNAME=0.0.0.0

# Not root. The application never needs to write to its own image, and a
# container that could is one exploit away from rewriting itself.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

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
COPY --from=builder --chown=nextjs:nodejs /app/docker/entrypoint.sh ./entrypoint.sh
# Set here rather than relied upon from git: the repository is developed on
# Windows, which does not carry the executable bit, so an entrypoint that works
# locally would fail to start in the image with "permission denied".
RUN chmod +x /app/entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
