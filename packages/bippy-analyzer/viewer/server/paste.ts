import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scratchDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)), "../scratch");

const TSCONFIG = {
  compilerOptions: {
    jsx: "react-jsx",
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "es2022",
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src"],
};

const ensureScratchProject = (): void => {
  const tsconfig = join(scratchDirectory, "tsconfig.json");
  mkdirSync(join(scratchDirectory, "src"), { recursive: true });
  if (!existsSync(tsconfig)) writeFileSync(tsconfig, JSON.stringify(TSCONFIG, null, 2));
};

export const savePaste = (code: string): string => {
  ensureScratchProject();
  const hash = createHash("sha1").update(code).digest("hex").slice(0, 12);
  const file = join(scratchDirectory, "src", `paste-${hash}.tsx`);
  if (!existsSync(file)) writeFileSync(file, code);
  return file;
};
