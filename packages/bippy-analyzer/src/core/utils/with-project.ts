import { dirname, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import type { Project } from "typescript/unstable/sync";

const SOURCE_FILE_PATTERN = /\.[jt]sx?$/;

/**
 * Whether a file belongs to the project itself, not to its dependencies or declarations.
 */
export const isProjectSourceFile = (fileName: string): boolean =>
  !fileName.includes(`${sep}node_modules${sep}`) &&
  !fileName.endsWith(".d.ts") &&
  SOURCE_FILE_PATTERN.test(fileName);

/**
 * Opens the TypeScript project for a tsconfig, runs `callback` on it, and closes it.
 */
export const withProject = <Result>(
  configPath: string,
  callback: (project: Project) => Result,
): Result => {
  const api = new API({ cwd: dirname(configPath) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
    return callback(project);
  } finally {
    api.close();
  }
};
