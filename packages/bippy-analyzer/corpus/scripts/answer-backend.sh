#!/usr/bin/env bash
# Idempotently runs the Apache Answer Go backend (apache/answer image built from the
# pinned revision) with an auto-installed SQLite site for the UI's dev-server proxy.
# usage: answer-backend.sh <container-name> <host-port> <image>
set -euo pipefail

name="$1"
port="$2"
image="$3"

if ! docker ps --format '{{.Names}}' | grep -qx "$name"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" \
      -e AUTO_INSTALL=true \
      -e DB_TYPE=sqlite3 \
      -e DB_FILE=/data/answer.db \
      -e LANGUAGE=en_US \
      -e SITE_NAME="Bippy Corpus" \
      -e SITE_URL="http://localhost:$port" \
      -e CONTACT_EMAIL=admin@example.com \
      -e ADMIN_NAME=admin \
      -e ADMIN_PASSWORD=answer-corpus-1 \
      -e ADMIN_EMAIL=admin@example.com \
      -e EXTERNAL_CONTENT_DISPLAY=always_display \
      -p "$port:80" \
      "$image" >/dev/null
  fi
fi

for _ in $(seq 1 120); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/answer/api/v1/siteinfo")" = "200" ]; then
    exit 0
  fi
  sleep 1
done

echo "answer container $name did not become ready" >&2
exit 1
