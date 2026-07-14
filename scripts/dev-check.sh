#!/usr/bin/env bash
set -euo pipefail
export DATABASE_URL="postgresql://deployhaven:deployhaven@localhost:5432/deployhaven?schema=public"
export NODE_ENV=test
pnpm --filter @deployhaven/db test
pnpm --filter @deployhaven/api test
echo "dev-check: OK"
