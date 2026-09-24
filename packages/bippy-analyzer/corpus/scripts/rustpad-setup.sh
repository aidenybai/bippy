#!/usr/bin/env bash
# Builds the rustpad-wasm crate that package.json links from ./rustpad-wasm/pkg
# (wasm-pack, installed on demand through cargo), compiles the websocket
# server, then installs the frontend. Run from the clone root.
set -euo pipefail

rustup target add wasm32-unknown-unknown >/dev/null
if ! command -v wasm-pack >/dev/null; then
  cargo install wasm-pack --locked
fi
wasm-pack build rustpad-wasm
cargo build --release -p rustpad-server
npm install --no-audit --no-fund
