import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface UpstreamTestDefinition {
  disabled: boolean;
  title: string;
}

interface UpstreamTestFile {
  definitions: UpstreamTestDefinition[];
  path: string;
}

interface UpstreamReference {
  committedAt: string;
  repository: string;
  requestedRef: string;
  revision: string;
  schemaVersion: number;
  testFiles: UpstreamTestFile[];
}

const reactRepositoryUrl = "https://github.com/facebook/react.git";
const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const upstreamReferencePath = join(packageDirectory, "upstream.json");
const hookSourcesDirectory = join(packageDirectory, "fixtures/hook-sources");
const scriptArguments = process.argv.slice(2);
const supportFiles = new Set([
  "packages/react-devtools-inline/__tests__/__e2e__/utils.js",
  "packages/react-devtools-shared/src/__tests__/setupTests.js",
  "scripts/jest/devtools/setupEnv.js",
]);
const testInvocationPattern = /^\s*(?:it|test)(?:\.(?:skip|only|each))?\s*\(/gm;
const testDefinitionPattern = /^\s*(?:it|test)(?:\.(skip|only))?\s*\(\s*(["'`])([^\n]*?)\2/gm;

const getRequestedRef = (): string => {
  let requestedRef = "main";
  for (let argumentIndex = 0; argumentIndex < scriptArguments.length; argumentIndex++) {
    const argument = scriptArguments[argumentIndex];
    if (argument === "--help") {
      console.log("Usage: bun run sync [--ref <git-ref>]");
      process.exit(0);
    }
    if (argument !== "--ref") throw new Error(`Unknown argument: ${argument}`);
    const nextArgument = scriptArguments[argumentIndex + 1];
    if (!nextArgument) throw new Error("--ref requires a git ref");
    requestedRef = nextArgument;
    argumentIndex++;
  }
  return requestedRef;
};

const runGit = (repositoryDirectory: string, gitArguments: string[]): string =>
  execFileSync("git", ["-C", repositoryDirectory, ...gitArguments], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();

const getTestFiles = (reactDirectory: string): UpstreamTestFile[] => {
  const testFiles: UpstreamTestFile[] = [];
  const trackedPaths = runGit(reactDirectory, ["ls-files"]).split("\n");

  for (const path of trackedPaths) {
    if (!path.endsWith(".js") || supportFiles.has(path)) continue;
    const filePath = join(reactDirectory, path);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const count = [...source.matchAll(testInvocationPattern)].length;
    if (count === 0) continue;
    const definitions = [...source.matchAll(testDefinitionPattern)].map((match) => ({
      disabled: match[1] === "skip",
      title: match[3].replaceAll('\\"', '"').replaceAll("\\'", "'"),
    }));
    if (definitions.length !== count) {
      throw new Error(
        `${path} has ${count} test invocations but ${definitions.length} static titles`,
      );
    }
    testFiles.push({ definitions, path });
  }

  return testFiles.sort((left, right) => left.path.localeCompare(right.path));
};

const requestedRef = getRequestedRef();
const temporaryDirectory = mkdtempSync(join(tmpdir(), "bippy-react-devtools-"));
const reactDirectory = join(temporaryDirectory, "react");
const stagedHookSourcesDirectory = join(packageDirectory, `.hook-sources-${process.pid}`);
const backupHookSourcesDirectory = join(packageDirectory, `.hook-sources-backup-${process.pid}`);
const stagedReferencePath = join(packageDirectory, `.upstream-${process.pid}.json`);

try {
  mkdirSync(reactDirectory);
  runGit(reactDirectory, ["init", "--quiet"]);
  runGit(reactDirectory, ["remote", "add", "origin", reactRepositoryUrl]);
  runGit(reactDirectory, [
    "fetch",
    "--quiet",
    "--depth=1",
    "--filter=blob:none",
    "origin",
    requestedRef,
  ]);
  runGit(reactDirectory, ["sparse-checkout", "init", "--no-cone"]);
  runGit(reactDirectory, [
    "sparse-checkout",
    "set",
    "/.github/**/*devtools*",
    "/.github/**/*DevTools*",
    "/fixtures/devtools/",
    "/packages/react-debug-tools/",
    "/packages/react-devtools*/",
    "/packages/**/*devtools*",
    "/packages/**/*DevTools*",
    "/scripts/devtools/",
    "/scripts/**/*devtools*",
    "/scripts/**/*DevTools*",
  ]);
  runGit(reactDirectory, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);

  const revision = runGit(reactDirectory, ["rev-parse", "HEAD"]);
  const committedAt = runGit(reactDirectory, ["show", "-s", "--format=%cI", "HEAD"]);
  const testFiles = getTestFiles(reactDirectory);
  const upstreamReference: UpstreamReference = {
    committedAt,
    repository: reactRepositoryUrl,
    requestedRef,
    revision,
    schemaVersion: 2,
    testFiles,
  };

  const sourceHookSourcesDirectory = join(
    reactDirectory,
    "packages/react-devtools-shared/src/hooks/__tests__/__source__",
  );
  rmSync(stagedHookSourcesDirectory, { force: true, recursive: true });
  cpSync(sourceHookSourcesDirectory, stagedHookSourcesDirectory, { recursive: true });
  writeFileSync(stagedReferencePath, `${JSON.stringify(upstreamReference, null, 2)}\n`);

  rmSync(backupHookSourcesDirectory, { force: true, recursive: true });
  if (existsSync(hookSourcesDirectory)) {
    renameSync(hookSourcesDirectory, backupHookSourcesDirectory);
  }
  try {
    renameSync(stagedHookSourcesDirectory, hookSourcesDirectory);
    renameSync(stagedReferencePath, upstreamReferencePath);
    rmSync(backupHookSourcesDirectory, { force: true, recursive: true });
  } catch (error) {
    rmSync(hookSourcesDirectory, { force: true, recursive: true });
    if (existsSync(backupHookSourcesDirectory)) {
      renameSync(backupHookSourcesDirectory, hookSourcesDirectory);
    }
    throw error;
  }

  const testCount = testFiles.reduce((total, testFile) => total + testFile.definitions.length, 0);
  console.log(`Synced ${testCount} React DevTools tests from ${revision}.`);
} finally {
  rmSync(stagedHookSourcesDirectory, { force: true, recursive: true });
  rmSync(backupHookSourcesDirectory, { force: true, recursive: true });
  rmSync(stagedReferencePath, { force: true });
  rmSync(temporaryDirectory, { force: true, recursive: true });
}
