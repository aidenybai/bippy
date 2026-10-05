#!/usr/bin/env bash
# Runs a command with a Go toolchain on PATH, downloading the requested release
# from go.dev when no `go` is installed.
# Usage: with-go.sh <version> <command...>
set -euo pipefail

required_version="$1"
shift

if ! command -v go >/dev/null 2>&1; then
  install_root="${BIPPY_GO_ROOT:-$HOME/.bippy-go}/go$required_version"
  if [ ! -x "$install_root/go/bin/go" ]; then
    mkdir -p "$install_root"
    arch="$(uname -m)"
    case "$arch" in
      x86_64) arch="amd64" ;;
      aarch64 | arm64) arch="arm64" ;;
    esac
    curl -fsSL "https://go.dev/dl/go$required_version.linux-$arch.tar.gz" | tar -xz -C "$install_root"
  fi
  PATH="$install_root/go/bin:$PATH"
  export PATH
fi

exec "$@"
