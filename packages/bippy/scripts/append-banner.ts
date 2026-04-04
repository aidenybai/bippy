import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const banner = `/**
 * @license bippy
 *
 * Copyright (c) Aiden Bai
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */`;

const distDir = path.join(__dirname, "..", "dist");

const appendBannerToFile = (filePath: string) => {
  const content = fs.readFileSync(filePath, "utf8");

  if (content.startsWith(banner)) {
    return;
  }

  const newContent = `${banner}\n${content}`;
  fs.writeFileSync(filePath, newContent, "utf8");
};

// vp pack's dts generator (tsdown/oxc) drops `import type` and emits bare
// `import` for type-only imports, causing MISSING_EXPORT warnings in consumers'
// bundlers. In .d.ts files all named imports are type-level, so we convert
// every `import { ... } from "..."` to `import type { ... } from "..."`.
const fixTypeImportsInDeclaration = (filePath: string) => {
  const content = fs.readFileSync(filePath, "utf8");
  const fixed = content.replace(
    /^import\s+(\{[^}]*\}\s*from\s*"[^"]*")/gm,
    "import type $1",
  );
  if (fixed !== content) {
    fs.writeFileSync(filePath, fixed, "utf8");
  }
};

const processDirectory = (dir: string) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (stat.isFile()) {
      if (file.endsWith(".js") || file.endsWith(".cjs")) {
        appendBannerToFile(filePath);
      }
      if (file.endsWith(".d.ts") || file.endsWith(".d.cts")) {
        fixTypeImportsInDeclaration(filePath);
      }
    }
  }
};

processDirectory(distDir);
