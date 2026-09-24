#!/usr/bin/env bash
# Runs morethan-log's Next dev server alongside the stand-in Notion API that
# `getStaticProps` reads the post database from. Run from the clone root after
# install, with NOTION_PAGE_ID and NOTION_API_PORT set.
set -euo pipefail

scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

node --experimental-strip-types "$scripts/notion-api-server.ts" &
notion_pid=$!
trap 'kill "$notion_pid" 2>/dev/null || true' EXIT

yarn next dev -p 3022
