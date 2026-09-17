#!/usr/bin/env bash
# Runs PostHog's frontend Vite dev server alongside the stand-in app server.
# Run from the clone root after install.
set -euo pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

(cd frontend && bash "$scripts/with-node.sh" 24 pnpm exec vite --host 0.0.0.0) &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT

bash "$scripts/with-node.sh" 24 node --experimental-strip-types "$scripts/posthog-app-server.ts"
