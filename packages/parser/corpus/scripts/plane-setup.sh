#!/usr/bin/env bash
# `apps/web/postcss.config.js` re-exports `@plane/tailwind-config/postcss.config.js`, whose
# plugin table names `@tailwindcss/postcss` by string. postcss-load-config resolves plugin
# names from the importing config's directory (`apps/web`), but the plugin is only a
# dependency of `packages/tailwind-config`, so under pnpm's isolated linker the dev server
# fails with "Cannot find module '@tailwindcss/postcss'" unless a copy happens to be
# resolvable from a parent directory. Link it where postcss looks for it.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mkdir -p apps/web/node_modules/@tailwindcss
ln -sfn "$(readlink -f packages/tailwind-config/node_modules/@tailwindcss/postcss)" apps/web/node_modules/@tailwindcss/postcss
