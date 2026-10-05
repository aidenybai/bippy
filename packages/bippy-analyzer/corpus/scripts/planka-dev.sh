#!/usr/bin/env bash
# Runs PLANKA's Sails server (:1337) alongside the client's Vite dev server (:3000),
# which proxies /api and /socket.io to it. Run from the clone root.
set -euo pipefail

(cd server && node app.js) &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT

cd client && npx vite --host
