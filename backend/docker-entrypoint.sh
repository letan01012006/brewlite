#!/bin/sh
set -eu

if [ -n "${DATABASE_HOST:-}" ]; then
  export DATABASE_URL="$(node -e 'const url = new URL(process.env.DATABASE_URL); url.hostname = process.env.DATABASE_HOST; url.port = process.env.DATABASE_PORT || "5432"; process.stdout.write(url.toString());')"
fi

# Compose waits for PostgreSQL health; failed migrations prevent server startup.
./node_modules/.bin/prisma migrate deploy
exec "$@"
