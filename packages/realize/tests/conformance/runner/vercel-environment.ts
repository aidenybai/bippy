import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { Sandbox } from "@vercel/sandbox";
import type { Command, CommandFinished } from "@vercel/sandbox";
import { z } from "zod";
import type { CollectSummary } from "./collect";
import { COMPONENT_BUDGET_MS, getSetupKey } from "./local-environment";
import { CACHE_DIRECTORY, PACKAGE_DIRECTORY } from "./repos";
import type { LineLogger, RepoConfig } from "./repos";

const SNAPSHOTS_SCHEMA = z.record(
  z.string(),
  z.object({ key: z.string(), snapshotId: z.string() }),
);

type SnapshotRecord = z.infer<typeof SNAPSHOTS_SCHEMA>[string];

type Credentials = { token: string; teamId: string; projectId: string } | Record<string, never>;

const SNAPSHOTS_FILE = join(CACHE_DIRECTORY, "vercel-snapshots.json");
const SANDBOX_ROOT = "/vercel/sandbox";
const APP_DIRECTORY = `${SANDBOX_ROOT}/app`;
const ANALYZER_DIRECTORY = `${SANDBOX_ROOT}/analyzer`;
const OUTPUT_DIRECTORY = `${SANDBOX_ROOT}/out`;
const PATCH_PATH = `${SANDBOX_ROOT}/custom.patch`;
const IMAGE = "vercel/sandbox/node:24";
const SETUP_TIMEOUT_MS = 30 * 60 * 1000;
const RUN_TIMEOUT_MS = 180 * 60 * 1000;
const SANDBOX_RESOURCES = { vcpus: 8 };
const ANALYZER_HEAP_MB = 8192;
const OUTPUT_TAIL_LENGTH = 8000;
const MAX_WAIT_ATTEMPTS = 5;
const HELD_WAIT_MS = 60_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const RESULT_FILES = ["analysis.json", "summary.json", "verify.json"];
const ANALYZER_SOURCE_PATHS = [
  "src",
  "tsconfig.json",
  "tests/conformance/runner",
  "tests/conformance/repos",
  "tests/conformance/verifier",
];
const BIPPY_SOURCE_DIRECTORY = join(PACKAGE_DIRECTORY, "../bippy/src");
const ANALYZER_DEPENDENCIES = [
  "@babel/code-frame",
  "@babel/core",
  "@babel/parser",
  "@babel/traverse",
  "@babel/types",
  "commander",
  "diff",
  "invariant",
  "magic-string",
  "picocolors",
  "playwright",
  "pretty-format",
  "tsx",
  "typescript",
  "vite",
  "vite-tsconfig-paths",
  "zod",
  "zod-validation-error",
];
const CHECKOUT_SCRIPT = [
  "set -euo pipefail",
  'git init -q "$APP_DIRECTORY"',
  'git -C "$APP_DIRECTORY" fetch -q --depth 1 "$REPOSITORY" "$REVISION"',
  'git -C "$APP_DIRECTORY" checkout -q FETCH_HEAD',
  'if [ -n "$PATCH_PATH" ]; then git -C "$APP_DIRECTORY" apply --whitespace=nowarn "$PATCH_PATH"; fi',
  'cd "$APP_DIRECTORY"',
  'bash -c "$INSTALL"',
].join("\n");

const getCredentials = (): Credentials => {
  const envFile = join(PACKAGE_DIRECTORY, ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VERCEL_OIDC_TOKEN } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID)
    return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
  if (VERCEL_OIDC_TOKEN) return {};
  throw new Error(
    "Run `vercel link` and `vercel env pull .env.local` in packages/realize, or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID",
  );
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

const findInstalledPackageJson = (name: string): string | null => {
  for (let directory = PACKAGE_DIRECTORY; ; directory = dirname(directory)) {
    const packageJsonPath = join(directory, "node_modules", name, "package.json");
    if (existsSync(packageJsonPath)) return packageJsonPath;
    if (dirname(directory) === directory) return null;
  }
};

const getInstalledVersion = (name: string): string | null => {
  const packageJsonPath = findInstalledPackageJson(name);
  if (packageJsonPath === null) return null;
  const version: unknown = Reflect.get(
    Object(JSON.parse(readFileSync(packageJsonPath, "utf8"))),
    "version",
  );
  return typeof version === "string" ? version : null;
};

const getAnalyzerPackageJson = (): string => {
  const dependencies = Object.fromEntries(
    ANALYZER_DEPENDENCIES.map((name) => [name, getInstalledVersion(name) ?? "latest"]),
  );
  return `${JSON.stringify({ name: "analyzer", private: true, type: "module", dependencies }, null, 2)}\n`;
};

const getSnapshotKey = (repo: RepoConfig): string =>
  createHash("sha256")
    .update(JSON.stringify([getSetupKey(repo), getAnalyzerPackageJson(), IMAGE]))
    .digest("hex");

const listFiles = (path: string): string[] =>
  statSync(path).isDirectory()
    ? readdirSync(path).flatMap((entry) => listFiles(join(path, entry)))
    : [path];

const waitForCommand = async (
  command: Command,
  quickFailureCount = 0,
): Promise<CommandFinished> => {
  const startTime = Date.now();
  try {
    return await command.wait();
  } catch (error) {
    const isQuickFailure = Date.now() - startTime < HELD_WAIT_MS;
    const nextFailureCount = isQuickFailure ? quickFailureCount + 1 : 0;
    if (nextFailureCount >= MAX_WAIT_ATTEMPTS) throw error;
    return waitForCommand(command, nextFailureCount);
  }
};

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
  onOutput?: LineLogger;
}

const forwardOutput = async (command: Command, onOutput: LineLogger): Promise<void> => {
  try {
    for await (const line of command.logs()) onOutput(line.data);
  } catch {
    return;
  }
};

const runStep = async (
  sandbox: Sandbox,
  label: string,
  commandName: string,
  commandArguments: string[],
  options: StepOptions = {},
): Promise<void> => {
  const { onOutput, ...commandOptions } = options;
  const command = await sandbox.runCommand({
    cmd: commandName,
    args: commandArguments,
    ...commandOptions,
    detached: true,
  });
  const forwarding = onOutput ? forwardOutput(command, onOutput) : Promise.resolve();
  const finishedCommand = await waitForCommand(command);
  await forwarding;
  if (finishedCommand.exitCode !== 0) {
    const output = await finishedCommand.output("both");
    throw new Error(
      `${label} failed with exit code ${finishedCommand.exitCode}:\n${output.slice(-OUTPUT_TAIL_LENGTH)}`,
    );
  }
};

const installRepoAndBrowser = async (sandbox: Sandbox, repo: RepoConfig): Promise<void> => {
  await sandbox.writeFiles([
    { path: `${ANALYZER_DIRECTORY}/package.json`, content: getAnalyzerPackageJson() },
    ...(repo.patchFile ? [{ path: PATCH_PATH, content: readFileSync(repo.patchFile) }] : []),
  ]);
  await runStep(sandbox, "checkout and install", "bash", ["-c", CHECKOUT_SCRIPT], {
    env: {
      APP_DIRECTORY,
      REPOSITORY: repo.repository,
      REVISION: repo.revision,
      PATCH_PATH: repo.patchFile ? PATCH_PATH : "",
      INSTALL: repo.install,
    },
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
    image: IMAGE,
    persistent: false,
    resources: SANDBOX_RESOURCES,
    timeout: SETUP_TIMEOUT_MS,
  });
  try {
    await installRepoAndBrowser(sandbox, repo);
    const snapshot = await sandbox.snapshot();
    writeSnapshot(repo.id, { key, snapshotId: snapshot.snapshotId });
    log(`saved a snapshot for ${repo.id}`);
    return snapshot.snapshotId;
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
};

const uploadAnalyzerSource = (sandbox: Sandbox): Promise<void> =>
  sandbox.writeFiles([
    ...ANALYZER_SOURCE_PATHS.flatMap((path) => listFiles(join(PACKAGE_DIRECTORY, path))).map(
      (path) => ({
        path: `${ANALYZER_DIRECTORY}/${relative(PACKAGE_DIRECTORY, path)}`,
        content: readFileSync(path),
      }),
    ),
    ...listFiles(BIPPY_SOURCE_DIRECTORY).map((path) => ({
      path: `${SANDBOX_ROOT}/bippy/src/${relative(BIPPY_SOURCE_DIRECTORY, path)}`,
      content: readFileSync(path),
    })),
  ]);

const runCollect = (
  sandbox: Sandbox,
  repo: RepoConfig,
  shouldVerify: boolean,
  onOutput: LineLogger,
): Promise<void> =>
  runStep(
    sandbox,
    "collect",
    "node_modules/.bin/tsx",
    [
      "tests/conformance/runner/collect.ts",
      `${APP_DIRECTORY}/${repo.workingDirectory}/${repo.tsconfig}`,
      OUTPUT_DIRECTORY,
      ...(shouldVerify ? ["--verify", "--component-budget", String(COMPONENT_BUDGET_MS)] : []),
      ...(repo.setupDirectory
        ? ["--setup", `${ANALYZER_DIRECTORY}/${relative(PACKAGE_DIRECTORY, repo.setupDirectory)}`]
        : []),
    ],
    {
      cwd: ANALYZER_DIRECTORY,
      env: { NODE_OPTIONS: `--max-old-space-size=${ANALYZER_HEAP_MB}`, NO_COLOR: "1" },
      onOutput,
    },
  );

const downloadResults = async (
  sandbox: Sandbox,
  outputDirectory: string,
  shouldVerify: boolean,
): Promise<void> => {
  const fileNames = RESULT_FILES.filter((fileName) => shouldVerify || fileName !== "verify.json");
  await runStep(sandbox, "compress", "gzip", ["-f", ...fileNames], { cwd: OUTPUT_DIRECTORY });
  mkdirSync(outputDirectory, { recursive: true });
  for (const fileName of fileNames) {
    const content = await sandbox.readFileToBuffer({ path: `${OUTPUT_DIRECTORY}/${fileName}.gz` });
    if (!content) throw new Error(`${fileName} was not written`);
    writeFileSync(join(outputDirectory, fileName), gunzipSync(content));
  }
};

export const runVercel = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: LineLogger,
): Promise<CollectSummary> => {
  const credentials = getCredentials();
  mkdirSync(outputDirectory, { recursive: true });
  const sandboxLogPath = join(outputDirectory, "sandbox.log");
  const appendSandboxLog: LineLogger = (text) => appendFileSync(sandboxLogPath, text);
  const snapshotId = await runStage("setup", () => prepareSnapshot(repo, credentials, log));
  const sandbox = await runStage("sandbox creation", () =>
    Sandbox.create({
      ...credentials,
      source: { type: "snapshot", snapshotId },
      persistent: false,
      resources: SANDBOX_RESOURCES,
      timeout: RUN_TIMEOUT_MS,
    }),
  );
  try {
    await runStage("upload", () => uploadAnalyzerSource(sandbox));
    await runStage("collect", () => runCollect(sandbox, repo, shouldVerify, appendSandboxLog));
    await runStage("download", () => downloadResults(sandbox, outputDirectory, shouldVerify));
    return JSON.parse(readFileSync(join(outputDirectory, "summary.json"), "utf8"));
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
};
