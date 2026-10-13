#!/usr/bin/env bash
set -euo pipefail
: "${REPOSITORY:?}" "${REVISION:?}" "${APP_DIR:?}" "${INSTALL:?}"

rm -rf "$APP_DIR"
git init -q "$APP_DIR"
git -C "$APP_DIR" fetch -q --depth 1 "$REPOSITORY" "$REVISION"
git -C "$APP_DIR" checkout -q FETCH_HEAD

if [ -n "${PATCH_FILE:-}" ] && [ -f "$PATCH_FILE" ]; then
  git -C "$APP_DIR" apply --whitespace=nowarn "$PATCH_FILE"
fi

cd "$APP_DIR"
bash -c "$INSTALL"
