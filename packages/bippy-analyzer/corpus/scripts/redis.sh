#!/usr/bin/env bash
# Starts (or reuses) a throwaway Redis-compatible container.
# Usage: redis.sh <container-name> <host-port>
set -euo pipefail

name="$1"
port="$2"

if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" -p "$port:6379" valkey/valkey:7.2-alpine >/dev/null
  fi
fi
