import tseslint from 'typescript-eslint';

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
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'import/order': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'eslint-disable @typescript-eslint/no-explicit-any': 'off',
      'eslint-disable @typescript-eslint/no-redundant-type-constituents': 'off',
      'eslint-disable @typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
