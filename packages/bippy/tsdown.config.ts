import fs from 'node:fs';
import { defineConfig, type Options } from 'tsdown';

const DEFAULT_OPTIONS: Options = {
  clean: false,
  dts: true,
  entry: [],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    VERSION: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  },
  external: ['react', 'react-dom', 'react-reconciler'],
  format: [],
  minify: process.env.NODE_ENV === 'production',
  noExternal: ['error-stack-parser-es', '@jridgewell/sourcemap-codec'],
  outDir: './dist',
  platform: 'browser',
  sourcemap: false,
  target: 'esnext',
  treeshake: true,
};

export default defineConfig([
  {
    ...DEFAULT_OPTIONS,
    clean: true, // only run on first entry
    entry: {
      index: './src/index.ts',
      source: './src/source/index.ts',
    },
    format: ['esm', 'cjs'],
  },
  {
    ...DEFAULT_OPTIONS,
    entry: ['./src/index.ts'],
    format: ['iife'],
    globalName: 'Bippy',
    minify: process.env.NODE_ENV === 'production',
    outDir: './dist',
  },
]);
