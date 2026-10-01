#!/usr/bin/env bash
# Idempotently starts the rustpad websocket server on :3030, which the Vite dev
# server proxies `/api` to. Run from the clone root after rustpad-setup.sh.
set -euo pipefail

if curl -sf http://127.0.0.1:3030/api/text/bippy-probe >/dev/null 2>&1; then
  exit 0
fi
nohup ./target/release/rustpad-server >rustpad-server.log 2>&1 &
for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3030/api/text/bippy-probe >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done
echo "rustpad-server did not become ready" >&2
exit 1
