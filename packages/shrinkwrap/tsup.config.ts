import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['inject/index.ts'],
  outDir: 'inject/dist',
  format: 'iife',
  globalName: 'Shrinkwrap',
  minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
});
