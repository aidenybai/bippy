#!/usr/bin/env bash
# Points a Linkwarden clone at the corpus PostgreSQL container and applies its migrations.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cat > .env <<EOF
NEXTAUTH_URL=http://localhost:3000/api/v1/auth
NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789
DATABASE_URL=postgresql://postgres:postgres@localhost:5451/linkwarden
STORAGE_FOLDER=data
NEXT_PUBLIC_CREDENTIALS_ENABLED=true
DISABLE_PRESERVATION=true
EOF

yarn prisma:generate
yarn prisma:deploy
