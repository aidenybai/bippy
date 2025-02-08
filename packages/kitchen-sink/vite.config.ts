import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import mkcert from 'vite-plugin-mkcert';

export default defineConfig({
  build: {
    minify: false,
  },
  plugins: [
    mkcert(),
    TanStackRouterVite(),
    // react({
    //   // babel: {
    //   //   plugins: [['babel-plugin-react-compiler', {}]],
    //   // },
    // }),
    tailwindcss(),
  ],
  define: {
    __VERSION__: `"v${JSON.parse(fs.readFileSync('../bippy/package.json', 'utf8')).version}"`,
  },
  resolve:
    process.env.NODE_ENV === 'prodauction'
      ? {}
      : {
          alias: {
            bippy: path.resolve(__dirname, '../bippy'),
          },
        },
});
