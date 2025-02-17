import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    TanStackRouterVite(),
    react({
      jsxImportSource: 'bippy/dist',
      // babel: {
      //   plugins: [['babel-plugin-react-compiler', {}]],
      // },
    }),
    tailwindcss(),
  ],
  define: {
    __VERSION__: `"v${JSON.parse(fs.readFileSync('../bippy/package.json', 'utf8')).version}"`,
  },
  resolve:
    process.env.NODE_ENV === 'production'
      ? {}
      : {
          alias: {
            bippy: path.resolve(__dirname, '../bippy'),
          },
        },
});
