import { defineConfig, type Options } from 'tsdown';
import fs from 'node:fs';

const DEFAULT_OPTIONS: Options = {
  entry: [],
  clean: false,
  outDir: './dist',
  sourcemap: false,
  format: [],
  target: 'esnext',
  platform: 'browser',
  treeshake: true,
  dts: true,
  minify: false,
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    VERSION: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  },
  external: ['react', 'react-dom', 'react-reconciler'],
  noExternal: ['error-stack-parser-es', 'source-map-js'],
};

export default defineConfig([
  {
    ...DEFAULT_OPTIONS,
    format: ['esm', 'cjs'],
    entry: {
      index: './src/index.ts',
      source: './src/source.ts',
      override: './src/override.ts',
      'experiments/inspect': './src/experiments/inspect.tsx',
    },
    clean: true, // only run on first entry
  },
  {
    ...DEFAULT_OPTIONS,
    format: ['iife'],
    outDir: './dist',
    minify: process.env.NODE_ENV === 'production',
    globalName: 'Bippy',
    entry: ['./src/index.ts'],
  },
]);
