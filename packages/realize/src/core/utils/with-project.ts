import { API, DiagnosticCategory } from "typescript/unstable/sync";
import { NO_TRACER } from "../tracer";
import type { Tracer } from "../tracer";
import { ConfigError } from "../config-error";
import { resolve, join, dirname } from "node:path";
import type { Project } from "typescript/unstable/sync";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const isPathMap = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (targets) => Array.isArray(targets) && targets.every((target) => typeof target === "string"),
  );

const parseConfigOptions = (api: API, configPath: string): Record<string, unknown> => {
  try {
    return api.parseConfigFile(configPath).options;
  } catch {
    throw new ConfigError(`could not read ${configPath}`);
  }
};

const assertConfigParsed = (project: Project, configPath: string): void => {
  const errors = project.program
    .getConfigFileParsingDiagnostics()
    .filter((diagnostic) => diagnostic.category === DiagnosticCategory.Error);
  if (errors.length > 0)
    throw new ConfigError(
      `${configPath} has errors:\n${errors.map((diagnostic) => diagnostic.text).join("\n")}`,
    );
};

const getBaseUrlPaths = (api: API, configPath: string): Record<string, string[]> | null => {
  const { baseUrl, paths } = parseConfigOptions(api, configPath);
  if (typeof baseUrl !== "string") return null;
  const resolvedPaths = Object.fromEntries(
    Object.entries(isPathMap(paths) ? paths : {}).map(([pattern, targets]) => [
      pattern,
      targets.map((target) => resolve(baseUrl, target)),
    ]),
  );
  return { ...resolvedPaths, "*": [...(resolvedPaths["*"] ?? []), join(baseUrl, "*")] };
};

const closeAfterFailure = (api: API): void => {
  try {
    api.close();
  } catch {
    return;
  }
};

export const withProject = <Result>(
  configPath: string,
  callback: (project: Project) => Result,
  tracer: Tracer = NO_TRACER,
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
    const project = tracer.span(
      "typescript",
      "program",
      () => api.updateSnapshot({ openProjects: [projectConfigPath] }).getProjects()[0],
    );
    if (!project) throw new ConfigError(`no TypeScript project found for ${configPath}`);
    assertConfigParsed(project, configPath);
    const callbackResult = callback(project);
    api.close();
    return callbackResult;
  } catch (error) {
    closeAfterFailure(api);
    throw error;
  } finally {
    if (shimDirectory) rmSync(shimDirectory, { recursive: true, force: true });
  }
};
