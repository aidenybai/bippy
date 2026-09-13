#!/usr/bin/env bash
# Fills shadcn/taxonomy's zod-validated environment with placeholder values so
# the marketing page can render; nothing on that page needs a real provider.
# Run from the clone root after `pnpm install`.
set -euo pipefail

cat > .env <<'EOF'
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=bippy-parser-local-nextauth-secret-0123456789
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder
GITHUB_ACCESS_TOKEN=placeholder
DATABASE_URL=mysql://root:root@localhost:3306/taxonomy?schema=public
SMTP_FROM=placeholder@example.com
POSTMARK_API_TOKEN=placeholder
POSTMARK_SIGN_IN_TEMPLATE=placeholder
POSTMARK_ACTIVATION_TEMPLATE=placeholder
STRIPE_API_KEY=placeholder
STRIPE_WEBHOOK_SECRET=placeholder
STRIPE_PRO_MONTHLY_PLAN_ID=placeholder
EOF
