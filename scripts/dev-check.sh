#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public"
export NODE_ENV=test

# @deployhaven/db now ships compiled dist (main -> dist/index.js). The api and
# db test suites import @deployhaven/db, so it must be generated + built first so
# both the compiled production path AND the in-process test path resolve it.
pnpm --filter @deployhaven/db db:generate
pnpm --filter @deployhaven/db build

pnpm --filter @deployhaven/db test
pnpm --filter @deployhaven/api test
echo "dev-check: OK"
