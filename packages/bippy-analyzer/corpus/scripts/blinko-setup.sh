#!/usr/bin/env bash
# Points a Blinko clone at the corpus PostgreSQL container and applies its Prisma migrations.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cat > .env <<EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5452/blinko
NEXTAUTH_URL=http://localhost:1111
NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789
NEXT_PUBLIC_BASE_URL=http://localhost:1111
EOF

set -a
# shellcheck disable=SC1091
source .env
set +a
bun run prisma:migrate:deploy
