#!/usr/bin/env bash
# Idempotently runs a throwaway MongoDB container for a corpus app.
# usage: mongo.sh <container-name> <host-port> [image]
set -euo pipefail

name="$1"
port="$2"
image="${3:-mongo:6}"

if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" -p "$port:27017" "$image" >/dev/null
  fi
fi

for _ in $(seq 1 60); do
  if docker exec "$name" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

echo "mongo container $name did not become ready" >&2
exit 1
