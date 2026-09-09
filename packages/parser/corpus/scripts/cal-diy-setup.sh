#!/usr/bin/env bash
# Points a cal.diy clone at the corpus PostgreSQL container and seeds it.
# Runs after `yarn install` from any directory inside the clone.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

database_url="postgresql://postgres:postgres@localhost:5450/calendso"

cp .env.example .env
cp .env.appStore.example .env.appStore
sed -i \
  -e "s#^DATABASE_URL=.*#DATABASE_URL=\"$database_url\"#" \
  -e "s#^DATABASE_DIRECT_URL=.*#DATABASE_DIRECT_URL=\"$database_url\"#" \
  -e "s#^NEXTAUTH_SECRET=.*#NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789#" \
  -e "s#^CALENDSO_ENCRYPTION_KEY=.*#CALENDSO_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef#" \
  -e "s#^CALCOM_TELEMETRY_DISABLED=.*#CALCOM_TELEMETRY_DISABLED=1#" \
  .env

yarn workspace @calcom/prisma db-deploy
yarn workspace @calcom/prisma db-seed
