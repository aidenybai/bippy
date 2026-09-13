#!/usr/bin/env bash
# Points a PLANKA clone's server at the corpus PostgreSQL container and creates the
# schema. Run from the clone root after `npm install` in both `client` and `server`.
set -euo pipefail

cd server
cp .env.sample .env
sed -i \
  -e 's#^DATABASE_URL=.*#DATABASE_URL=postgresql://postgres:postgres@localhost:54331/planka#' \
  .env
npm run db:init
