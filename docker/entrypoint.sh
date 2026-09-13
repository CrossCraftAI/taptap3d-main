#!/bin/sh
# Three steps, and the first one is the reason this file is not two lines.
#
# ── THE VOLUME IS MOUNTED OVER THE IMAGE, SO THE IMAGE CANNOT OWN IT ─────────
#
# The Dockerfile creates /data/assets and gives it to the runtime user. At boot
# Fly mounts the volume over /data and that work disappears: what the process
# sees is the volume's own tree, with the volume's own ownership. Anything
# already inside it — the predecessor's 66 plates, written by a migration run as
# root over ssh — stays owned by root, and a non-root server cannot create a file
# in a root-owned directory.
#
# The symptom is the worst kind: the application boots, passes its health check,
# serves every page, and silently fails only when someone uploads a photograph.
# It was found by driving the deployed site, not by any test.
#
# So the container starts as root, fixes what it owns, and drops privileges
# before it serves anything. `USER nextjs` in the Dockerfile could not do this,
# because by the time that user exists the volume is not there yet.
set -e

APP_UID=1001
APP_GID=1001
ASSET_ROOT="${TAPTAP3D_ASSET_ROOT:-/data/assets}"
# EXPORTED, so the application and this script cannot disagree about where the
# photographs go. They did: the entrypoint defaulted to /data/assets and the
# store defaulted to <cwd>/.data/assets, which inside the image is /app/.data —
# a path the runtime user is deliberately unable to write. A deployment that
# forgot the variable therefore booted, passed its health check, and failed only
# on the first upload, with EACCES naming a directory nobody had configured.
export TAPTAP3D_ASSET_ROOT="$ASSET_ROOT"

echo "boot: taptap3d starting"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$ASSET_ROOT"
  chown "$APP_UID:$APP_GID" /data "$ASSET_ROOT" 2>/dev/null || true
  # ONLY WHAT IS WRONG. A recursive chown of the whole volume is a boot that gets
  # slower every month; this touches the files that are not already the runtime
  # user's and nothing else, so a volume that is already correct costs one walk
  # and no writes.
  find "$ASSET_ROOT" ! -user "$APP_UID" -exec chown "$APP_UID:$APP_GID" {} + 2>/dev/null || true
  echo "boot: asset root $ASSET_ROOT owned by $APP_UID"
  AS_APP="su-exec $APP_UID:$APP_GID"

  # SAID AT BOOT, NOT AT THE FIRST UPLOAD. Storage being unwritable does not
  # justify refusing to serve the catalogue, the importer or the editor — so this
  # warns rather than exits, but it warns where someone is looking.
  if ! $AS_APP sh -c "touch '$ASSET_ROOT/.writable' && rm -f '$ASSET_ROOT/.writable'" 2>/dev/null; then
    echo "boot: WARNING — $ASSET_ROOT is not writable by uid $APP_UID."
    echo "boot: uploads will fail. Check the volume mount and TAPTAP3D_ASSET_ROOT."
  fi
else
  # Already unprivileged — a local `docker run --user`, or a platform that
  # started us as somebody. Nothing to fix and nothing to drop.
  AS_APP=""
fi

# Migrations run before the server starts, and a failure is FATAL: a container
# serving requests against a schema it does not match produces a hundred
# confusing errors downstream, none of which name the cause.
$AS_APP node /app/migrate.mjs

echo "boot: starting server on ${HOSTNAME:-::}:${PORT:-3000}"
exec $AS_APP node /app/server.js
