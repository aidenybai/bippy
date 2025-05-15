import { defineConfig } from 'fumadocs-mdx/config';

export default defineConfig({
  basePath: '/docs',
  exclude: ['**/node_modules/**', '**/README.md'],
});
