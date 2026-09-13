#!/usr/bin/env bash
# Points a Formbricks clone at the corpus PostgreSQL + Valkey containers, builds the
# workspace packages `apps/web` depends on and applies the Prisma migrations.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cp .env.example .env
sed -i \
  -e "s#^DATABASE_URL=.*#DATABASE_URL='postgresql://postgres:postgres@localhost:5452/formbricks?schema=public'#" \
  -e "s#^REDIS_URL=.*#REDIS_URL=redis://localhost:6380#" \
  -e "s#^ENCRYPTION_KEY=.*#ENCRYPTION_KEY=0123456789abcdef0123456789abcdef#" \
  -e "s#^NEXTAUTH_SECRET=.*#NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789#" \
  -e "s#^CRON_SECRET=.*#CRON_SECRET=bippy-parser-local-cron-secret-0123456789#" \
  .env
echo "TELEMETRY_DISABLED=1" >> .env
ln -sf ../../.env apps/web/.env

pnpm turbo run build \
  --filter=@formbricks/ai \
  --filter=@formbricks/cache \
  --filter=@formbricks/database \
  --filter=@formbricks/logger \
  --filter=@formbricks/storage
pnpm --filter @formbricks/database db:migrate:dev
