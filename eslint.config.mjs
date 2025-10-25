import tseslint from "typescript-eslint";
import perfectionist from "eslint-plugin-perfectionist";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/eslint.config.mjs",
      "**/bundled_*.mjs",
      "**/vitest.config.ts",
      "**/tsdown.config.ts",
      "**/tsconfig.json",
      "**/tsconfig.node.json",
      "**/tsconfig.app.json",
      "**/tsconfig.base.json",
      "**/examples/**",
      "**/scripts/**",
      "**/fixtures/**",
      "**/coverage/**",
      "**/tmp/**",
      "**/build/**",
      "**/*.mjs",
      "**/*.cjs",
      "**/*.js",
      "**/*.jsx",
      "**/*.config.*",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  perfectionist.configs["recommended-natural"],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Disable import/order as perfectionist handles this
      "import/order": "off",

      // Relax strict TypeScript rules for low-level React internals code
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/require-await": "warn",

      // Allow unused vars with underscore prefix
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Relax some other rules
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-var": "error",
      "prefer-rest-params": "warn",
    },
  },
);
