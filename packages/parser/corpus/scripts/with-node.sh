#!/usr/bin/env bash
# Runs a command under a specific Node.js major version through nvm when the
# ambient node does not already satisfy it.
# Usage: with-node.sh <major> <command...>
set -euo pipefail

required_major="$1"
shift

current_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$current_major" != "$required_major" ]; then
  nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ ! -f "$nvm_script" ]; then
    echo "with-node: node $required_major required (found $current_major) and nvm is not installed" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$nvm_script"
  nvm install "$required_major" >/dev/null
  nvm use "$required_major" >/dev/null
fi

exec "$@"
