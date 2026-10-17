import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collect } from "./collect";
import type { CollectSummary } from "./collect";
import {
  CACHE_DIRECTORY,
  CONFORMANCE_DIRECTORY,
  getSetupEnvironment,
  getSetupInputs,
} from "./repos";
import type { LineLogger, RepoConfig } from "./repos";

const SETUP_OUTPUT_BUFFER_BYTES = 64 * 1024 * 1024;
const SETUP_ERROR_TAIL_LENGTH = 4000;
const COMPONENT_BUDGET_MS = 60_000;
const PACKAGE_MANAGER_ENVIRONMENT_PREFIXES = ["npm_", "COREPACK_"];

const getLocalSetupKey = (repo: RepoConfig): string => JSON.stringify(getSetupInputs(repo));

const withoutPackageManagerEnvironment = (environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !PACKAGE_MANAGER_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix)),
    ),
  );

const prepare = (repo: RepoConfig, log: LineLogger): string => {
  const appDirectory = join(CACHE_DIRECTORY, repo.id);
  const markerFile = join(CACHE_DIRECTORY, `${repo.id}.ready`);
  if (existsSync(markerFile) && readFileSync(markerFile, "utf8") === getLocalSetupKey(repo))
    return appDirectory;
  mkdirSync(CACHE_DIRECTORY, { recursive: true });
  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)}`);
  const setupProcess = spawnSync("bash", [join(CONFORMANCE_DIRECTORY, "setup.sh")], {
    env: {
      ...withoutPackageManagerEnvironment(process.env),
      ...getSetupEnvironment(repo, appDirectory, repo.patchFile),
    },
    encoding: "utf8",
    maxBuffer: SETUP_OUTPUT_BUFFER_BYTES,
  });
  if (setupProcess.status !== 0)
    throw new Error(
      `setup failed for ${repo.id}:\n${setupProcess.stderr.slice(-SETUP_ERROR_TAIL_LENGTH)}`,
    );
  writeFileSync(markerFile, getLocalSetupKey(repo));
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
