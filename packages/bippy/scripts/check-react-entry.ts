import assert from "node:assert/strict";

// Bun names chunks by hash, so the hook is found through the modules install-hook-only loads.
const importSpecifier = /(?:\bfrom|\bimport|\brequire\()\s*["']([^"']+)["']/g;

const readImports = async (filePath: string): Promise<string[]> =>
  Array.from((await Bun.file(filePath).text()).matchAll(importSpecifier), ([, specifier]) =>
    specifier.replace(/^\.\//, ""),
  );

for (const extension of ["js", "cjs"]) {
  const filePath = `dist/index.${extension}`;
  const entryImports = await readImports(filePath);
  const hookImports = await readImports(`dist/install-hook-only.${extension}`);
  const lastHookImportIndex = Math.max(...hookImports.map((path) => entryImports.indexOf(path)));

  assert.ok(
    hookImports.length > 0 && hookImports.every((path) => entryImports.includes(path)),
    `${filePath} does not install the hook`,
  );
  assert.ok(entryImports.includes("react"), `${filePath} does not import React as an external`);
  for (const [index, path] of entryImports.entries()) {
    assert.ok(
      hookImports.includes(path) || index > lastHookImportIndex,
      `${filePath} imports ${path} before installing the hook`,
    );
  }
}
