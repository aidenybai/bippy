/* eslint-disable @typescript-eslint/no-unsafe-call */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import webExtension, { readJsonFile } from 'vite-plugin-web-extension';

function generateManifest() {
  const manifest = readJsonFile('src/manifest.json');
  const pkg = readJsonFile('package.json');
  return {
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    ...manifest,
  };
}

export default defineConfig({
  plugins: [
    react(),
    webExtension({
      manifest: generateManifest,
      browser: 'chrome',
      disableAutoLaunch: true,
      additionalInputs: ['src/panel.html'],
      scriptViteConfig: {
        build: {
          rollupOptions: {
            output: {
              inlineDynamicImports: false,
            },
          },
        },
      },
    }),
  ],
});
