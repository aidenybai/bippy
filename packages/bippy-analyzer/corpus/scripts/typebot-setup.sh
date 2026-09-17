#!/usr/bin/env bash
# Points a Typebot clone at the corpus PostgreSQL container and applies its Prisma migrations.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cp .env.dev.example .env
sed -i \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://postgres:postgres@localhost:5454/typebot#" \
  .env

bunx nx migrate:deploy prisma
