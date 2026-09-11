#!/bin/sh
# Two steps, and the first one is allowed to stop the boot.
#
# Migrations run before the server starts, and a failure is FATAL: a container
# serving requests against a schema it does not match produces a hundred
# confusing errors downstream, none of which name the cause.
set -e

echo "boot: taptap3d starting"
node /app/migrate.mjs
echo "boot: starting server on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node /app/server.js
