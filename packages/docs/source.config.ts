import { defineConfig } from 'fumadocs-mdx/config';

export default defineConfig({
  rootDir: 'content',
  baseUrl: '/docs',
  ignorePatterns: ['**/node_modules/**', '**/README.md'],
});
