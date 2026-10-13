import assert from "node:assert/strict";

interface ReactEntryCheck {
  filePath: string;
  hookFilePath: string;
  importPattern: RegExp;
  reactImportPattern: RegExp;
}

const reactEntryChecks: ReactEntryCheck[] = [
  {
    filePath: "dist/index.js",
    hookFilePath: "dist/install-hook-only.js",
    importPattern: /import\s*["'](\.\/[^"']+)["']/g,
    reactImportPattern: /from\s*["']react["']/,
  },
  {
    filePath: "dist/index.cjs",
    hookFilePath: "dist/install-hook-only.cjs",
    importPattern: /require\(["'](\.\/[^"']+)["']\)/g,
    reactImportPattern: /require\(["']react["']\)/,
  },
];

for (const { filePath, hookFilePath, importPattern, reactImportPattern } of reactEntryChecks) {
  const output = await Bun.file(filePath).text();
  const reactImportIndex = output.search(reactImportPattern);
  const hookChunks = Array.from(
    (await Bun.file(hookFilePath).text()).matchAll(importPattern),
    (match) => match[1],
  );

  assert.notEqual(hookChunks.length, 0, `${hookFilePath} does not install the hook`);
  assert.notEqual(reactImportIndex, -1, `${filePath} does not import React as an external`);
  for (const hookChunk of hookChunks) {
    const hookImportIndex = output.indexOf(hookChunk);
    assert.notEqual(hookImportIndex, -1, `${filePath} does not install the hook`);
    assert.ok(
      hookImportIndex < reactImportIndex,
      `${filePath} imports React before installing the hook`,
    );
    assert.doesNotMatch(
      await Bun.file(`dist/${hookChunk}`).text(),
      reactImportPattern,
      `${hookChunk} imports React before installing the hook`,
    );
  }
}
