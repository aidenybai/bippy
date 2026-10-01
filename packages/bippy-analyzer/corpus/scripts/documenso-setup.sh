#!/usr/bin/env bash
# Points a Documenso clone at its development containers, migrates and seeds the
# database, and compiles the Lingui catalogs. Run from the clone root after install.
set -euo pipefail

with_node="$(dirname "${BASH_SOURCE[0]}")/with-node.sh"

test -f .env || cp .env.example .env

bash "$with_node" 24 npm run prisma:generate
bash "$with_node" 24 npm run prisma:migrate-deploy
bash "$with_node" 24 npm run prisma:seed
bash "$with_node" 24 npm run translate:compile
