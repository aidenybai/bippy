import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "./collect";
import type { CollectSummary } from "./collect";
import { CACHE_DIRECTORY } from "./repos";
import type { LineLogger, RepoConfig } from "./repos";

const SETUP_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const SETUP_ERROR_TAIL_LENGTH = 4000;
export const COMPONENT_BUDGET_MS = 60_000;
const PACKAGE_MANAGER_ENVIRONMENT_PREFIXES = ["npm_", "COREPACK_"];

export const getSetupKey = (repo: RepoConfig): string =>
  JSON.stringify([
    repo.revision,
    repo.install,
    repo.patchFile ? readFileSync(repo.patchFile, "utf8") : "",
  ]);

const withoutPackageManagerEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !PACKAGE_MANAGER_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  );

const runSetupStep = (
  repo: RepoConfig,
  command: string,
  commandArguments: string[],
  options: { cwd?: string; shell?: string } = {},
): void => {
  const step = spawnSync(command, commandArguments, {
    ...options,
    env: withoutPackageManagerEnvironment(process.env),
    encoding: "utf8",
    maxBuffer: SETUP_OUTPUT_BUFFER_BYTES,
  });
  if (step.status !== 0)
    throw new Error(
      `setup failed for ${repo.id}:\n${(step.stderr || step.stdout).slice(-SETUP_ERROR_TAIL_LENGTH)}`,
    );
};

const checkout = (repo: RepoConfig, appDirectory: string): void => {
  rmSync(appDirectory, { recursive: true, force: true });
  runSetupStep(repo, "git", ["init", "-q", appDirectory]);
  runSetupStep(repo, "git", [
    "-C",
    appDirectory,
    "fetch",
    "-q",
    "--depth",
    "1",
    repo.repository,
    repo.revision,
  ]);
  runSetupStep(repo, "git", ["-C", appDirectory, "checkout", "-q", "FETCH_HEAD"]);
  if (repo.patchFile)
    runSetupStep(repo, "git", ["-C", appDirectory, "apply", "--whitespace=nowarn", repo.patchFile]);
};

const prepare = (repo: RepoConfig, log: LineLogger): string => {
  const appDirectory = join(CACHE_DIRECTORY, repo.id);
  const markerFile = join(CACHE_DIRECTORY, `${repo.id}.ready`);
  if (existsSync(markerFile) && readFileSync(markerFile, "utf8") === getSetupKey(repo))
    return appDirectory;
  mkdirSync(CACHE_DIRECTORY, { recursive: true });
  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)}`);
  checkout(repo, appDirectory);
  runSetupStep(repo, repo.install, [], { cwd: appDirectory, shell: "bash" });
  writeFileSync(markerFile, getSetupKey(repo));
  return appDirectory;
};

export const runLocal = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: LineLogger,
): Promise<CollectSummary> => {
  const appDirectory = prepare(repo, log);
  return collect(
    join(appDirectory, repo.workingDirectory, repo.tsconfig),
    outputDirectory,
    shouldVerify,
    repo.setupDirectory,
    (line) => log(`${repo.id}: ${line}`),
    COMPONENT_BUDGET_MS,
  );
};
