#!/usr/bin/env bash
# Idempotently runs a throwaway PostgreSQL container for a corpus app.
# usage: postgres.sh <container-name> <host-port> <database>
set -euo pipefail

name="$1"
port="$2"
database="$3"

if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB="$database" \
      -p "$port:5432" \
      postgres:16-alpine >/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres -d "$database" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "postgres container $name did not become ready" >&2
exit 1
