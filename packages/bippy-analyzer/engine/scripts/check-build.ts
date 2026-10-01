import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { EngineBuildCleanupError } from "../errors.js";
import { engineDirectory, verifyEngineBuild } from "../manifest.js";

const require = createRequire(import.meta.url);
const runBuild = (directory: string): void => {
  execFileSync(
    process.execPath,
    [require.resolve("tsx/cli"), join(directory, "scripts/build.ts"), "--force"],
    {
      cwd: dirname(directory),
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      stdio: "pipe",
    },
  );
};

runBuild(engineDirectory);
const first = await verifyEngineBuild();
const directory = await mkdtemp(join(tmpdir(), "bippy-engine-repro-"));
let failure: unknown;
let isFailed = false;
try {
  const packageDirectory = join(directory, "packages/bippy-analyzer");
  const relocated = join(packageDirectory, "engine");
  await mkdir(packageDirectory, { recursive: true });
  await cp(engineDirectory, relocated, {
    recursive: true,
    filter: (filename) =>
      filename !== join(engineDirectory, ".build") && filename !== join(engineDirectory, "dist"),
  });
  await cp(join(engineDirectory, "../package.json"), join(packageDirectory, "package.json"));
  await cp(resolve(engineDirectory, "../../../pnpm-lock.yaml"), join(directory, "pnpm-lock.yaml"));
  await symlink(
    resolve(engineDirectory, "../../../node_modules"),
    join(directory, "node_modules"),
    "dir",
  );
  await symlink(
    resolve(engineDirectory, "../node_modules"),
    join(packageDirectory, "node_modules"),
    "dir",
  );
  runBuild(relocated);
  const second = await verifyEngineBuild(join(relocated, "dist"));
  assert.deepEqual(second, first, "Relocated clean engine build differs");
  console.log(`Two clean builds, different roots: ${first.outputs["engine.mjs"]}`);
} catch (error) {
  isFailed = true;
  failure = error;
}
try {
  await rm(directory, { recursive: true, force: true });
} catch (error) {
  if (isFailed) throw new EngineBuildCleanupError(failure, error);
  throw error;
}
if (isFailed) throw failure;
