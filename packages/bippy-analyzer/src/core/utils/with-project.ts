import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import type { Project } from "typescript/unstable/sync";

const SOURCE_FILE_PATTERN = /\.[jt]sx?$/;

export const isProjectSourceFile = (fileName: string): boolean =>
  !fileName.includes(`${sep}node_modules${sep}`) &&
  !fileName.endsWith(".d.ts") &&
  SOURCE_FILE_PATTERN.test(fileName);

const isPathMap = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (targets) => Array.isArray(targets) && targets.every((target) => typeof target === "string"),
  );

const getBaseUrlPaths = (api: API, configPath: string): Record<string, string[]> | null => {
  const { baseUrl, paths } = api.parseConfigFile(configPath).options;
  if (typeof baseUrl !== "string") return null;
  const resolvedPaths = Object.fromEntries(
    Object.entries(isPathMap(paths) ? paths : {}).map(([pattern, targets]) => [
      pattern,
      targets.map((target) => resolve(baseUrl, target)),
    ]),
  );
  return { ...resolvedPaths, "*": [...(resolvedPaths["*"] ?? []), join(baseUrl, "*")] };
};

export const withProject = <Result>(
  configPath: string,
  callback: (project: Project) => Result,
): Result => {
  const api = new API({ cwd: dirname(configPath) });
  const paths = getBaseUrlPaths(api, configPath);
  const shimDirectory = paths ? mkdtempSync(join(tmpdir(), "bippy-tsconfig-")) : null;
  const projectConfigPath = shimDirectory ? join(shimDirectory, "tsconfig.json") : configPath;
  if (shimDirectory) {
    writeFileSync(
      projectConfigPath,
      JSON.stringify({ extends: resolve(configPath), compilerOptions: { paths } }),
    );
  }
  try {
    const project = api.updateSnapshot({ openProjects: [projectConfigPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
    return callback(project);
  } finally {
    api.close();
    if (shimDirectory) rmSync(shimDirectory, { recursive: true, force: true });
  }
};
