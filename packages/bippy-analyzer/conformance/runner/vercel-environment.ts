import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Writable } from "node:stream";
import { Sandbox } from "@vercel/sandbox";
import type { CollectSummary } from "./collect.ts";
import { CONFORMANCE_DIRECTORY } from "./repos.ts";
import type { RepoConfig } from "./repos.ts";

interface SnapshotRecord {
  key: string;
  snapshotId: string;
}

interface Credentials {
  token: string;
  teamId: string;
  projectId: string;
}

const PACKAGE_DIRECTORY = join(CONFORMANCE_DIRECTORY, "..");
const CACHE_DIRECTORY = join(PACKAGE_DIRECTORY, ".conformance");
const SNAPSHOTS_FILE = join(CACHE_DIRECTORY, "vercel-snapshots.json");
const SANDBOX_ROOT = "/vercel/sandbox";
const APP_DIRECTORY = `${SANDBOX_ROOT}/app`;
const ANALYZER_DIRECTORY = `${SANDBOX_ROOT}/analyzer`;
const OUTPUT_DIRECTORY = `${SANDBOX_ROOT}/out`;
const SETUP_TIMEOUT_MS = 30 * 60 * 1000;
const RUN_TIMEOUT_MS = 15 * 60 * 1000;
const ANALYZER_SOURCE_DIRECTORIES = ["src/symbolic-tree", "conformance/runner", "tests/verify"];
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
  existsSync(SNAPSHOTS_FILE) ? JSON.parse(readFileSync(SNAPSHOTS_FILE, "utf8")) : {};

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

const getSetupKey = (repo: RepoConfig): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        repo.revision,
        repo.install,
        repo.patchFile ? readFileSync(repo.patchFile, "utf8") : "",
        readFileSync(join(CONFORMANCE_DIRECTORY, "setup.sh"), "utf8"),
        getAnalyzerPackageJson(),
      ]),
    )
    .digest("hex");

const listFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

const createLineCollector = (): { stream: Writable; getTail: () => string } => {
  let buffer = "";
  const stream = new Writable({
    write: (chunk: Buffer, _encoding, callback) => {
      buffer = (buffer + chunk.toString("utf8")).slice(-8000);
      callback();
    },
  });
  return { stream, getTail: () => buffer };
};

const runStep = async (
  sandbox: Sandbox,
  label: string,
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; sudo?: boolean } = {},
): Promise<void> => {
  const output = createLineCollector();
  const result = await sandbox.runCommand({
    cmd,
    args,
    ...options,
    stdout: output.stream,
    stderr: output.stream,
  });
  if (result.exitCode !== 0)
    throw new Error(`${label} failed with exit code ${result.exitCode}:\n${output.getTail()}`);
};

const prepareSnapshot = async (
  repo: RepoConfig,
  credentials: Credentials,
  log: (line: string) => void,
): Promise<string> => {
  const key = getSetupKey(repo);
  const existing = readSnapshots()[repo.id];
  if (existing?.key === key) return existing.snapshotId;

  log(`setting up ${repo.id}@${repo.revision.slice(0, 12)} in a new sandbox`);
  const sandbox = await Sandbox.create({
    ...credentials,
    resources: { vcpus: 4 },
    timeout: SETUP_TIMEOUT_MS,
  });
  try {
    await sandbox.writeFiles([
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
    await runStep(sandbox, "setup", "bash", [`${SANDBOX_ROOT}/setup.sh`], {
      env: {
        REPOSITORY: repo.repository,
        REVISION: repo.revision,
        APP_DIR: APP_DIRECTORY,
        INSTALL: repo.install,
        PATCH_FILE: repo.patchFile ? `${SANDBOX_ROOT}/custom.patch` : "",
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
      {
        cwd: ANALYZER_DIRECTORY,
        sudo: true,
      },
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
    const snapshot = await sandbox.snapshot();
    writeSnapshot(repo.id, { key, snapshotId: snapshot.snapshotId });
    log(`saved snapshot for ${repo.id}`);
    return snapshot.snapshotId;
  } catch (error) {
    await sandbox.stop().catch(() => undefined);
    throw error;
  }
};

export const runVercel = async (
  repo: RepoConfig,
  outputDirectory: string,
  shouldVerify: boolean,
  log: (line: string) => void,
): Promise<CollectSummary> => {
  const credentials = getCredentials();
  const snapshotId = await prepareSnapshot(repo, credentials, log);
  const sandbox = await Sandbox.create({
    ...credentials,
    source: { type: "snapshot", snapshotId },
    resources: { vcpus: 4 },
    timeout: RUN_TIMEOUT_MS,
  });
  try {
    const sourceFiles = ANALYZER_SOURCE_DIRECTORIES.flatMap((directory) =>
      listFiles(join(PACKAGE_DIRECTORY, directory)),
    );
    await sandbox.writeFiles([
      ...sourceFiles.map((path) => ({
        path: `${ANALYZER_DIRECTORY}/${relative(PACKAGE_DIRECTORY, path)}`,
        content: readFileSync(path),
      })),
      ...listFiles(BIPPY_SOURCE_DIRECTORY).map((path) => ({
        path: `${SANDBOX_ROOT}/bippy/src/${relative(BIPPY_SOURCE_DIRECTORY, path)}`,
        content: readFileSync(path),
      })),
    ]);
    const tsconfigPath = `${APP_DIRECTORY}/${repo.workingDirectory}/${repo.tsconfig}`;
    await runStep(
      sandbox,
      "analyze",
      "node_modules/.bin/tsx",
      [
        "conformance/runner/collect.ts",
        tsconfigPath,
        OUTPUT_DIRECTORY,
        ...(shouldVerify ? ["--verify"] : []),
      ],
      {
        cwd: ANALYZER_DIRECTORY,
      },
    );
    mkdirSync(outputDirectory, { recursive: true });
    for (const fileName of [
      "model.json",
      "summary.json",
      ...(shouldVerify ? ["verify.json"] : []),
    ]) {
      const content = await sandbox.readFileToBuffer({ path: `${OUTPUT_DIRECTORY}/${fileName}` });
      if (!content) throw new Error(`${fileName} was not written`);
      writeFileSync(join(outputDirectory, fileName), content);
    }
    return JSON.parse(readFileSync(join(outputDirectory, "summary.json"), "utf8"));
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
};
