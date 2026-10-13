import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

interface ReactEntryCheck {
  filePath: string;
  hookImportPattern: RegExp;
  reactImportPattern: RegExp;
}

const reactEntryChecks: ReactEntryCheck[] = [
  {
    filePath: "dist/index.js",
    hookImportPattern: /import\s*["']\.\/install-hook-only\.js["']/,
    reactImportPattern: /from\s*["']react["']/,
  },
  {
    filePath: "dist/index.cjs",
    hookImportPattern: /require\(["']\.\/install-hook-only\.cjs["']\)/,
    reactImportPattern: /require\(["']react["']\)/,
  },
];

for (const { filePath, hookImportPattern, reactImportPattern } of reactEntryChecks) {
  const output = readFileSync(filePath, "utf8");
  const hookImportIndex = output.search(hookImportPattern);
  const reactImportIndex = output.search(reactImportPattern);

  assert.notEqual(hookImportIndex, -1, `${filePath} does not install the hook`);
  assert.notEqual(reactImportIndex, -1, `${filePath} does not import React as an external`);
  assert.ok(
    hookImportIndex < reactImportIndex,
    `${filePath} imports React before installing the hook`,
  );
}
