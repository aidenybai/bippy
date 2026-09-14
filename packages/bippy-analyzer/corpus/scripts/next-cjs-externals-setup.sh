#!/usr/bin/env bash
# Makes a Next 14 pages-router dev server load server externals through
# require(): pnpm-hoisted @mui/* packages expose directory subpaths such as
# @mui/utils/formatMuiErrorMessage that Node's ESM resolver rejects, so SSR of
# every page 500s with ERR_UNSUPPORTED_DIR_IMPORT unless esmExternals is off.
set -euo pipefail

config_path="${1:-next.config.js}"

if ! grep -q "esmExternals" "$config_path"; then
  sed -i "0,/  reactStrictMode: true,/s//  reactStrictMode: true,\n  experimental: { esmExternals: false },/" "$config_path"
fi

grep -q "esmExternals: false" "$config_path"
