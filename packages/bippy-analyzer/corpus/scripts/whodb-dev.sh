#!/usr/bin/env bash
# Runs WhoDB's Vite frontend alongside the Go API server it proxies `/api` to.
# Usage: whodb-dev.sh <vite-port>; run from the `frontend` directory after install.
set -euo pipefail

port="$1"

ENVIRONMENT=dev ../whodb-server &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

pnpm exec vite --port "$port"
