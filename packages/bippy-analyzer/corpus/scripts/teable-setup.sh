#!/usr/bin/env bash
# Points a Teable clone at the corpus PostgreSQL container, applies both Prisma
# schemas (meta + data share one database, as Teable's own db-migrate does) and
# builds the workspace packages the NestJS backend bundles.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

export PRISMA_DATABASE_URL="postgresql://postgres:postgres@localhost:5453/teable?schema=public&statement_cache_size=1"

cat > apps/nextjs-app/.env.development.local <<EOF
PRISMA_DATABASE_URL=$PRISMA_DATABASE_URL
PUBLIC_DATABASE_PROXY=127.0.0.1:5453
NEXT_BUILD_ENV_SENTRY_ENABLED=false
EOF

pnpm -F @teable/db-main-prisma prisma-generate
pnpm -F @teable/db-main-prisma prisma-migrate deploy --schema ./prisma/postgres/schema.prisma
pnpm -F @teable/db-data-prisma prisma-generate
pnpm -F @teable/db-data-prisma prisma-migrate deploy --schema ./prisma/schema.prisma
pnpm build:packages
