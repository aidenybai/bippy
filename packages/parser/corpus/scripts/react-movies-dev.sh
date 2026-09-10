#!/usr/bin/env bash
# Runs the movie app's Vite dev server alongside the stand-in TMDB/Appwrite
# server its patched base URLs target. Run from the clone root after install.
# Usage: react-movies-dev.sh <vite-port> <api-port>
set -euo pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vite_port="$1"
api_port="$2"

REACT_MOVIES_API_PORT="$api_port" node --experimental-strip-types "$scripts/react-movies-api-server.ts" &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT

npx vite --port "$vite_port" --strictPort
