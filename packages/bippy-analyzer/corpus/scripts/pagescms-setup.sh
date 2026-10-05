#!/usr/bin/env bash
# Points a pagescms clone at the corpus PostgreSQL container with placeholder
# GitHub App credentials (the sign-in page only renders the provider buttons)
# and applies its Drizzle migrations. Run from the clone root after `npm install`.
set -euo pipefail

cat > .env.local <<'ENV'
BASE_URL=http://localhost:3000
BETTER_AUTH_SECRET=bippy-parser-local-better-auth-secret-0123456789
CRYPTO_KEY=bippy-parser-local-crypto-key-0123456789abcdef
GITHUB_APP_ID=1
GITHUB_APP_NAME=bippy-corpus-placeholder
GITHUB_APP_PRIVATE_KEY=placeholder
GITHUB_APP_WEBHOOK_SECRET=placeholder
GITHUB_APP_CLIENT_ID=placeholder
GITHUB_APP_CLIENT_SECRET=placeholder
EMAIL_FROM=Pages CMS <no-reply@localhost>
DATABASE_URL=postgresql://postgres:postgres@localhost:5454/pagescms
ENV

npm run db:migrate
