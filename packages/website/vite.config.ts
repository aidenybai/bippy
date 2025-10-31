import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    minify: false,
  },
  define: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    __VERSION__: `"v${JSON.parse(fs.readFileSync('../bippy/package.json', 'utf8')).version}"`,
  },
  plugins: [
    react({
      // jsxImportSource: 'bippy/dist',
      // babel: {
      //   plugins: [['babel-plugin-react-compiler', {}]],
      // },
    }),
    tailwindcss(),
  ],
  resolve:
    process.env.NODE_ENV === 'production'
      ? {}
      : {
          alias: {
            bippy: path.resolve(__dirname, '../bippy'),
          },
        },
});
