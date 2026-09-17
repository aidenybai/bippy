#!/usr/bin/env bash
# Writes the Langfuse development `.env`, builds the shared package and applies the
# Prisma migrations against the PostgreSQL container from `docker-compose.dev.yml`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cp .env.dev.example .env
echo "TELEMETRY_ENABLED=false" >> .env

pnpm --filter=shared run db:generate
pnpm --filter=shared run build
pnpm --filter=shared run db:deploy
