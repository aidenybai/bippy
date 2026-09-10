#!/usr/bin/env bash
# Starts Plane's own Docker development stack (PostgreSQL, Valkey, RabbitMQ, MinIO,
# Django API + migrator) with the database/cache ports unpublished so they cannot
# collide with the other corpus containers. The API listens on http://localhost:8000.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

[ -f .env ] || cp .env.example .env
if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  sed -i \
    -e 's#^AWS_S3_ENDPOINT_URL=.*#AWS_S3_ENDPOINT_URL="http://plane-minio:9000"#' \
    -e 's#^USE_MINIO=.*#USE_MINIO=1#' \
    apps/api/.env
  echo 'SECRET_KEY="bippy-parser-local-plane-secret-key-0123456789"' >> apps/api/.env
fi
[ -f apps/web/.env ] || cp apps/web/.env.example apps/web/.env

docker compose \
  -f docker-compose-local.yml \
  -f "$BIPPY_CORPUS_SCRIPTS/plane-compose.override.yml" \
  up -d --wait api plane-minio
