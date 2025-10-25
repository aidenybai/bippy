import tseslint from 'typescript-eslint';
import perfectionist from 'eslint-plugin-perfectionist';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'eslint.config.js',
      'bundled_*.mjs',
      '*.mjs',
      '*.cjs',
      '*.js',
      '*.json',
      '*.md',
      '**/.next/**',
      '**/.turbo/**',
      '**/.vite/**',
      '**/.changeset/**',
      'examples/**',
      '**/scripts/**',
      '**/postcss.config.mjs',
    ],
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  perfectionist.configs['recommended-natural'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'import/order': 'off',
    },
  },
  {
    files: ['**/test/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      'perfectionist/sort-imports': 'off',
    },
  },
);
