#!/usr/bin/env bash
# Builds the Letterpad workspace packages the admin app imports from `dist/`,
# points the admin app at a local SQLite file and applies its Prisma migrations.
# Run from apps/admin after `bun install --ignore-scripts`.
set -euo pipefail

for package in graphql sdk ui; do
  (cd "../../packages/$package" && bun run build)
done

cp .env.sample .env
mkdir -p data
bun run prisma:generate
bun run prisma:migrate:run
