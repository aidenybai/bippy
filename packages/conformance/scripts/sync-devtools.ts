import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  conformanceDirectory,
  devtoolsDirectory,
  getTestDefinitions,
  readUpstreamManifest,
  upstreamManifestPath,
  type UpstreamTestFile,
} from "./test-inventory.js";

const manifest = readUpstreamManifest();
const hookSourcesDirectory = join(devtoolsDirectory, "fixtures/hook-sources");
const scriptArguments = process.argv.slice(2);
const supportFiles = new Set([
  "packages/react-devtools-inline/__tests__/__e2e__/utils.js",
  "packages/react-devtools-shared/src/__tests__/setupTests.js",
  "scripts/jest/devtools/setupEnv.js",
]);

const getRequestedRef = (): string => {
  let requestedRef = manifest.devtools.revision;
  for (let argumentIndex = 0; argumentIndex < scriptArguments.length; argumentIndex++) {
    const argument = scriptArguments[argumentIndex];
    if (argument === "--help") {
      console.log("Usage: pnpm --filter conformance sync:devtools [--ref <git-ref>]");
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
    const existingDefinitions = manifest.devtools.testFiles.find(
      (file) => file.path === path,
    )?.definitions;
    const definitions = getTestDefinitions(filePath, true)
      .filter((definition) => definition.kind !== "describe")
      .map((definition) => {
        const local = existingDefinitions?.find(
          (existing) => existing.title === definition.title && existing.local,
        )?.local;
        return {
          disabled: definition.modifiers.includes("skip"),
          title: definition.title,
          ...(local ? { local } : {}),
        };
      });
    if (definitions.length > 0) testFiles.push({ definitions, path });
  }

  return testFiles.sort((left, right) => left.path.localeCompare(right.path));
};

const requestedRef = getRequestedRef();
const temporaryDirectory = mkdtempSync(join(tmpdir(), "bippy-react-devtools-"));
const reactDirectory = join(temporaryDirectory, "react");
const stagedHookSourcesDirectory = join(devtoolsDirectory, `.hook-sources-${process.pid}`);
const backupHookSourcesDirectory = join(devtoolsDirectory, `.hook-sources-backup-${process.pid}`);
const stagedReferencePath = join(conformanceDirectory, `.upstream-${process.pid}.json`);

try {
  mkdirSync(reactDirectory);
  runGit(reactDirectory, ["init", "--quiet"]);
  runGit(reactDirectory, ["remote", "add", "origin", manifest.repository]);
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
  const testFiles = getTestFiles(reactDirectory);
  manifest.devtools = { revision, testFiles };

  const sourceHookSourcesDirectory = join(
    reactDirectory,
    "packages/react-devtools-shared/src/hooks/__tests__/__source__",
  );
  rmSync(stagedHookSourcesDirectory, { force: true, recursive: true });
  cpSync(sourceHookSourcesDirectory, stagedHookSourcesDirectory, { recursive: true });
  writeFileSync(stagedReferencePath, `${JSON.stringify(manifest, null, 2)}\n`);

  rmSync(backupHookSourcesDirectory, { force: true, recursive: true });
  if (existsSync(hookSourcesDirectory)) {
    renameSync(hookSourcesDirectory, backupHookSourcesDirectory);
  }
  try {
    renameSync(stagedHookSourcesDirectory, hookSourcesDirectory);
    renameSync(stagedReferencePath, upstreamManifestPath);
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
