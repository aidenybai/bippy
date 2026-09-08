#!/usr/bin/env bash
# Points a Twenty clone at the corpus PostgreSQL + Redis containers, builds the
# server and initialises its database (schema + instance migrations).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cp packages/twenty-front/.env.example packages/twenty-front/.env
cp packages/twenty-server/.env.example packages/twenty-server/.env
sed -i \
  -e "s#^PG_DATABASE_URL=.*#PG_DATABASE_URL=postgres://postgres:postgres@localhost:5455/default#" \
  -e "s#^REDIS_URL=.*#REDIS_URL=redis://localhost:6381#" \
  -e "s#^APP_SECRET=.*#APP_SECRET=bippy-parser-local-app-secret-0123456789#" \
  packages/twenty-server/.env
echo "TELEMETRY_ENABLED=false" >> packages/twenty-server/.env

# HACK: with FORCE_COLOR=0 in the environment nx hands its tasks `NO_COLOR=1 FORCE_COLOR=true`
# and the `generateBarrels` tsx scripts never exit after writing their files.
env -u FORCE_COLOR npx nx run twenty-server:database:init
