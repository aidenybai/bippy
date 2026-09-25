import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vite-plus/test";

export interface ResolverProject {
  directory: string;
  importer: string;
  write: (filePath: string, contents: string | object) => string;
}

const directories = new Set<string>();
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

export const createResolverProject = (): ResolverProject => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "bippy-resolver-")));
  directories.add(directory);
  const write = (filePath: string, contents: string | object): string => {
    const absolutePath = join(directory, filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, typeof contents === "string" ? contents : JSON.stringify(contents));
    return absolutePath;
  };
  write("package.json", { name: "fixture-project", type: "module" });
  const importer = write("src/app.tsx", "export {};");
  return { directory, importer, write };
};
