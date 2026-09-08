#!/usr/bin/env bash
# Points a vercel/chatbot clone at the corpus PostgreSQL container and applies
# its Drizzle migrations. Run from the clone root after `pnpm install`.
set -euo pipefail

cat > .env.local <<'EOF'
AUTH_SECRET=bippy-parser-local-auth-secret-0123456789abcdef
POSTGRES_URL=postgresql://postgres:postgres@localhost:5451/chatbot
EOF

pnpm db:migrate
