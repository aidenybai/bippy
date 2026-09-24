#!/usr/bin/env bash
# Wires a glide-data-grid test project to the built packages/core the way
# test-projects/bootstrap-projects.sh does, then aliases react/react-dom to the
# project's own copies: core's dist would otherwise resolve the repository root's
# React next to the project's React and crash on the first hook.
# Run from the test project directory after building packages/core.
set -euo pipefail

npm install --legacy-peer-deps --no-audit --no-fund
rm -rf node_modules/@glideapps/glide-data-grid
ln -s ../../../../packages/core node_modules/@glideapps/glide-data-grid

cat > next.config.js <<'EOF'
const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias.react = path.resolve(__dirname, "node_modules/react");
    config.resolve.alias["react-dom"] = path.resolve(__dirname, "node_modules/react-dom");
    return config;
  },
};

module.exports = nextConfig;
EOF
