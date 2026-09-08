#!/usr/bin/env bash
# Points a karakeep clone at a local SQLite data directory and runs its migrations.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
data_dir="$PWD/.bippy-data"
mkdir -p "$data_dir"

cat > .env <<EOF
DATA_DIR=$data_dir
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789
DISABLE_SIGNUPS=false
EOF
ln -sf ../../.env apps/web/.env

set -a
# shellcheck disable=SC1091
source .env
set +a
pnpm db:migrate
