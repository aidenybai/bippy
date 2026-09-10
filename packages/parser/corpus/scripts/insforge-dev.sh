#!/usr/bin/env bash
# Runs the InsForge dashboard host app's Vite dev server alongside the stand-in
# API server its /api proxy targets. Run from the clone root after install.
# Usage: insforge-dev.sh <vite-port> <api-port>
set -euo pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vite_port="$1"
api_port="$2"

INSFORGE_API_PORT="$api_port" node --experimental-strip-types "$scripts/insforge-api-server.ts" &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT

cd frontend && VITE_API_BASE_URL="http://localhost:$api_port" npx vite --port "$vite_port" --strictPort
