import fs from 'node:fs';
import { defineConfig, type Options } from 'tsdown';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

const DEFAULT_OPTIONS: Options = {
  clean: false,
  dts: true,
  entry: [],
  env: {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  },
  inputOptions: (options) => ({
    ...options,
    transform: {
      ...options.transform,
      define: {
        ...(options.transform as Record<string, any>)?.define,
        'process.env.VERSION': JSON.stringify(pkg.version),
      },
    },
  }),
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
      core: './src/core.ts',
      source: './src/source/index.ts',
      hmr: './src/hmr/index.ts',
      ['install-hook-only']: './src/install-hook-only.ts',
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
  {
    ...DEFAULT_OPTIONS,
    entry: ['./src/install-hook-only.ts'],
    format: ['iife'],
    globalName: 'Bippy',
    minify: process.env.NODE_ENV === 'production',
    outDir: './dist',
  },
]);
