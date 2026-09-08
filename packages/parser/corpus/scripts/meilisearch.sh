#!/usr/bin/env bash
# Idempotently runs a throwaway Meilisearch container (no master key) for a corpus app.
# usage: meilisearch.sh <container-name> <host-port>
set -euo pipefail

name="$1"
port="$2"

if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" \
      -e MEILI_ENV=development \
      -e MEILI_NO_ANALYTICS=true \
      -p "$port:7700" \
      getmeili/meilisearch:v1.13 >/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if curl -fsS "http://localhost:$port/health" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "meilisearch container $name did not become ready" >&2
exit 1
