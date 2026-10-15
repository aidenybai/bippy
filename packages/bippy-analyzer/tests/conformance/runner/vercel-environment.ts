import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import type { Command, CommandFinished } from "@vercel/sandbox";
import type { CollectSummary } from "./collect";
import {
  CACHE_DIRECTORY,
  CONFORMANCE_DIRECTORY,
  PACKAGE_DIRECTORY,
  getSetupEnvironment,
  getSetupInputs,
} from "./repos";
import { z } from "zod";
import type { LineLogger, RepoConfig } from "./repos";

const SNAPSHOTS_SCHEMA = z.record(
  z.string(),
  z.object({ key: z.string(), snapshotId: z.string() }),
);

type SnapshotRecord = z.infer<typeof SNAPSHOTS_SCHEMA>[string];

interface Credentials {
  token: string;
  teamId: string;
  projectId: string;
}

const SNAPSHOTS_FILE = join(CACHE_DIRECTORY, "vercel-snapshots.json");
const SANDBOX_ROOT = "/vercel/sandbox";
const APP_DIRECTORY = `${SANDBOX_ROOT}/app`;
const ANALYZER_DIRECTORY = `${SANDBOX_ROOT}/analyzer`;
const OUTPUT_DIRECTORY = `${SANDBOX_ROOT}/out`;
const SETUP_TIMEOUT_MS = 30 * 60 * 1000;
const RUN_TIMEOUT_MS = 180 * 60 * 1000;
const SANDBOX_RESOURCES = { vcpus: 8 };
const ANALYZER_HEAP_MB = 8192;
const OUTPUT_TAIL_LENGTH = 8000;
const MAX_WAIT_ATTEMPTS = 5;
const ANALYZER_SOURCE_DIRECTORIES = [
  "src",
  "tests/conformance/runner",
  "tests/conformance/repos",
  "tests/conformance/verifier",
];
const BIPPY_SOURCE_DIRECTORY = join(PACKAGE_DIRECTORY, "../bippy/src");
const ANALYZER_DEPENDENCIES = [
  "typescript",
  "commander",
  "picocolors",
  "tsx",
  "@vercel/sandbox",
  "vite",
  "vite-tsconfig-paths",
  "magic-string",
  "playwright",
  "@babel/core",
  "@babel/traverse",
  "@babel/types",
  "@babel/parser",
  "@babel/code-frame",
  "invariant",
  "pretty-format",
  "zod",
  "zod-validation-error",
  "diff",
];

const getCredentials = (): Credentials => {
  const envFile = join(PACKAGE_DIRECTORY, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (!VERCEL_TOKEN || !VERCEL_TEAM_ID || !VERCEL_PROJECT_ID) {
    throw new Error(
      "Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID, or add them to packages/bippy-analyzer/.env.local",
    );
  }
  return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
};

const readSnapshots = (): Record<string, SnapshotRecord> =>
  existsSync(SNAPSHOTS_FILE)
    ? SNAPSHOTS_SCHEMA.parse(JSON.parse(readFileSync(SNAPSHOTS_FILE, "utf8")))
    : {};

const writeSnapshot = (id: string, record: SnapshotRecord): void => {
  mkdirSync(CACHE_DIRECTORY, { recursive: true });
  writeFileSync(
    SNAPSHOTS_FILE,
    `${JSON.stringify({ ...readSnapshots(), [id]: record }, null, 2)}\n`,
  );
};

const getAnalyzerPackageJson = (): string => {
  const packageJson = JSON.parse(readFileSync(join(PACKAGE_DIRECTORY, "package.json"), "utf8"));
  const versions: Record<string, string> = {
    ...packageJson.devDependencies,
    ...packageJson.dependencies,
  };
  const dependencies = Object.fromEntries(
    ANALYZER_DEPENDENCIES.map((name) => [name, versions[name] ?? "latest"]),
  );
  return `${JSON.stringify({ name: "analyzer", private: true, type: "module", dependencies }, null, 2)}\n`;
};

const getSnapshotKey = (repo: RepoConfig): string =>
  createHash("sha256")
    .update(JSON.stringify([...getSetupInputs(repo), getAnalyzerPackageJson()]))
    .digest("hex");

const listFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

const waitForCommand = async (command: Command, attempt = 1): Promise<CommandFinished> => {
  try {
    return await command.wait();
  } catch (error) {
    if (attempt >= MAX_WAIT_ATTEMPTS) throw error;
    return waitForCommand(command, attempt + 1);
  }
};

const MILLISECONDS_PER_MINUTE = 60_000;

const runStage = async <Value>(stage: string, run: () => Promise<Value>): Promise<Value> => {
  const startTime = Date.now();
  try {
    return await run();
  } catch (error) {
    const minutes = Math.round((Date.now() - startTime) / MILLISECONDS_PER_MINUTE);
    throw new Error(`${stage} failed after ${minutes} min`, { cause: error });
  }
};

interface StepOptions {
  cwd?: string;
  env?: Record<string, string>;
  sudo?: boolean;
}

const runStep = async (
  sandbox: Sandbox,
  label: string,
  commandName: string,
  commandArguments: string[],
  options: StepOptions = {},
): Promise<void> => {
  const command = await sandbox.runCommand({
    cmd: commandName,
    args: commandArguments,
    ...options,
    detached: true,
  });
  const finishedCommand = await waitForCommand(command);
  if (finishedCommand.exitCode !== 0) {
    const output = await finishedCommand.output("both");
    throw new Error(
      `${label} failed with exit code ${finishedCommand.exitCode}:\n${output.slice(-OUTPUT_TAIL_LENGTH)}`,
    );
  }
};

const uploadSetupFiles = (sandbox: Sandbox, repo: RepoConfig): Promise<void> =>
  sandbox.writeFiles([
    {
      path: `${SANDBOX_ROOT}/setup.sh`,
      content: readFileSync(join(CONFORMANCE_DIRECTORY, "setup.sh")),
      mode: 0o755,
    },
    { path: `${ANALYZER_DIRECTORY}/package.json`, content: getAnalyzerPackageJson() },
    ...(repo.patchFile
      ? [{ path: `${SANDBOX_ROOT}/custom.patch`, content: readFileSync(repo.patchFile) }]
      : []),
  ]);

const installRepoAndBrowser = async (sandbox: Sandbox, repo: RepoConfig): Promise<void> => {
  await runStep(sandbox, "setup", "bash", [`${SANDBOX_ROOT}/setup.sh`], {
    env: getSetupEnvironment(
      repo,
      APP_DIRECTORY,
      repo.patchFile ? `${SANDBOX_ROOT}/custom.patch` : null,
    ),
  });
  await runStep(sandbox, "analyzer install", "npm", ["install", "--no-audit", "--no-fund"], {
    cwd: ANALYZER_DIRECTORY,
  });
  await runStep(
    sandbox,
    "browser dependencies",
    `${ANALYZER_DIRECTORY}/node_modules/.bin/playwright`,
    ["install-deps", "chromium"],
    { cwd: ANALYZER_DIRECTORY, sudo: true },
  );
  await runStep(
    sandbox,
    "browser install",
    "node_modules/.bin/playwright",
    ["install", "chromium"],
    {
      cwd: ANALYZER_DIRECTORY,
    },
  );
};

const prepareSnapshot = async (
  repo: RepoConfig,
  credentials: Credentials,
  log: LineLogger,
): Promise<string> => {
  const key = getSnapshotKey(repo);
  const existing = readSnapshots()[repo.id];
  if (existing?.key === key) return existing.snapshotId;
  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)} in a new sandbox`);
  const sandbox = await Sandbox.create({
    ...credentials,
    resources: SANDBOX_RESOURCES,
    timeout: SETUP_TIMEOUT_MS,
  });
  try {
    await uploadSetupFiles(sandbox, repo);
    await installRepoAndBrowser(sandbox, repo);
    const snapshot = await sandbox.snapshot();
    writeSnapshot(repo.id, { key, snapshotId: snapshot.snapshotId });
    log(`saved snapshot for ${repo.id}`);
    return snapshot.snapshotId;
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
};

const uploadAnalyzerSource = (sandbox: Sandbox): Promise<void> => {
  const sourceFiles = ANALYZER_SOURCE_DIRECTORIES.flatMap((directory) =>
    listFiles(join(PACKAGE_DIRECTORY, directory)),
  );
  return sandbox.writeFiles([
    ...sourceFiles.map((path) => ({
      path: `${ANALYZER_DIRECTORY}/${relative(PACKAGE_DIRECTORY, path)}`,
      content: readFileSync(path),
    })),
    ...listFiles(BIPPY_SOURCE_DIRECTORY).map((path) => ({
      path: `${SANDBOX_ROOT}/bippy/src/${relative(BIPPY_SOURCE_DIRECTORY, path)}`,
      content: readFileSync(path),
    })),
  ]);
};

const runCollect = async (
  sandbox: Sandbox,
  repo: RepoConfig,
  shouldVerify: boolean,
): Promise<void> => {
  const tsconfigPath = `${APP_DIRECTORY}/${repo.workingDirectory}/${repo.tsconfig}`;
  await runStep(
    sandbox,
    "analyze",
    "node_modules/.bin/tsx",
    [
      "tests/conformance/runner/collect.ts",
      tsconfigPath,
      OUTPUT_DIRECTORY,
      ...(shouldVerify ? ["--verify"] : []),
      ...(repo.setupDirectory
        ? ["--setup", `${ANALYZER_DIRECTORY}/${relative(PACKAGE_DIRECTORY, repo.setupDirectory)}`]
        : []),
    ],
    {
      cwd: ANALYZER_DIRECTORY,
      env: { NODE_OPTIONS: `--max-old-space-size=${ANALYZER_HEAP_MB}` },
    },
  );
};

const downloadResults = async (
  sandbox: Sandbox,
  outputDirectory: string,
  shouldVerify: boolean,
): Promise<void> => {
  mkdirSync(outputDirectory, { recursive: true });
  for (const fileName of [
    "analysis.json",
    "summary.json",
    ...(shouldVerify ? ["verify.json"] : []),
  ]) {
    const content = await sandbox.readFileToBuffer({ path: `${OUTPUT_DIRECTORY}/${fileName}` });
    if (!content) throw new Error(`${fileName} was not written`);
    writeFileSync(join(outputDirectory, fileName), content);
  }
};

export const runVercel = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: LineLogger,
): Promise<CollectSummary> => {
  const credentials = getCredentials();
  const snapshotId = await runStage("setup", () => prepareSnapshot(repo, credentials, log));
  const sandbox = await runStage("sandbox creation", () =>
    Sandbox.create({
      ...credentials,
      source: { type: "snapshot", snapshotId },
      resources: SANDBOX_RESOURCES,
      timeout: RUN_TIMEOUT_MS,
    }),
  );
  try {
    await runStage("upload", () => uploadAnalyzerSource(sandbox));
    await runStage("analysis", () => runCollect(sandbox, repo, shouldVerify));
    await runStage("download", () => downloadResults(sandbox, outputDirectory, shouldVerify));
    return JSON.parse(readFileSync(join(outputDirectory, "summary.json"), "utf8"));
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
};
