#!/usr/bin/env bash
# Runs the Museeks renderer in a plain browser the way its own E2E suite does
# (src/__tests__/e2e-helpers.tsx): the Tauri globals are stubbed and the IPC
# bridges resolve to the repository's mocks. Run from the clone root after install.
set -euo pipefail

mkdir -p src/__browser__
cat > src/__browser__/tauri-shim.ts <<'EOF'
import { MOCK_CONFIG } from '../lib/__mocks__/bridge-config';

const noop = () => undefined;

Object.assign(window, {
  __MUSEEKS_INITIAL_CONFIG: MOCK_CONFIG,
  __MUSEEKS_INITIAL_QUEUE: [],
  __MUSEEKS_PLATFORM: 'linux',
  __TAURI_INTERNALS__: {
    __TAURI_PATTERN__: { pattern: 'brownfield' },
    plugins: { path: { sep: '/', delimiter: ':' } },
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main' },
    },
    callbacks: new Map(),
    invoke: noop,
    convertFileSrc: (path: string) => path,
    ipc: noop,
    postMessage: noop,
    runCallback: noop,
    transformCallback: noop,
    unregisterCallback: noop,
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: noop },
  __TAURI_OS_PLUGIN_INTERNALS__: {
    arch: 'x86_64',
    eol: '\n',
    exe_extension: '',
    family: 'unix',
    os_type: 'linux',
    platform: 'linux',
    version: '6.8.0',
  },
});
EOF

for bridge in bridge-config bridge-database cover; do
  printf "export * from './__mocks__/%s';\nexport { default } from './__mocks__/%s';\n" "$bridge" "$bridge" \
    > "src/lib/$bridge.ts"
done
printf "export * from './__mocks__/cover';\n" > src/lib/cover.ts

sed -i 's#<script defer="defer" type="module" src="/src/main.tsx"></script>#<script type="module" src="/src/__browser__/tauri-shim.ts"></script>\n    <script defer="defer" type="module" src="/src/main.tsx"></script>#' index.html
